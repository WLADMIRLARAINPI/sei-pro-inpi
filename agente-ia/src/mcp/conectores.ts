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
import { ESPELHOS, espelhar } from "../painel/espelho";

export type Permissao = "sempre" | "aprovar" | "bloqueado";

export type Auth =
  | { tipo: "nenhuma" }
  | { tipo: "token"; cabecalho: string; valor: string }
  /** Fase seguinte. O `valor` nunca é digitado: vem do fluxo OAuth. */
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

const PERMISSOES: Permissao[] = ["sempre", "aprovar", "bloqueado"];

const permissaoValida = (v: unknown): Permissao => (PERMISSOES.includes(v as Permissao) ? (v as Permissao) : "aprovar");

/**
 * Lê um conector guardado, defendendo-se do que estiver lá.
 *
 * O painel resolve permissão a cada chamada; um conector gravado por outra
 * versão, ou corrompido, não pode derrubar a conversa por falta de um campo.
 * Permissão desconhecida vira "requer aprovação" — na dúvida, pergunta-se.
 */
export function normalizarConector(bruto: unknown): Conector | null {
  const c = bruto as Partial<Conector>;
  if (!c || typeof c !== "object" || !c.id || !c.nome || !c.url) return null;
  const permissoes: Record<string, Permissao> = {};
  for (const [k, v] of Object.entries(c.permissoes ?? {})) permissoes[k] = permissaoValida(v);
  const auth: Auth =
    c.auth?.tipo === "token" || c.auth?.tipo === "oauth" ? (c.auth as Auth) : { tipo: "nenhuma" };
  return {
    id: c.id,
    nome: c.nome,
    url: c.url,
    ativo: c.ativo !== false,
    auth,
    padrao: permissaoValida(c.padrao),
    permissoes,
    ...(Array.isArray(c.tools) ? { tools: c.tools.filter((t) => t && typeof t.nome === "string") } : { tools: [] }),
    ...(c.servidor ? { servidor: c.servidor } : {}),
    ...(c.verificadoEm ? { verificadoEm: c.verificadoEm } : {}),
    ...(c.erro ? { erro: c.erro } : {}),
    ...(c.consentido ? { consentido: true } : {}),
  };
}

export async function listarConectores(): Promise<Conector[]> {
  try {
    const v = await chrome.storage.local.get(CHAVE);
    const lista = (v?.[CHAVE] as unknown[]) ?? [];
    return Array.isArray(lista) ? lista.map(normalizarConector).filter((c): c is Conector => c !== null) : [];
  } catch {
    return [];
  }
}

export async function guardarConectores(lista: Conector[]): Promise<void> {
  const guardada = lista.slice(0, MAX_CONECTORES);
  await chrome.storage.local.set({ [CHAVE]: guardada });
  void espelhar(ESPELHOS.conectores, guardada);
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
  return c.permissoes?.[tool] ?? c.padrao ?? "aprovar";
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
  if (!k) return undefined;
  return lista.find((c) => chave(c.nome) === k) ?? lista.find((c) => chave(c.nome).startsWith(k));
}

/** Aceita o nome do servidor ou o nome de exibição (o modelo usa os dois). */
export function acharTool(c: Conector, nome: string): ToolMcp | undefined {
  const k = chave(nome);
  const lista = c.tools ?? [];
  return lista.find((t) => t.nome === nome) ?? lista.find((t) => chave(t.nome) === k || nomeDeExibicao(c, t.nome) === nome.toLowerCase());
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
