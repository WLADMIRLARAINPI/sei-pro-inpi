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
      ok: true,
      status: 200,
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
  const comErro = (async () =>
    ({
      ok: true,
      status: 200,
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
