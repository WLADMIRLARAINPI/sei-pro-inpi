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

import {
  VERSAO_PROTOCOLO,
  type InfoServidor,
  type RespostaRpc,
  type ResultadoInitialize,
  type ResultadoToolsCall,
  type ResultadoToolsList,
  type ToolMcp,
} from "./protocolo";

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
        // fase seguinte vai ler, e hoje já ajuda a entender a recusa.
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

  private async enviar(
    corpo: unknown,
    sinal: AbortSignal,
  ): Promise<{ ok: boolean; status: number; corpo: string; id: number; autenticacao?: string }> {
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
        return lista.find((m) => m.id === id) ?? lista[0];
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
