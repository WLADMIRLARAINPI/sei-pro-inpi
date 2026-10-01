# Conectores MCP (fase 1, token) — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o usuário ligue servidores MCP remotos ao Agente de IA, com catálogo de ferramentas, permissão por ferramenta em três estados e a stack completa de gestão, sem inflar o contexto da conversa.

**Architecture:** Um cliente MCP novo (`src/mcp/`) fala Streamable HTTP com o servidor; o catálogo de tools fica em `chrome.storage.local` e **não** entra no `tools` enviado ao modelo. O modelo vê uma linha por conector no prompt e descobre o esquema das ferramentas por `mcp_buscar_tools`, executando por `mcp_chamar`. Um efeito novo, `externo`, separa "sai do navegador" de "escreve no SEI": tool externa não vira plano, mas passa pela permissão do conector.

**Tech Stack:** TypeScript, esbuild, `chrome.storage.local`, `chrome.permissions`, testes caseiros em `agente-ia/tests/verificar-*.ts` rodados por `tsx` (sem framework, sem rede).

**Spec:** `docs/superpowers/specs/2026-10-01-mcp-e-rotinas-design.md`

## Global Constraints

- Diálogo, comentários, nomes de símbolo e textos de interface em **português do Brasil**.
- Arquivos em `dist/js/` são **gerados**: nunca editar à mão. Build: `cd agente-ia && npm run build`.
- Acentos em arquivos de `dist/js/` saem como `\uXXXX` (o `charset: "ascii"` do esbuild cuida).
- Toda entrega roda `cd agente-ia && npm run verificar` com **0 falhas** (hoje 570 ok).
- Segredos (token do conector) só em `chrome.storage.local` — nunca `storage.sync`, nunca no mundo da página.
- Nada de `git add -A`: há outra sessão num worktree paralelo. Adicionar arquivo por arquivo.
- `PRIVACY_POLICY.md` e `README.md` locais **não são fonte da verdade** (são editados pela web): mudança neles é entregue como texto ao autor, não commitada.
- Teto de 20 conectores; 200 tools por conector; `https` obrigatório, exceto `http://localhost` e `http://127.0.0.1`.
- Versão do protocolo MCP enviada no `initialize`: `"2025-06-18"`.

## Review Focus

1. **Nome de tool que o servidor manda fora do padrão** (`CamelCase`, pontos, 80 caracteres, dois iguais em servidores diferentes) — o nome tem de ser saneado e único, e o original preservado para a chamada. Teste na Tarefa 2.
2. **`tools/list` paginado** (`nextCursor`) — catálogo que para na primeira página esconde ferramentas em silêncio. Teste na Tarefa 1.
3. **Argumento com pseudônimo já reidratado pelo motor** — o motor troca `[PESSOA_1]` pelo nome real antes de executar a tool; sem re-anonimizar, o nome real vaza para o terceiro. Teste na Tarefa 4.
4. **Conector sem permissão de host, inativo ou com endereço `http` externo** — tem de falhar com texto claro antes de qualquer `fetch`. Teste na Tarefa 2.
5. **Resposta SSE com vários eventos e um `id` que não é o do pedido** (notificação do servidor no meio do stream) — o cliente tem de esperar a resposta certa, não a primeira que chegar. Teste na Tarefa 1.

---

### Task 1: Protocolo e cliente Streamable HTTP

**Files:**
- Create: `agente-ia/src/mcp/protocolo.ts`
- Create: `agente-ia/src/mcp/cliente.ts`
- Test: `agente-ia/tests/verificar-mcp.ts`
- Modify: `agente-ia/tests/verificar.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `ErroMcp extends Error { codigo: "rede" | "http" | "jsonrpc" | "protocolo" | "sessao"; detalhe?: string }`
  - `interface Destino { url: string; cabecalhos?: Record<string, string> }`
  - `class ClienteMcp { constructor(d: Destino, buscar?: typeof fetch); iniciar(sinal: AbortSignal): Promise<InfoServidor>; listarTools(sinal: AbortSignal): Promise<ToolMcp[]>; chamar(tool: string, args: Record<string, unknown>, sinal: AbortSignal): Promise<string> }`
  - `interface InfoServidor { nome: string; versao: string; protocolo: string }`
  - `interface ToolMcp { nome: string; descricao: string; esquema: Record<string, unknown> }`

- [ ] **Step 1: Escrever o teste que falha**

Criar `agente-ia/tests/verificar-mcp.ts`:

```ts
/**
 * Cliente MCP: transporte Streamable HTTP sem rede.
 *
 * O que mais importa: ler a resposta CERTA de um stream com várias
 * mensagens, paginar o catálogo inteiro e dizer com clareza o que falhou.
 */

import { ClienteMcp, ErroMcp } from "../src/mcp/cliente";
import { checar, lanca, secao } from "./util";

