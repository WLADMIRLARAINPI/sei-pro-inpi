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