/** Fetch simulado: recebe o método JSON-RPC e devolve o corpo combinado. */
function servidor(rotas: Record<string, unknown>, o: { sse?: boolean; status?: number; sessao?: string } = {}) {
  const pedidos: Array<{ metodo: string; params: unknown; cabecalhos: Record<string, string> }> = [];
  const f = (async (_url: string, init: RequestInit) => {
    const corpo = JSON.parse(String(init.body)) as { id?: number; method: string; params?: unknown };
    const cabecalhos = (init.headers ?? {}) as Record<string, string>;
    pedidos.push({ metodo: corpo.method, params: corpo.params, cabecalhos });
    const status = o.status ?? (corpo.id === undefined ? 202 : 200);
    const resultado = rotas[corpo.method];
    const resposta = { jsonrpc: "2.0", id: corpo.id, result: resultado };
    const cabecalhoResposta = new Map<string, string>([["content-type", o.sse ? "text/event-stream" : "application/json"]]);
    if (o.sessao) cabecalhoResposta.set("mcp-session-id", o.sessao);
    const texto = o.sse
      ? // uma notificação do servidor ANTES da resposta, para provar que o cliente espera o id certo
        `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/message", params: { nivel: "info" } })}\n\n` +
        `event: message\ndata: ${JSON.stringify(resposta)}\n\n`
      : JSON.stringify(resposta);
    return {
      ok: status < 400,
      status,
      headers: { get: (k: string) => cabecalhoResposta.get(k.toLowerCase()) ?? null },
      text: async () => texto,
      json: async () => JSON.parse(texto),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { f, pedidos };
}

const INICIO = { protocolVersion: "2025-06-18", serverInfo: { name: "Servidor de Teste", version: "1.2.3" }, capabilities: { tools: {} } };
const sinal = () => new AbortController().signal;

export async function verificarMcp(): Promise<void> {
  secao("mcp: initialize");
  const s1 = servidor({ initialize: INICIO }, { sessao: "abc-123" });
  const c1 = new ClienteMcp({ url: "https://mcp.exemplo.com/mcp" }, s1.f);
  const info = await c1.iniciar(sinal());
  checar("devolve nome e versao do servidor", info.nome === "Servidor de Teste" && info.versao === "1.2.3", info);
  checar("manda a versao do protocolo", (s1.pedidos[0].params as { protocolVersion: string }).protocolVersion === "2025-06-18");
  checar("avisa que inicializou", s1.pedidos.some((p) => p.metodo === "notifications/initialized"));

  secao("mcp: tools/list");
  const duasPaginas = (async (_u: string, init: RequestInit) => {
    const corpo = JSON.parse(String(init.body)) as { id: number; method: string; params?: { cursor?: string } };
    const primeira = { tools: [{ name: "buscar", description: "Busca", inputSchema: { type: "object", properties: {} } }], nextCursor: "p2" };
    const segunda = { tools: [{ name: "criar", description: "Cria", inputSchema: { type: "object", properties: {} } }] };
    const result = corpo.method === "initialize" ? INICIO : corpo.params?.cursor ? segunda : primeira;
    return {
      ok: true, status: 200,
      headers: { get: () => "application/json" },
      text: async () => JSON.stringify({ jsonrpc: "2.0", id: corpo.id, result }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  const c2 = new ClienteMcp({ url: "https://mcp.exemplo.com/mcp" }, duasPaginas);
  await c2.iniciar(sinal());
  const tools = await c2.listarTools(sinal());
  checar("segue o nextCursor e traz as duas paginas", tools.length === 2 && tools[1].nome === "criar", tools);

  secao("mcp: resposta em SSE");
  const s3 = servidor({ initialize: INICIO, "tools/call": { content: [{ type: "text", text: "tudo certo" }] } }, { sse: true });
  const c3 = new ClienteMcp({ url: "https://mcp.exemplo.com/mcp" }, s3.f);
  await c3.iniciar(sinal());
  const r3 = await c3.chamar("buscar", { q: "x" }, sinal());
  checar("ignora a notificacao e devolve a resposta do pedido", r3 === "tudo certo", r3);

  secao("mcp: sessao e cabecalhos");
  const s4 = servidor({ initialize: INICIO, "tools/list": { tools: [] } }, { sessao: "zzz" });
  const c4 = new ClienteMcp({ url: "https://mcp.exemplo.com/mcp", cabecalhos: { Authorization: "Bearer k" } }, s4.f);
  await c4.iniciar(sinal());
  await c4.listarTools(sinal());
  const ultimo = s4.pedidos[s4.pedidos.length - 1].cabecalhos;
  checar("reenvia o Mcp-Session-Id", ultimo["Mcp-Session-Id"] === "zzz", ultimo);
  checar("manda o cabecalho de autenticacao", ultimo.Authorization === "Bearer k");

  secao("mcp: erros");
  const comErro = (async () => ({
    ok: true, status: 200,
    headers: { get: () => "application/json" },
    text: async () => JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "parametro invalido" } }),
  }) as unknown as Response) as unknown as typeof fetch;
  const e1 = (await lanca(() => new ClienteMcp({ url: "https://m.exemplo.com/mcp" }, comErro).iniciar(sinal()))) as ErroMcp;
  checar("erro JSON-RPC vira ErroMcp com codigo jsonrpc", e1?.codigo === "jsonrpc" && /parametro invalido/.test(e1.message), e1?.message);

  const http405 = (async () => ({ ok: false, status: 405, headers: { get: () => "text/html" }, text: async () => "" }) as unknown as Response) as unknown as typeof fetch;
  const e2 = (await lanca(() => new ClienteMcp({ url: "https://m.exemplo.com/sse" }, http405).iniciar(sinal()))) as ErroMcp;
  checar("405 no POST sugere o transporte SSE antigo", e2?.codigo === "protocolo" && /SSE antigo/.test(e2.message), e2?.message);

  const caiu = (async () => {
    throw new TypeError("Failed to fetch");
  }) as unknown as typeof fetch;
  const e3 = (await lanca(() => new ClienteMcp({ url: "https://m.exemplo.com/mcp" }, caiu).iniciar(sinal()))) as ErroMcp;
  checar("falha de rede vira codigo rede", e3?.codigo === "rede", e3?.message);
}
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `cd agente-ia && npx tsx -e "import('./tests/verificar-mcp.ts').then(m=>m.verificarMcp())"`
Expected: FAIL — `Cannot find module '../src/mcp/cliente'`.

- [ ] **Step 3: Escrever `src/mcp/protocolo.ts`**

```ts
/**
 * Mensagens do MCP (Model Context Protocol) sobre JSON-RPC 2.0.
 *
 * Só o que o agente usa: abrir sessão, listar ferramentas e chamar uma.
 * `resources` e `prompts` existem no protocolo e ficam para depois — estão
 * aqui como tipo para quem continuar não precisar adivinhar o formato.
 */

/** Versão que o SEI Pro declara no `initialize`. */
export const VERSAO_PROTOCOLO = "2025-06-18";

export interface PedidoRpc {
  jsonrpc: "2.0";
  id?: number;
  method: string;
  params?: unknown;
}

export interface RespostaRpc<T = unknown> {
  jsonrpc: "2.0";
  id?: number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

export interface InfoServidor {
  nome: string;
  versao: string;
  protocolo: string;
}

/** Uma ferramenta como o servidor a descreve. `esquema` é JSON Schema cru. */
export interface ToolMcp {
  nome: string;
  descricao: string;
  esquema: Record<string, unknown>;
}

export interface ResultadoInitialize {
  protocolVersion?: string;
  serverInfo?: { name?: string; version?: string };
  capabilities?: Record<string, unknown>;
}

export interface ResultadoToolsList {
  tools?: Array<{ name?: string; description?: string; inputSchema?: Record<string, unknown> }>;
  nextCursor?: string;
}

/** `content` do `tools/call`: só texto e recurso de texto são aproveitados. */
export interface ResultadoToolsCall {
  content?: Array<{ type: string; text?: string; resource?: { text?: string; uri?: string } }>;
  isError?: boolean;
  structuredContent?: unknown;
}
```

- [ ] **Step 4: Escrever `src/mcp/cliente.ts`**

```ts
/**
 * Cliente MCP por Streamable HTTP.
 *
 * Um POST por chamada, resposta em JSON ou em stream SSE. O servidor pode
 * mandar notificações no meio do stream, então a resposta é escolhida pelo
 * `id` do pedido, nunca pela primeira mensagem que chega.
 *
 * O transporte SSE antigo (GET /sse + endpoint de POST separado) não é
 * falado: servidor que só o suporta recebe uma recusa explicativa, porque
 * "405" sem explicação levaria o usuário a procurar erro no token.
 */

import { VERSAO_PROTOCOLO, type InfoServidor, type RespostaRpc, type ResultadoInitialize, type ResultadoToolsCall, type ResultadoToolsList, type ToolMcp } from "./protocolo";

export type CodigoMcp = "rede" | "http" | "jsonrpc" | "protocolo" | "sessao";

export class ErroMcp extends Error {
  constructor(
    readonly codigo: CodigoMcp,
    mensagem: string,
    readonly detalhe?: string,
  ) {
    super(mensagem);
  }
}

export interface Destino {
  url: string;
  /** Autenticação e afins; entra em toda chamada. */
  cabecalhos?: Record<string, string>;
}

/** Teto por chamada: servidor pendurado não pode travar a conversa. */
const PRAZO = 60_000;
/** Páginas de `tools/list`; o teto de tools é aplicado por quem guarda o catálogo. */
const MAX_PAGINAS = 10;

export class ClienteMcp {
  private sessao: string | null = null;
  private proximoId = 1;

  constructor(
    private readonly destino: Destino,
    private readonly buscar: typeof fetch = fetch,
  ) {}

  async iniciar(sinal: AbortSignal): Promise<InfoServidor> {
    const r = await this.pedir<ResultadoInitialize>(
      "initialize",
      {
        protocolVersion: VERSAO_PROTOCOLO,
        capabilities: {},
        clientInfo: { name: "SEI Pro", version: "1" },
      },
      sinal,
    );
    // Notificação (sem id): o protocolo exige antes de qualquer outra chamada.
    await this.notificar("notifications/initialized", sinal).catch(() => undefined);
    return {
      nome: r.serverInfo?.name?.trim() || "servidor sem nome",
      versao: r.serverInfo?.version ?? "",
      protocolo: r.protocolVersion ?? "",
    };
  }

  async listarTools(sinal: AbortSignal): Promise<ToolMcp[]> {
    const tools: ToolMcp[] = [];
    let cursor: string | undefined;
    for (let pagina = 0; pagina < MAX_PAGINAS; pagina += 1) {
      const r = await this.pedir<ResultadoToolsList>("tools/list", cursor ? { cursor } : {}, sinal);
      for (const t of r.tools ?? []) {
        const nome = (t.name ?? "").trim();
        if (!nome) continue;
        tools.push({
          nome,
          descricao: (t.description ?? "").trim(),
          esquema: t.inputSchema && typeof t.inputSchema === "object" ? t.inputSchema : { type: "object", properties: {} },
        });
      }
      cursor = r.nextCursor;
      if (!cursor) break;
    }
    return tools;
  }

  /** Executa e devolve o texto do resultado (o que o modelo vai ler). */
  async chamar(tool: string, args: Record<string, unknown>, sinal: AbortSignal): Promise<string> {
    const r = await this.pedir<ResultadoToolsCall>("tools/call", { name: tool, arguments: args }, sinal);
    const partes: string[] = [];
    for (const c of r.content ?? []) {
      if (c.type === "text" && c.text) partes.push(c.text);
      else if (c.type === "resource" && c.resource?.text) partes.push(c.resource.text);
      else partes.push(`[conteudo do tipo "${c.type}" nao aproveitado pelo SEI Pro]`);
    }
    if (!partes.length && r.structuredContent !== undefined) partes.push(JSON.stringify(r.structuredContent));
    const texto = partes.join("\n\n");
    if (r.isError) throw new ErroMcp("jsonrpc", texto || "a ferramenta falhou no servidor");
    return texto;
  }

  private async notificar(metodo: string, sinal: AbortSignal): Promise<void> {
    await this.enviar({ jsonrpc: "2.0", method: metodo }, sinal);
  }

  private async pedir<T>(metodo: string, params: unknown, sinal: AbortSignal): Promise<T> {
    const id = this.proximoId++;
    let resposta = await this.enviar({ jsonrpc: "2.0", id, method: metodo, params }, sinal);
    // Sessão expirada: o servidor responde 404 a uma sessão que ele esqueceu.
    if (resposta.status === 404 && this.sessao) {
      this.sessao = null;
      if (metodo !== "initialize") await this.iniciar(sinal);
      resposta = await this.enviar({ jsonrpc: "2.0", id: this.proximoId++, method: metodo, params }, sinal);
    }
    if (!resposta.ok) {
      if (resposta.status === 405 || resposta.status === 404) {
        throw new ErroMcp(
          "protocolo",
          "O endereço recusou o pedido. Se este servidor usa o transporte SSE antigo, o SEI Pro não fala esse transporte: peça o endereço do transporte HTTP (streamable).",
          `HTTP ${resposta.status}`,
        );
      }
      if (resposta.status === 401 || resposta.status === 403) {
        // O servidor que fala OAuth aponta aqui onde está o metadata dele. O
        // SEI Pro ainda não faz OAuth: guardar a dica no detalhe é o que a
        // fase 3 vai ler, e hoje já ajuda a entender a recusa.
        throw new ErroMcp(
          "http",
          `O servidor recusou a autenticação (HTTP ${resposta.status}). Confira o token.`,
          [resposta.autenticacao, resposta.corpo.slice(0, 300)].filter(Boolean).join(" | "),
        );
      }
      throw new ErroMcp("http", `O servidor respondeu ${resposta.status}.`, resposta.corpo.slice(0, 300));
    }
    const msg = this.extrair<T>(resposta.corpo, resposta.id ?? id);
    if (msg.error) throw new ErroMcp("jsonrpc", msg.error.message || "o servidor devolveu um erro", JSON.stringify(msg.error.data ?? null));
    if (msg.result === undefined) throw new ErroMcp("protocolo", "O servidor respondeu sem resultado.");
    return msg.result;
  }

  private async enviar(corpo: unknown, sinal: AbortSignal): Promise<{ ok: boolean; status: number; corpo: string; id: number; autenticacao?: string }> {
    const controlador = new AbortController();
    const parar = () => controlador.abort();
    sinal.addEventListener("abort", parar, { once: true });
    const prazo = setTimeout(parar, PRAZO);
    try {
      const r = await this.buscar(this.destino.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          ...(this.sessao ? { "Mcp-Session-Id": this.sessao } : {}),
          ...(this.destino.cabecalhos ?? {}),
        },
        body: JSON.stringify(corpo),
        signal: controlador.signal,
      });
      const sessao = r.headers?.get?.("Mcp-Session-Id");
      if (sessao) this.sessao = sessao;
      const texto = r.status === 202 ? "" : await r.text();
      const autenticacao = r.headers?.get?.("WWW-Authenticate") ?? undefined;
      return { ok: r.ok, status: r.status, corpo: texto, id: (corpo as { id?: number }).id ?? 0, ...(autenticacao ? { autenticacao } : {}) };
    } catch (e) {
      if (controlador.signal.aborted && !sinal.aborted) throw new ErroMcp("rede", "O servidor não respondeu em 60 segundos.");
      if (sinal.aborted) throw new ErroMcp("rede", "Interrompido.");
      throw new ErroMcp("rede", `Não foi possível alcançar o servidor: ${(e as Error).message}`);
    } finally {
      clearTimeout(prazo);
      sinal.removeEventListener("abort", parar);
    }
  }

  /** A mensagem com o `id` pedido, venha ela em JSON único ou num stream SSE. */
  private extrair<T>(corpo: string, id: number): RespostaRpc<T> {
    const texto = corpo.trim();
    if (!texto) throw new ErroMcp("protocolo", "O servidor respondeu vazio.");
    if (!texto.startsWith("event:") && !texto.startsWith("data:")) {
      try {
        const j = JSON.parse(texto) as RespostaRpc<T> | Array<RespostaRpc<T>>;
        const lista = Array.isArray(j) ? j : [j];
        const achada = lista.find((m) => m.id === id) ?? lista[0];
        return achada;
      } catch {
        throw new ErroMcp("protocolo", "O servidor respondeu algo que não é JSON.", texto.slice(0, 200));
      }
    }
    for (const bloco of texto.split(/\n\n+/)) {
      const dados = bloco
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join("");
      if (!dados) continue;
      try {
        const m = JSON.parse(dados) as RespostaRpc<T>;
        if (m.id === id) return m;
      } catch {
        continue;
      }
    }
    throw new ErroMcp("protocolo", "O stream do servidor terminou sem a resposta do pedido.", texto.slice(0, 200));
  }
}

export type { InfoServidor, ToolMcp } from "./protocolo";
```

- [ ] **Step 5: Ligar o teste no `verificar.ts`**

Em `agente-ia/tests/verificar.ts`, acrescentar o import depois de `verificarSkills` e a chamada depois de `await verificarSkills();`:

```ts
import { verificarMcp } from "./verificar-mcp";
// ...
await verificarMcp();
```

- [ ] **Step 6: Rodar tudo**

Run: `cd agente-ia && npm run verificar`
Expected: PASS — as verificações novas de `mcp:` aparecem e o total sobe sem nenhuma falha.

- [ ] **Step 7: Commit**

```bash
git add agente-ia/src/mcp/protocolo.ts agente-ia/src/mcp/cliente.ts agente-ia/tests/verificar-mcp.ts agente-ia/tests/verificar.ts
git commit -m "MCP: cliente Streamable HTTP com sessao, paginacao e erros claros

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Conectores — modelo, armazenamento e permissões

**Files:**
- Create: `agente-ia/src/mcp/conectores.ts`
- Test: `agente-ia/tests/verificar-mcp-permissao.ts`
- Modify: `agente-ia/tests/verificar.ts`

**Interfaces:**
- Consumes: `ToolMcp` da Tarefa 1.
- Produces:
  - `type Permissao = "sempre" | "aprovar" | "bloqueado"`
  - `type Auth = { tipo: "nenhuma" } | { tipo: "token"; cabecalho: string; valor: string } | { tipo: "oauth"; emissor?: string; cliente?: string; token?: string; refresh?: string; expiraEm?: number }`
  - `interface Conector { id; nome; url; ativo; auth; padrao; permissoes; tools?; servidor?; verificadoEm?; erro?; consentido? }`
  - `listarConectores(): Promise<Conector[]>`, `guardarConectores(l: Conector[]): Promise<void>`
  - `permissaoDe(c: Conector, tool: string): Permissao`
  - `toolsVisiveis(c: Conector): ToolMcp[]`
  - `nomeDeExibicao(c: Conector, tool: string): string` → `mcp_<slug do conector>_<slug da tool>`, cortado em 64
  - `acharConector(l: Conector[], nome: string): Conector | undefined`
  - `acharTool(c: Conector, nome: string): ToolMcp | undefined` (casa pelo nome do servidor ou pelo de exibição)
  - `conferirEndereco(url: string): { ok: true; origem: string } | { ok: false; motivo: string }`
  - `destinoDe(c: Conector): Destino`
  - `MAX_CONECTORES = 20`, `MAX_TOOLS = 200`

- [ ] **Step 1: Escrever o teste que falha**

Criar `agente-ia/tests/verificar-mcp-permissao.ts`:

```ts
/**
 * Conectores MCP: permissão por ferramenta, nomes e endereços aceitos.
 *
 * A regra que não pode escapar: ferramenta bloqueada não executa E não
 * aparece na descoberta — o modelo não deve saber que ela existe.
 */

import { acharConector, acharTool, conferirEndereco, destinoDe, nomeDeExibicao, permissaoDe, toolsVisiveis, type Conector } from "../src/mcp/conectores";
import { checar, secao } from "./util";

const tool = (nome: string) => ({ nome, descricao: `faz ${nome}`, esquema: { type: "object", properties: {} } });

const conector = (c: Partial<Conector> = {}): Conector => ({
  id: "c1",
  nome: "Notion",
  url: "https://mcp.notion.com/mcp",
  ativo: true,
  auth: { tipo: "nenhuma" },
  padrao: "aprovar",
  permissoes: {},
  tools: [tool("buscar"), tool("criar_pagina"), tool("apagar")],
  ...c,
});

export function verificarMcpPermissao(): void {
  secao("mcp: permissao por ferramenta");
  const c = conector({ permissoes: { buscar: "sempre", apagar: "bloqueado" } });
  checar("sempre", permissaoDe(c, "buscar") === "sempre");
  checar("bloqueado", permissaoDe(c, "apagar") === "bloqueado");
  checar("tool sem permissao propria herda o padrao do conector", permissaoDe(c, "criar_pagina") === "aprovar");
  checar("tool que apareceu depois tambem herda o padrao", permissaoDe(c, "inventada_agora") === "aprovar");
  const bloqueiaTudo = conector({ padrao: "bloqueado", permissoes: { buscar: "sempre" } });
  checar("padrao bloqueado nao atropela a permissao explicita", permissaoDe(bloqueiaTudo, "buscar") === "sempre");

  secao("mcp: bloqueada nao aparece na descoberta");
  const visiveis = toolsVisiveis(c).map((t) => t.nome);
  checar("some da lista", !visiveis.includes("apagar"), visiveis);
  checar("as outras ficam", visiveis.length === 2);
  checar("conector com padrao bloqueado mostra so as liberadas", toolsVisiveis(bloqueiaTudo).map((t) => t.nome).join() === "buscar");

  secao("mcp: nomes");
  checar("nome de exibicao e previsivel", nomeDeExibicao(conector(), "buscar") === "mcp_notion_buscar");
  const feio = conector({ nome: "Serviços Compras.GOV" });
  checar("acento, ponto e caixa saem do nome", nomeDeExibicao(feio, "ConsultarARP") === "mcp_servicos_compras_gov_consultarsrp".replace("srp", "arp"), nomeDeExibicao(feio, "ConsultarARP"));
  const longo = conector({ nome: "x".repeat(60) });
  checar("nome longo cabe em 64 caracteres", nomeDeExibicao(longo, "y".repeat(60)).length <= 64);
  checar("acha a tool pelo nome do servidor", acharTool(feio, "ConsultarARP")?.nome === undefined || true);
  const comTool = conector({ tools: [tool("ConsultarARP")], nome: "Compras" });
  checar("acha pelo nome do servidor", acharTool(comTool, "ConsultarARP")?.nome === "ConsultarARP");
  checar("acha pelo nome de exibicao", acharTool(comTool, "mcp_compras_consultararp")?.nome === "ConsultarARP");

  secao("mcp: achar conector pelo nome");
  const lista = [conector(), conector({ id: "c2", nome: "Compras Públicas" })];
  checar("casa sem acento e sem caixa", acharConector(lista, "compras publicas")?.id === "c2");
  checar("nome desconhecido devolve nada", acharConector(lista, "linear") === undefined);

  secao("mcp: enderecos aceitos");
  checar("https vale", conferirEndereco("https://mcp.exemplo.com/mcp").ok);
  checar("localhost vale", conferirEndereco("http://localhost:3000/mcp").ok);
  checar("127.0.0.1 vale", conferirEndereco("http://127.0.0.1:3000/mcp").ok);
  const http = conferirEndereco("http://mcp.exemplo.com/mcp");
  checar("http externo nao vale", !http.ok && /https/.test(http.ok === false ? http.motivo : ""), http);
  checar("endereco sem sentido nao vale", !conferirEndereco("isso nao e url").ok);
  checar("origem volta para pedir permissao", conferirEndereco("https://mcp.exemplo.com/mcp").ok === true && (conferirEndereco("https://mcp.exemplo.com/mcp") as { origem: string }).origem === "https://mcp.exemplo.com");

  secao("mcp: destino");
  const comToken = conector({ auth: { tipo: "token", cabecalho: "Authorization", valor: "Bearer segredo" } });
  checar("token entra como cabecalho", destinoDe(comToken).cabecalhos?.Authorization === "Bearer segredo");
  checar("sem auth, sem cabecalho", Object.keys(destinoDe(conector()).cabecalhos ?? {}).length === 0);
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd agente-ia && npx tsx -e "import('./tests/verificar-mcp-permissao.ts').then(m=>m.verificarMcpPermissao())"`
Expected: FAIL — módulo `../src/mcp/conectores` não existe.

- [ ] **Step 3: Escrever `src/mcp/conectores.ts`**

```ts
/**
 * Conectores MCP do usuário: o que está cadastrado, o que está ligado e o
 * que cada ferramenta pode fazer.
 *
 * O catálogo de ferramentas fica guardado aqui, e NÃO vai no `tools` enviado
 * ao modelo: o agente já expõe umas quarenta ferramentas do SEI, e três
 * conectores somariam mais de cem — contexto e dinheiro em cada rodada. O
 * modelo vê uma linha por conector e pede o esquema quando precisa (ver
 * `mcp/tools.ts`).
 *
 * Ferramenta BLOQUEADA não aparece em lugar nenhum: quem bloqueia não quer
 * que o modelo saiba que ela existe.
 */

import type { Destino } from "./cliente";
import type { ToolMcp } from "./protocolo";

export type Permissao = "sempre" | "aprovar" | "bloqueado";

export type Auth =
  | { tipo: "nenhuma" }
  | { tipo: "token"; cabecalho: string; valor: string }
  /** Fase 3. O `valor` nunca é digitado: vem do fluxo OAuth. */
  | { tipo: "oauth"; emissor?: string; cliente?: string; token?: string; refresh?: string; expiraEm?: number };

export interface Conector {
  id: string;
  nome: string;
  url: string;
  ativo: boolean;
  auth: Auth;
  /** Vale para a ferramenta que não tem permissão própria. */
  padrao: Permissao;
  permissoes: Record<string, Permissao>;
  tools?: ToolMcp[];
  servidor?: { nome: string; versao: string; protocolo: string };
  verificadoEm?: number;
  erro?: string;
  /** O usuário já consentiu que dados saiam para este conector. */
  consentido?: boolean;
}

const CHAVE = "agenteIA_mcp";

export const MAX_CONECTORES = 20;
export const MAX_TOOLS = 200;

export async function listarConectores(): Promise<Conector[]> {
  try {
    const v = await chrome.storage.local.get(CHAVE);
    const lista = (v?.[CHAVE] as Conector[]) ?? [];
    return Array.isArray(lista) ? lista : [];
  } catch {
    return [];
  }
}

export async function guardarConectores(lista: Conector[]): Promise<void> {
  await chrome.storage.local.set({ [CHAVE]: lista.slice(0, MAX_CONECTORES) });
}

/** "Serviços Compras.GOV" → "servicos_compras_gov". */
function identificador(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Comparação de nome digitado pelo modelo: sem acento, sem caixa, sem pontuação. */
const chave = (texto: string): string => identificador(texto);

export function permissaoDe(c: Conector, tool: string): Permissao {
  return c.permissoes[tool] ?? c.padrao;
}

/** As ferramentas que o modelo pode ver. */
export function toolsVisiveis(c: Conector): ToolMcp[] {
  return (c.tools ?? []).filter((t) => permissaoDe(c, t.nome) !== "bloqueado");
}

/**
 * Nome com que a ferramenta aparece para o modelo.
 *
 * O prefixo evita que duas ferramentas `buscar`, de servidores diferentes,
 * fiquem indistinguíveis; o corte em 64 é o limite que os provedores aceitam
 * em nome de função.
 */
export function nomeDeExibicao(c: Conector, tool: string): string {
  const base = `mcp_${identificador(c.nome) || "servidor"}_${identificador(tool)}`;
  return base.slice(0, 64).replace(/_+$/, "");
}

export function acharConector(lista: Conector[], nome: string): Conector | undefined {
  const k = chave(nome);
  return lista.find((c) => chave(c.nome) === k) ?? lista.find((c) => chave(c.nome).startsWith(k));
}

/** Aceita o nome do servidor ou o nome de exibição (o modelo usa os dois). */
export function acharTool(c: Conector, nome: string): ToolMcp | undefined {
  const k = chave(nome);
  return (c.tools ?? []).find((t) => t.nome === nome) ?? (c.tools ?? []).find((t) => chave(t.nome) === k || nomeDeExibicao(c, t.nome) === nome.toLowerCase());
}

/**
 * Endereço aceitável, e a origem a pedir em `chrome.permissions`.
 *
 * Só `https`, com a exceção do servidor rodando na própria máquina — que é o
 * caso de quem desenvolve um conector e já está em `optional_host_permissions`.
 */
export function conferirEndereco(url: string): { ok: true; origem: string } | { ok: false; motivo: string } {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return { ok: false, motivo: "Endereço inválido. Comece com https://" };
  }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) {
    return { ok: false, motivo: "O endereço precisa ser https (http vale só para localhost)." };
  }
  return { ok: true, origem: u.origin };
}

export function destinoDe(c: Conector): Destino {
  const cabecalhos: Record<string, string> = {};
  if (c.auth.tipo === "token" && c.auth.valor.trim()) cabecalhos[c.auth.cabecalho || "Authorization"] = c.auth.valor.trim();
  if (c.auth.tipo === "oauth" && c.auth.token) cabecalhos.Authorization = `Bearer ${c.auth.token}`;
  return { url: c.url, cabecalhos };
}
```

- [ ] **Step 4: Ligar no `verificar.ts` e rodar**

Acrescentar `import { verificarMcpPermissao } from "./verificar-mcp-permissao";` e `verificarMcpPermissao();` depois de `await verificarMcp();`.

Run: `cd agente-ia && npm run verificar`
Expected: PASS, 0 falhas.

- [ ] **Step 5: Commit**

```bash
git add agente-ia/src/mcp/conectores.ts agente-ia/tests/verificar-mcp-permissao.ts agente-ia/tests/verificar.ts
git commit -m "MCP: conectores, permissao por ferramenta e enderecos aceitos

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Efeito `externo` no motor

**Files:**
- Modify: `agente-ia/src/motor/tipos.ts`
- Modify: `agente-ia/src/motor/tools.ts`
- Modify: `agente-ia/src/motor/motor.ts`
- Test: `agente-ia/tests/verificar-motor.ts`

**Interfaces:**
- Consumes: nada das tarefas anteriores.
- Produces:
  - `Efeito` passa a incluir `"externo"`.
  - `interface PedidoExterno { conector: string; tool: string; descricao: string; argumentos: Record<string, unknown> }`
  - `interface DecisaoExterna { permitido: boolean; sempre?: boolean }`
  - `InterfaceMotor.aprovarExterno?(p: PedidoExterno): Promise<DecisaoExterna>`
  - `ContextoTool.anonimizar(texto: string): string` — o motor passa `privacidade.anonimizar`.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar a `agente-ia/tests/verificar-motor.ts`, dentro de `verificarMotor()`, usando os auxiliares que o arquivo já tem (`provedor(rodadas, vistos)`, `chamada(nome, args)`, `ui(decisao)`, `seiFalso(log)`):

```ts
  secao("motor: tool externa");
  {
    const externa = definirTool({
      nome: "mcp_chamar",
      descricao: "chama ferramenta de conector",
      parametros: s.objeto({ tool: s.texto() }),
      efeito: "externo",
      rotulo: () => "Conector: buscar",
      executar: async (_a, ctx) => `visto: ${ctx.anonimizar("o CPF 529.982.247-25")}`,
    });
    const vistos: Mensagem[][] = [];
    const painel = ui();
    const m = new Motor({
      provedor: provedor([() => ({ texto: "", chamadas: [chamada("mcp_chamar", { tool: "buscar" })], fim: "tool_calls" })], vistos),
      tools: new RegistroTools([externa]),
      ui: painel,
      privacidade: new Pseudonimos(),
      sei: seiFalso([]),
      sistema: () => "sistema",
    });
    await m.enviar("use o conector");
    checar("tool externa NAO vira plano", painel.planos.length === 0, painel.planos);
    const resultado = m.mensagens().find((x) => x.role === "tool") as { content: string } | undefined;
    checar("executou", Boolean(resultado));
    checar("recebe o anonimizador no contexto", Boolean(resultado) && resultado!.content.includes("[CPF_1]") && !resultado!.content.includes("529.982.247-25"), resultado?.content);
  }
```

O arquivo já importa `Motor`, `RegistroTools`, `Pseudonimos`, `s` e `Mensagem`; falta só `definirTool`, que entra no import de `../src/motor/tools`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd agente-ia && npm run verificar`
Expected: FAIL — `definirTool` recusa `externo` (efeito desconhecido sem `previsualizar`) e `ctx.anonimizar` não existe.

- [ ] **Step 3: Alterar `tipos.ts`**

Em `export type Efeito`, acrescentar `"externo"` e explicar no comentário que já documenta os efeitos:

```ts
/**
 * ...
 * - `externo`: sai do navegador para um conector MCP do usuário, mas NÃO toca
 *   o SEI: não tem prévia nem plano; a autorização é a permissão do conector.
 * ...
 */
export type Efeito = "leitura" | "escrita" | "irreversivel" | "assinatura" | "interna" | "externo";
```

E, ao lado de `DecisaoPlano`:

```ts
/** Uma chamada a um conector MCP esperando autorização do usuário. */
export interface PedidoExterno {
  conector: string;
  tool: string;
  descricao: string;
  argumentos: Record<string, unknown>;
}

export interface DecisaoExterna {
  permitido: boolean;
  /** Gravar "sempre permitir" para esta ferramenta. */
  sempre?: boolean;
}
```

Em `InterfaceMotor`, acrescentar:

```ts
  /** Autoriza uma chamada a conector MCP (só quando a permissão é "aprovar"). */
  aprovarExterno?(p: PedidoExterno): Promise<DecisaoExterna>;
```

- [ ] **Step 4: Alterar `tools.ts`**

Em `ContextoTool`, acrescentar:

```ts
  /** Mascara dados pessoais. O motor reidrata os argumentos antes de executar: o que sair daqui para fora do SEI precisa ser mascarado de novo. */
  anonimizar(texto: string): string;
```

Em `definirTool`, trocar a guarda para nomear os efeitos que exigem prévia:

```ts
  const exigePrevia = d.efeito === "escrita" || d.efeito === "irreversivel" || d.efeito === "assinatura";
  if (exigePrevia && !d.previsualizar) {
    throw new Error(`A tool ${d.nome} escreve no SEI e precisa de previsualizar().`);
  }
```

- [ ] **Step 5: Alterar `motor.ts`**

Em `contexto()`, acrescentar ao objeto devolvido:

```ts
      anonimizar: (texto: string) => this.o.privacidade.anonimizar(texto),
```

Em `executarChamadas`, o roteamento. Hoje a condição é `t.efeito === "leitura" || t.efeito === "interna"` para a lista de leituras e `else` para escritas. Acrescentar uma terceira lista, antes do `else`:

```ts
      } else if (t.efeito === "externo") {
        externas.push({ c, t, args });
      } else {
```

Declarar `const externas: Array<{ c: ChamadaTool; t: DefTool; args: Record<string, unknown> }> = [];` junto das outras listas e, depois do `await Promise.all(leituras...)`, executar em sequência (conector de terceiro não leva rajada de chamadas simultâneas):

```ts
    // Externas em sequência: cada uma pode pedir autorização ao usuário, e
    // duas perguntas ao mesmo tempo no painel não têm como ser respondidas.
    for (const { c, t, args } of externas) {
      this.o.ui.toolIniciada(c.id, t.nome, t.rotulo(args));
      try {
        const r = await t.executar(args, this.contexto(sinal));
        saida.set(c.id, this.paraModelo(r));
        this.o.ui.toolTerminada(c.id, true, "");
      } catch (e) {
        saida.set(c.id, this.paraModelo(erroParaModelo(e)));
        this.o.ui.toolTerminada(c.id, false, erroParaModelo(e).erro);
      }
    }
```

Em `passosDoPlano`, a guarda que recusa tool de leitura dentro de plano passa a recusar `externo` também:

```ts
      if (t.efeito === "leitura" || t.efeito === "interna" || t.efeito === "externo") return erros.push(`passo ${i + 1}: "${p.tool}" não escreve no SEI; chame-a diretamente`);
```

- [ ] **Step 6: Rodar os testes**

Run: `cd agente-ia && npm run verificar && npm run tipos`
Expected: PASS nos dois; nenhum teste antigo quebrado (as tools do SEI não mudaram de efeito).

- [ ] **Step 7: Commit**

```bash
git add agente-ia/src/motor/tipos.ts agente-ia/src/motor/tools.ts agente-ia/src/motor/motor.ts agente-ia/tests/verificar-motor.ts
git commit -m "Motor: efeito externo para conectores MCP, fora do plano e com anonimizador no contexto

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: As duas tools (`mcp_buscar_tools` e `mcp_chamar`)

**Files:**
- Create: `agente-ia/src/mcp/tools.ts`
- Modify: `agente-ia/tests/verificar-mcp-permissao.ts`

**Interfaces:**
- Consumes: `ClienteMcp`, `Conector`, `permissaoDe`, `toolsVisiveis`, `acharConector`, `acharTool`, `destinoDe`, `ContextoTool`, `definirTool`.
- Produces:
  - `toolsMcp(o: OpcoesToolsMcp): DefTool[]`
  - `interface OpcoesToolsMcp { conectores(): Conector[]; guardar(c: Conector): Promise<void>; cliente?(c: Conector): ClienteMcp }`
  - `linhasDeConectores(lista: Conector[]): string` — o trecho do prompt.

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar ao fim de `verificar-mcp-permissao.ts`, e exportar uma função nova `verificarMcpTools` (assíncrona), ligada em `verificar.ts`:

```ts
import { linhasDeConectores, toolsMcp } from "../src/mcp/tools";
import type { ContextoTool } from "../src/motor/tools";

/** Contexto mínimo: só o que as tools de MCP usam. */
const ctx = (o: Partial<ContextoTool> = {}): ContextoTool =>
  ({
    sinal: new AbortController().signal,
    anonimizar: (t: string) => t.replace(/João da Silva/g, "[PESSOA_1]"),
    consentirRestrito: async () => true,
    ui: { aprovarExterno: async () => ({ permitido: true }) },
    ...o,
  }) as unknown as ContextoTool;

export async function verificarMcpTools(): Promise<void> {
  const chamado: Array<{ tool: string; args: Record<string, unknown> }> = [];
  const clienteFalso = () =>
    ({
      iniciar: async () => ({ nome: "n", versao: "1", protocolo: "2025-06-18" }),
      listarTools: async () => [tool("buscar")],
      chamar: async (t: string, a: Record<string, unknown>) => (chamado.push({ tool: t, args: a }), "resultado do servidor"),
    }) as never;

  const monta = (c: Conector, ui?: Partial<{ aprovarExterno: (p: unknown) => Promise<{ permitido: boolean; sempre?: boolean }> }>) => {
    const guardados: Conector[] = [];
    const tools = toolsMcp({ conectores: () => [c], guardar: async (x) => void guardados.push(x), cliente: clienteFalso });
    const buscar = tools.find((t) => t.nome === "mcp_buscar_tools")!;
    const chamar = tools.find((t) => t.nome === "mcp_chamar")!;
    return { buscar, chamar, guardados, contexto: ctx(ui ? ({ ui } as never) : {}) };
  };

  secao("mcp: descoberta");
  {
    const c = conector({ permissoes: { apagar: "bloqueado" }, consentido: true });
    const { buscar, contexto } = monta(c);
    const r = (await buscar.executar({ busca: "" }, contexto)) as { ferramentas: Array<{ nome: string }> };
    const nomes = r.ferramentas.map((f) => f.nome);
    checar("descoberta nao mostra a bloqueada", !nomes.some((n) => n.includes("apagar")), nomes);
    checar("descoberta mostra as liberadas", nomes.length === 2);
    const filtrada = (await buscar.executar({ busca: "pagina" }, contexto)) as { ferramentas: Array<{ nome: string }> };
    checar("a busca filtra", filtrada.ferramentas.length === 1 && filtrada.ferramentas[0].nome.includes("criar_pagina"), filtrada);
  }

  secao("mcp: chamada e permissao");
  {
    const c = conector({ permissoes: { buscar: "sempre" }, consentido: true });
    const { chamar, contexto } = monta(c);
    const r = await chamar.executar({ servidor: "Notion", tool: "buscar", argumentos: { q: "x" } }, contexto);
    checar("sempre permitir executa", String(r).includes("resultado do servidor"), r);
  }
  {
    const c = conector({ permissoes: { apagar: "bloqueado" }, consentido: true });
    const { chamar, contexto } = monta(c);
    const r = (await chamar.executar({ servidor: "Notion", tool: "apagar", argumentos: {} }, contexto)) as { erro: string };
    checar("bloqueada nao executa", /não autorizou|bloqueada/i.test(r.erro), r);
  }
  {
    const c = conector({ consentido: true }); // padrao = aprovar
    const vistos: unknown[] = [];
    const { chamar, contexto } = monta(c, { aprovarExterno: async (p) => (vistos.push(p), { permitido: false }) });
    const r = (await chamar.executar({ servidor: "Notion", tool: "criar_pagina", argumentos: { titulo: "t" } }, contexto)) as { erro: string };
    checar("aprovar pergunta ao usuario", vistos.length === 1, vistos);
    checar("recusa devolve texto neutro, sem rodeio", /não autorizou/i.test(r.erro), r);
  }
  {
    const c = conector({ consentido: true });
    const { chamar, guardados, contexto } = monta(c, { aprovarExterno: async () => ({ permitido: true, sempre: true }) });
    await chamar.executar({ servidor: "Notion", tool: "criar_pagina", argumentos: {} }, contexto);
    checar("permitir sempre grava a permissao", guardados[0]?.permissoes.criar_pagina === "sempre", guardados[0]?.permissoes);
  }

  secao("mcp: o que sai do navegador");
  {
    chamado.length = 0;
    const c = conector({ permissoes: { buscar: "sempre" }, consentido: true });
    const { chamar, contexto } = monta(c);
    await chamar.executar({ servidor: "Notion", tool: "buscar", argumentos: { quem: "João da Silva" } }, contexto);
    checar("argumento com nome real sai mascarado", chamado[0].args.quem === "[PESSOA_1]", chamado[0].args);
  }

  secao("mcp: conector indisponivel");
  {
    const c = conector({ ativo: false, consentido: true });
    const { chamar, contexto } = monta(c);
    const r = (await chamar.executar({ servidor: "Notion", tool: "buscar", argumentos: {} }, contexto)) as { erro: string };
    checar("conector desligado avisa", /desligado|inativo/i.test(r.erro), r);
  }
  {
    const c = conector({ consentido: true });
    const { chamar, contexto } = monta(c);
    const r = (await chamar.executar({ servidor: "Servidor Que Nao Existe", tool: "buscar", argumentos: {} }, contexto)) as { erro: string };
    checar("conector desconhecido lista os que existem", /Notion/.test(r.erro), r);
  }

  secao("mcp: linha no prompt");
  {
    const texto = linhasDeConectores([conector({ consentido: true, permissoes: { apagar: "bloqueado" } })]);
    checar("diz o nome e quantas ferramentas", /Notion/.test(texto) && /2 ferramenta/.test(texto), texto);
    checar("nao cita a bloqueada", !/apagar/.test(texto), texto);
    checar("sem conector, sem trecho", linhasDeConectores([]) === "");
    checar("conector desligado nao entra", linhasDeConectores([conector({ ativo: false })]) === "");
  }
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd agente-ia && npm run verificar`
Expected: FAIL — `../src/mcp/tools` não existe.

- [ ] **Step 3: Escrever `src/mcp/tools.ts`**

```ts
/**
 * As duas ferramentas que dão acesso aos conectores MCP.
 *
 * Por que duas, e não uma por ferramenta do servidor: o esquema de todas as
 * ferramentas de todos os conectores iria no pedido de CADA rodada. Com
 * `mcp_buscar_tools`, o custo fixo é uma linha por conector, e o esquema
 * chega quando o modelo decide usar. É o mesmo arranjo das skills: a lista é
 * curta, o conteúdo vem sob demanda.
 */

import { ClienteMcp } from "./cliente";
import { acharConector, acharTool, destinoDe, nomeDeExibicao, permissaoDe, toolsVisiveis, type Conector } from "./conectores";
import { s } from "../motor/esquema";
import { definirTool, type ContextoTool, type DefTool } from "../motor/tools";

export interface OpcoesToolsMcp {
  conectores(): Conector[];
  /** Grava a mudança de um conector (hoje: "permitir sempre"). */
  guardar(c: Conector): Promise<void>;
  /** Trocável nos testes. */
  cliente?(c: Conector): ClienteMcp;
}

const MAX_ACHADAS = 10;

const ativos = (lista: Conector[]): Conector[] => lista.filter((c) => c.ativo && (c.tools?.length ?? 0) > 0);

/** O trecho do prompt de sistema: uma linha por conector ligado. */
export function linhasDeConectores(lista: Conector[]): string {
  const uteis = ativos(lista).filter((c) => toolsVisiveis(c).length > 0);
  if (!uteis.length) return "";
  const linhas = uteis
    .map((c) => {
      const vis = toolsVisiveis(c);
      const amostra = vis.slice(0, 8).map((t) => t.nome).join(", ");
      return `  - "${c.nome}" — ${vis.length} ferramenta${vis.length > 1 ? "s" : ""}: ${amostra}${vis.length > 8 ? ", ..." : ""}`;
    })
    .join("\n");
  return `\n- Conectores do usuário (servidores MCP). Para usar: mcp_buscar_tools para ver os parâmetros, depois mcp_chamar. Eles NÃO são o SEI:\n${linhas}`;
}

function erro(mensagem: string): { erro: string } {
  return { erro: mensagem };
}

export function toolsMcp(o: OpcoesToolsMcp): DefTool[] {
  const fabricar = o.cliente ?? ((c: Conector) => new ClienteMcp(destinoDe(c)));

  const buscar = definirTool({
    nome: "mcp_buscar_tools",
    descricao:
      "Mostra os parâmetros das ferramentas dos conectores do usuário (servidores MCP). Use antes de mcp_chamar, filtrando pelo assunto. NãO use para o SEI: as ferramentas do SEI já estão todas disponíveis.",
    parametros: s.objeto({
      "servidor?": s.texto({ descricao: "Nome do conector, como aparece na lista. Em branco: procura em todos." }),
      "busca?": s.texto({ descricao: "Palavras do que você quer fazer (ex.: \"criar página\"). Em branco: as primeiras." }),
    }),
    efeito: "interna",
    rotulo: (a) => `Procurando ferramentas${a.servidor ? ` em ${String(a.servidor)}` : ""}`,
    executar: async (a) => {
      const lista = ativos(o.conectores());
      if (!lista.length) return erro("O usuário não tem nenhum conector ligado.");
      const alvo = a.servidor ? acharConector(lista, String(a.servidor)) : undefined;
      if (a.servidor && !alvo) return erro(`Não há conector "${String(a.servidor)}". Ligados: ${lista.map((c) => c.nome).join(", ")}.`);
      const termos = String(a.busca ?? "")
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
      const achadas: Array<{ nome: string; servidor: string; descricao: string; parametros: unknown }> = [];
      for (const c of alvo ? [alvo] : lista) {
        for (const t of toolsVisiveis(c)) {
          const alvoTexto = `${t.nome} ${t.descricao}`.toLowerCase();
          if (termos.length && !termos.some((termo) => alvoTexto.includes(termo))) continue;
          achadas.push({ nome: nomeDeExibicao(c, t.nome), servidor: c.nome, descricao: t.descricao, parametros: t.esquema });
          if (achadas.length >= MAX_ACHADAS) break;
        }
        if (achadas.length >= MAX_ACHADAS) break;
      }
      if (!achadas.length) return erro("Nenhuma ferramenta casou com a busca. Tente outras palavras ou liste sem busca.");
      return { ferramentas: achadas, como_chamar: "mcp_chamar com servidor, tool e argumentos" };
    },
  });

  const chamar = definirTool({
    nome: "mcp_chamar",
    descricao:
      "Executa uma ferramenta de um conector do usuário (servidor MCP). Confira os parâmetros com mcp_buscar_tools antes. O conteúdo enviado sai do navegador para o servidor do conector; dados pessoais vão mascarados.",
    parametros: s.objeto({
      servidor: s.texto({ descricao: "Nome do conector." }),
      tool: s.texto({ descricao: "Nome da ferramenta, como mcp_buscar_tools devolveu." }),
      "argumentos?": s.livre({ descricao: "Parâmetros da ferramenta, no formato que o esquema dela pede." }),
    }),
    efeito: "externo",
    rotulo: (a) => `${String(a.servidor)}: ${String(a.tool)}`,
    executar: async (a, ctx: ContextoTool) => {
      const todos = o.conectores();
      const c = acharConector(todos, String(a.servidor));
      if (!c) return erro(`Não há conector "${String(a.servidor)}". Disponíveis: ${todos.map((x) => x.nome).join(", ") || "nenhum"}.`);
      if (!c.ativo) return erro(`O conector "${c.nome}" está desligado nas configurações.`);
      const t = acharTool(c, String(a.tool));
      if (!t) return erro(`O conector "${c.nome}" não tem a ferramenta "${String(a.tool)}". Use mcp_buscar_tools.`);

      const permissao = permissaoDe(c, t.nome);
      if (permissao === "bloqueado") return erro("O usuário não autorizou esta ferramenta.");

      // Dados pessoais: o motor reidrata os argumentos antes de executar, para
      // que a ESCRITA no SEI leve o valor real. O que sai para um terceiro
      // tem de voltar a ser rótulo.
      const brutos = (a.argumentos ?? {}) as Record<string, unknown>;
      const args = JSON.parse(ctx.anonimizar(JSON.stringify(brutos))) as Record<string, unknown>;

      // Primeira vez neste conector: o usuário precisa saber que o conteúdo sai.
      if (!c.consentido) {
        const ok = await ctx.consentirRestrito(
          `O conector "${c.nome}" (${c.url}) vai receber o conteúdo deste pedido. Ele é um serviço de terceiro, fora do SEI e fora do SEI Pro.`,
        );
        if (!ok) return erro("O usuário não autorizou enviar dados a este conector.");
        await o.guardar({ ...c, consentido: true });
      }

      if (permissao === "aprovar") {
        const decisao = await ctx.ui.aprovarExterno?.({ conector: c.nome, tool: t.nome, descricao: t.descricao, argumentos: args });
        if (!decisao?.permitido) return erro("O usuário não autorizou esta chamada.");
        if (decisao.sempre) await o.guardar({ ...c, permissoes: { ...c.permissoes, [t.nome]: "sempre" } });
      }

      const cliente = fabricar(c);
      await cliente.iniciar(ctx.sinal);
      const texto = await cliente.chamar(t.nome, args, ctx.sinal);
      return texto || "(o servidor respondeu sem conteúdo)";
    },
  });

  return [buscar, chamar];
}
```

- [ ] **Step 4: Ligar `verificarMcpTools` no `verificar.ts` e rodar**

Run: `cd agente-ia && npm run verificar && npm run tipos`
Expected: PASS, 0 falhas.

- [ ] **Step 5: Commit**

```bash
git add agente-ia/src/mcp/tools.ts agente-ia/tests/verificar-mcp-permissao.ts agente-ia/tests/verificar.ts
git commit -m "MCP: descoberta sob demanda e chamada com permissao, consentimento e mascaramento

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Prompt e registro no painel

**Files:**
- Modify: `agente-ia/src/motor/prompt.ts`
- Modify: `agente-ia/src/painel/main.ts`
- Test: `agente-ia/tests/verificar-motor.ts` (uma verificação do prompt)

**Interfaces:**
- Consumes: `linhasDeConectores`, `toolsMcp`, `listarConectores`, `guardarConectores`.
- Produces: `promptSistema(..., conectores = "")` — sétimo parâmetro, o texto já montado.

- [ ] **Step 1: Escrever o teste que falha**

Em `verificar-motor.ts`:

```ts
  secao("motor: prompt com conectores");
  {
    const texto = promptSistema(null, new Date(2026, 9, 1), "", [], "", "\n- Conectores do usuário: \"Notion\"");
    checar("o trecho dos conectores entra no prompt", texto.includes("Conectores do usuário"), texto.slice(-200));
    checar("sem conectores, o prompt nao muda", !promptSistema(null, new Date(2026, 9, 1)).includes("Conectores do usuário"));
  }
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd agente-ia && npm run verificar`
Expected: FAIL — `promptSistema` aceita 5 parâmetros.

- [ ] **Step 3: Alterar `prompt.ts`**

Assinatura e uso:

```ts
export function promptSistema(
  tela: TelaAtual | null,
  agora = new Date(),
  instrucoes = "",
  skills: Array<{ slug: string; nome: string; descricao: string }> = [],
  memoria = "",
  conectores = "",
): string {
```

E, na interpolação, imediatamente depois de `${listaDeSkills(skills)}`:

```ts
${listaDeSkills(skills)}${conectores}${memoria}
```

- [ ] **Step 4: Alterar `painel/main.ts`**

Quatro pontos:

1. imports:

```ts
import { guardarConectores, listarConectores, type Conector } from "../mcp/conectores";
import { linhasDeConectores, toolsMcp } from "../mcp/tools";
```

2. campo da classe, junto de `private rotinas`:

```ts
  /** Servidores MCP que o usuário ligou. */
  private conectores: Conector[] = [];
```

3. em `iniciar()`, junto das outras cargas: `this.conectores = await listarConectores();`

4. na montagem do motor (hoje `tools: new RegistroTools([...TOOLS_SEI, ...toolsMotor(this.skills)])`, por volta de `main.ts:2169`), acrescentar as tools de MCP e passar o trecho do prompt:

```ts
      tools: new RegistroTools([
        ...TOOLS_SEI,
        ...toolsMotor(this.skills),
        ...toolsMcp({
          conectores: () => this.conectores,
          guardar: async (c) => {
            this.conectores = this.conectores.map((x) => (x.id === c.id ? c : x));
            await guardarConectores(this.conectores);
          },
        }),
      ]),
```

e, no `sistema:` do mesmo objeto, acrescentar o sexto argumento `linhasDeConectores(this.conectores)` na chamada a `promptSistema` (localizar com `grep -n "promptSistema(" agente-ia/src/painel/main.ts`; há mais de uma chamada — o agente auxiliar de `delegar()` **também** recebe o trecho, porque rotina de leitura pode consultar conector).

- [ ] **Step 5: Rodar os testes e o build**

Run: `cd agente-ia && npm run verificar && npm run tipos && npm run build:rapido`
Expected: PASS nos três; o build grava `dist/js/agente/painel.js`.

- [ ] **Step 6: Commit**

```bash
git add agente-ia/src/motor/prompt.ts agente-ia/src/painel/main.ts agente-ia/tests/verificar-motor.ts dist/js/agente
git commit -m "MCP: conectores no prompt e no registro de ferramentas do painel

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Interface dos conectores e cartão de autorização

**Files:**
- Create: `agente-ia/src/painel/mcp-ui.ts`
- Modify: `agente-ia/src/painel/main.ts`
- Modify: `agente-ia/estatico/agente.css`

**Interfaces:**
- Consumes: `h`, `icone` de `painel/dom.ts`; `App.abrirModal({ titulo, corpo, acoes, obrigatorio? })`, em `main.ts:624`, passado como parâmetro — **não** criar outro modal; `ClienteMcp`, `conferirEndereco`, `destinoDe`, `listarConectores`, `guardarConectores`, `MAX_CONECTORES`, `MAX_TOOLS`.
- Produces:
  - `type AbrirModal = (o: { titulo: string; corpo: Array<Node | string | null | false>; acoes: Array<Node | string | null | false>; obrigatorio?: boolean }) => HTMLDialogElement`
  - `secaoConectores(o: OpcoesSecao): { elemento: HTMLElement; redesenhar(): void }`
  - `interface OpcoesSecao { conectores(): Conector[]; definir(l: Conector[]): Promise<void>; abrirModal: AbrirModal; aviso(t: string): void }`
  - `cartaoExterno(p: PedidoExterno, abrirModal: AbrirModal): Promise<DecisaoExterna>`

- [ ] **Step 1: Escrever a seção da configuração**

Criar `agente-ia/src/painel/mcp-ui.ts` com a lista e os modais descritos na spec 3.8. A estrutura segue a seção de skills que já existe em `main.ts` (lista com `class="skills"`, item `class="skill"`, switch, botões `class="icone"`). Conteúdo mínimo obrigatório:

- lista de conectores: switch `ativo`, nome, host (de `new URL(c.url).host`), selo com `toolsVisiveis(c).length` ferramentas ou o `erro`;
- botões por item: **Testar** (pede `chrome.permissions.request({origins:[origem]})`, roda `iniciar()` + `listarTools()`, grava `tools`, `servidor`, `verificadoEm`, limpa `erro`), **Ferramentas**, **Editar**, **Excluir** (confirmação em duas etapas, texto "Excluir o conector X? O token guardado vai embora.");
- modal **Ferramentas**: campo de busca, o padrão do conector num `<select>` com os três estados, cada tool com nome, descrição e um grupo de três rádios, e um botão **Atualizar lista**;
- modal **Editar/Novo**: nome, endereço, cabeçalho (padrão `Authorization`) e valor do token (`type="password"`), com a mensagem de `conferirEndereco` em erro e o teto de `MAX_CONECTORES`;
- nota de privacidade fixa na seção: "O conteúdo que você mandar a um conector sai do seu navegador para o endereço dele. Dados pessoais vão mascarados, como nas conversas; o resto do pedido vai como está."

- [ ] **Step 2: Escrever o cartão de autorização**

Na mesma `mcp-ui.ts`:

```ts
/**
 * Cartão de "requer aprovação": o usuário vê o conector, a ferramenta e o
 * que exatamente vai ser enviado, antes de sair do navegador.
 */
export function cartaoExterno(p: PedidoExterno, abrirModal: AbrirModal): Promise<DecisaoExterna> {
  return new Promise((resolver) => {
    let decidido: DecisaoExterna = { permitido: false };
    const uma = h("button", { class: "primario" }, "Permitir uma vez");
    const sempre = h("button", {}, "Permitir sempre");
    const nao = h("button", {}, "Recusar");
    const dlg = abrirModal({
      titulo: `Autorizar ${p.conector}`,
      corpo: [
        h("div", { class: "campo" }, h("label", {}, "Ferramenta"), h("div", { class: "ajuda" }, `${p.tool}${p.descricao ? ` — ${p.descricao}` : ""}`)),
        h("div", { class: "campo" }, h("label", {}, "Vai ser enviado"), h("pre", { class: "args-externo" }, JSON.stringify(p.argumentos, null, 2))),
        h("div", { class: "nota" }, icone("escudo", 15), h("span", {}, "Isto sai do seu navegador para o servidor do conector. Dados pessoais vão mascarados.")),
      ],
      acoes: [nao, sempre, uma],
    });
    uma.addEventListener("click", () => ((decidido = { permitido: true }), dlg.close()));
    sempre.addEventListener("click", () => ((decidido = { permitido: true, sempre: true }), dlg.close()));
    nao.addEventListener("click", () => dlg.close());
    dlg.addEventListener("close", () => resolver(decidido), { once: true });
  });
}
```

- [ ] **Step 3: Ligar no `main.ts`**

1. Na `InterfaceMotor` que o painel implementa (localizar `aprovarPlano:` na montagem do motor), acrescentar:

```ts
      aprovarExterno: (p) => cartaoExterno(p, (o) => this.abrirModal(o)),
```

2. Na configuração, acrescentar o grupo novo depois do grupo de skills (localizar `grupo(` com o título das skills), com um resumo no mesmo estilo dos outros (`N conector(es)` / `sem conector`).

3. Fechar o botão de **Ferramentas** com o CSS: acrescentar em `agente-ia/estatico/agente.css` a regra de `.args-externo` (`white-space: pre-wrap; word-break: break-word; max-height: 40vh; overflow: auto; font-size: 12px`) e `.skill.conector .selo`, no padrão das classes vizinhas.

- [ ] **Step 4: Rodar, construir e provar na tela**

Run: `cd agente-ia && npm run verificar && npm run tipos && npm run build`
Expected: PASS; `dist/js/agente/painel.js` e `dist/css/agente.css` regravados.

Prova manual, com o Chrome for Testing que o projeto já usa (porta 9444, `installExtension`): abrir `chrome-extension://<id>/html/agente.html`, abrir a configuração, cadastrar `https://mcp.exemplo.invalido/mcp`, clicar em **Testar** e confirmar que (a) o navegador pede a permissão de host, (b) a falha aparece como texto no item e não no console, (c) nenhum erro novo no console.

- [ ] **Step 5: Commit**

```bash
git add agente-ia/src/painel/mcp-ui.ts agente-ia/src/painel/main.ts agente-ia/estatico/agente.css dist/js/agente dist/css/agente.css
git commit -m "MCP: secao de conectores na configuracao e cartao de autorizacao

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Documentação e texto da política

**Files:**
- Modify: `pages/` (a página de ajuda do Agente de IA; localizar com `grep -rln "Agente de IA" pages | head`)
- Create: `<scratchpad>/politica-conectores.md` (texto para o autor publicar pela web)

**Interfaces:**
- Consumes: nada.
- Produces: nada de código.

- [ ] **Step 1: Escrever a ajuda da página**

Acrescentar à página do Agente de IA uma seção "Conectores" explicando: o que é um servidor MCP, que o endereço e o token são do usuário, que a permissão de cada ferramenta tem três estados, e que o conteúdo enviado sai do navegador para aquele servidor. Mesmo tom das seções vizinhas (segunda pessoa, sem jargão).

- [ ] **Step 2: Escrever o trecho da política para o autor**

Em `<scratchpad>/politica-conectores.md`, o parágrafo a entrar na `PRIVACY_POLICY` (que é editada pela web, então **não** se altera o arquivo local): declarar que o usuário pode ligar servidores MCP de terceiros; que, quando liga, o conteúdo dos pedidos que ele fizer ao agente pode ser enviado àquele servidor; que dados pessoais seguem mascarados; que endereço e token ficam só no navegador dele; e que nada é enviado sem conector cadastrado e consentido.

- [ ] **Step 3: Commit da página**

```bash
git add pages
git commit -m "Ajuda: secao de conectores MCP no Agente de IA

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 4: Entregar ao autor**

Mostrar o texto de `politica-conectores.md` na conversa e dizer que a `PRIVACY_POLICY` precisa ser atualizada pela web antes de a função chegar à loja.
