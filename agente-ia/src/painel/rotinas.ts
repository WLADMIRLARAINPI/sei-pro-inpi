/**
 * Rotinas: trabalho que o agente faz sozinho, de tempos em tempos.
 *
 * "Toda segunda, os processos parados há mais de 30 dias" é trabalho que
 * ninguém lembra de fazer — e é exatamente o tipo de leitura chata que vale
 * automatizar.
 *
 * Um limite que não dá para contornar, e que o usuário precisa entender: a
 * extensão só existe com o navegador aberto e a sessão do SEI viva. Não há
 * servidor do SEI Pro guardando a sua sessão para agir de madrugada — e é
 * bom que não haja. O alarme do navegador (ver `dist/background.js`) AVISA na
 * hora marcada; quem executa é sempre o painel.
 *
 * A rotina é de LEITURA por padrão. Ela pode propor alterações e esperar a
 * aprovação, e pode — se o usuário autorizar, ferramenta por ferramenta —
 * executar sozinha. Essa última porta é a única por onde uma escrita no SEI
 * acontece sem ninguém na frente da tela, e é `avaliarPassos` que a guarda.
 */

import type { Efeito } from "../motor/tipos";

export type Frequencia = "manual" | "horaria" | "diaria" | "uteis" | "semanal" | "mensal";

/**
 * O que a rotina pode fazer no SEI.
 *
 * `leitura` é o padrão e o que toda rotina fazia antes desta versão.
 * `aprovar` propõe a escrita e PARA, esperando o usuário. `autonoma` aprova
 * sozinha, dentro das cercas de `avaliarPassos`.
 */
export type Alcance = "leitura" | "aprovar" | "autonoma";

export interface Execucao {
  em: number;
  ok: boolean;
  /** Primeiras linhas do resultado (ou o motivo da falha). */
  resumo: string;
  /** Custo em dólares desta execução. */
  custo: number;
  /** Ferramentas de escrita executadas (só em `autonoma`). */
  escritas?: string[];
}

export interface Rotina {
  id: string;
  nome: string;
  /** O pedido, como você digitaria na conversa. Pode ser vazio se houver skills. */
  pergunta: string;
  /** Ids de skills cadastradas, anexadas ao pedido como material de apoio. */
  skills?: string[];
  frequencia: Frequencia;
  /** "08:00" — antes disso no dia, a rotina ainda não está vencida. Ignorado em manual e horária. */
  hora: string;
  /** 1 = segunda ... 7 = domingo (só na semanal). */
  diaSemana?: number;
  /** 1 a 28 (só na mensal). */
  diaMes?: number;
  ativa: boolean;
  alcance: Alcance;
  /** Ferramentas de escrita autorizadas quando `alcance === "autonoma"`. */
  autorizadas?: string[];
  /** Notificar o navegador ao terminar. */
  avisar?: boolean;
  /** Teto de gasto por execução, em reais (0 ou ausente = sem teto próprio). */
  teto?: number;
  ultimaEm?: number;
  /** As 10 últimas execuções, da mais nova para a mais velha. */
  ultimas?: Execucao[];
  /** Falhas de escrita; em 1, a rotina se desliga (ver `rodarRotina` no painel). */
  falhas?: number;
}

const CHAVE = "agenteIA_rotinas";

export const MAX_EXECUCOES = 10;

export const DIAS = ["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"];

const FREQUENCIAS: Frequencia[] = ["manual", "horaria", "diaria", "uteis", "semanal", "mensal"];
const ALCANCES: Alcance[] = ["leitura", "aprovar", "autonoma"];

/**
 * Lê uma rotina guardada, inclusive na forma anterior a esta versão.
 *
 * Duas garantias: rotina antiga nasce como LEITURA (uma atualização não pode
 * dar poder de escrita a quem não pediu) e o `ultimoResultado` que aparecia
 * na tela vira a primeira execução do histórico, para não desaparecer.
 */
export function normalizarRotina(bruta: unknown): Rotina | null {
  const r = bruta as Partial<Rotina> & { ultimoResultado?: string };
  if (!r || typeof r !== "object" || !r.id || !r.nome) return null;
  if (!FREQUENCIAS.includes(r.frequencia as Frequencia)) return null;
  const alcance = ALCANCES.includes(r.alcance as Alcance) ? (r.alcance as Alcance) : "leitura";
  const ultimas = Array.isArray(r.ultimas)
    ? r.ultimas.slice(0, MAX_EXECUCOES)
    : r.ultimoResultado
      ? [{ em: r.ultimaEm ?? 0, ok: true, resumo: r.ultimoResultado, custo: 0 }]
      : [];
  return {
    id: r.id,
    nome: r.nome,
    pergunta: r.pergunta ?? "",
    ...(r.skills?.length ? { skills: r.skills } : {}),
    frequencia: r.frequencia as Frequencia,
    hora: /^\d{2}:\d{2}$/.test(r.hora ?? "") ? (r.hora as string) : "08:00",
    ...(r.diaSemana ? { diaSemana: r.diaSemana } : {}),
    ...(r.diaMes ? { diaMes: r.diaMes } : {}),
    ativa: r.ativa !== false,
    alcance,
    ...(alcance === "autonoma" && r.autorizadas?.length ? { autorizadas: r.autorizadas } : {}),
    // Rotina que altera o SEI sozinha avisa sempre: o usuário tem de saber.
    ...(r.avisar || alcance === "autonoma" ? { avisar: true } : {}),
    ...(r.teto ? { teto: r.teto } : {}),
    ...(r.ultimaEm ? { ultimaEm: r.ultimaEm } : {}),
    ...(ultimas.length ? { ultimas } : {}),
    ...(r.falhas ? { falhas: r.falhas } : {}),
  };
}

export async function listarRotinas(): Promise<Rotina[]> {
  try {
    const v = await chrome.storage.local.get(CHAVE);
    const lista = (v?.[CHAVE] as unknown[]) ?? [];
    return Array.isArray(lista) ? lista.map(normalizarRotina).filter((r): r is Rotina => r !== null) : [];
  } catch {
    return [];
  }
}

export async function guardarRotinas(lista: Rotina[]): Promise<void> {
  await chrome.storage.local.set({ [CHAVE]: lista });
}

/** Anota a execução no histórico (a mais nova primeiro) e marca `ultimaEm`. */
export function registrarExecucao(r: Rotina, e: Execucao): Rotina {
  return { ...r, ultimaEm: e.em, ultimas: [e, ...(r.ultimas ?? [])].slice(0, MAX_EXECUCOES) };
}

/** 1 = segunda ... 7 = domingo (o `getDay` do JS começa no domingo). */
const diaDaSemana = (d: Date): number => ((d.getDay() + 6) % 7) + 1;

const minutos = (hora: string): number => {
  const [h, m] = hora.split(":").map((x) => Number(x) || 0);
  return h * 60 + m;
};

/** O momento em que a rotina passou a estar vencida na janela atual, ou `null`. */
export function vencimento(r: Rotina, agora: Date): Date | null {
  // Manual não vence nunca: ela roda quando o usuário manda.
  if (r.frequencia === "manual") return null;
  // Horária: a janela é a hora cheia corrente. `ultimaEm` dentro da mesma hora
  // significa "já rodou nesta janela".
  if (r.frequencia === "horaria") return new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), agora.getHours(), 0);
  const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const naHora = new Date(hoje.getTime() + minutos(r.hora) * 60_000);
  if (r.frequencia === "diaria") return agora >= naHora ? naHora : null;
  // Dias úteis: segunda a sexta. Sem feriado — a extensão não tem o calendário
  // de cada órgão, e errar o feriado é pior que ignorá-lo.
  if (r.frequencia === "uteis") {
    if (diaDaSemana(agora) > 5) return null;
    return agora >= naHora ? naHora : null;
  }
  if (r.frequencia === "semanal") {
    const alvo = r.diaSemana ?? 1;
    // Volta até o último dia da semana pedido (hoje inclusive).
    const atraso = (diaDaSemana(agora) - alvo + 7) % 7;
    const dia = new Date(hoje.getTime() - atraso * 86_400_000);
    const quando = new Date(dia.getTime() + minutos(r.hora) * 60_000);
    return agora >= quando ? quando : null;
  }
  const alvo = Math.min(Math.max(r.diaMes ?? 1, 1), 28);
  const desteMes = new Date(agora.getFullYear(), agora.getMonth(), alvo, 0, 0);
  const quando = new Date(desteMes.getTime() + minutos(r.hora) * 60_000);
  if (agora >= quando) return quando;
  const mesPassado = new Date(agora.getFullYear(), agora.getMonth() - 1, alvo, 0, 0);
  return new Date(mesPassado.getTime() + minutos(r.hora) * 60_000);
}

/** A rotina tem instrução para rodar: texto, skills, ou os dois. */
export function temInstrucao(r: Rotina): boolean {
  return Boolean(r.pergunta.trim() || r.skills?.length);
}

/**
 * Rotinas que deveriam ter rodado e ainda não rodaram.
 *
 * Quem ficou uma semana de férias volta com UMA execução pendente, não sete:
 * o que interessa é a foto de agora, não o histórico do que não foi visto.
 */
export function vencidas(rotinas: Rotina[], agora = new Date()): Rotina[] {
  return rotinas.filter((r) => {
    if (!r.ativa || !temInstrucao(r)) return false;
    const quando = vencimento(r, agora);
    return Boolean(quando) && (!r.ultimaEm || r.ultimaEm < (quando as Date).getTime());
  });
}

/** Texto curto de quando a rotina roda, para a lista da configuração. */
export function descreverFrequencia(r: Rotina): string {
  if (r.frequencia === "manual") return "quando você mandar";
  if (r.frequencia === "horaria") return "a cada hora";
  if (r.frequencia === "uteis") return `de segunda a sexta, a partir das ${r.hora} (sem contar feriado)`;
  if (r.frequencia === "diaria") return `todo dia, a partir das ${r.hora}`;
  if (r.frequencia === "semanal") return `toda ${DIAS[(r.diaSemana ?? 1) - 1]}, a partir das ${r.hora}`;
  return `todo dia ${r.diaMes ?? 1}, a partir das ${r.hora}`;
}

export function descreverAlcance(a: Alcance): string {
  if (a === "leitura") return "só leitura";
  if (a === "aprovar") return "pode propor alterações e espera você aprovar";
  return "altera o SEI sem pedir aprovação";
}

export interface PassoParaAvaliar {
  tool: string;
  efeito: Efeito;
}

/**
 * Decide, sem interface nenhuma, se uma rotina pode aprovar este plano.
 *
 * Mora aqui, numa função pura, porque é a trava mais delicada do agente: a
 * única porta pela qual uma escrita no SEI acontece sem ninguém na frente da
 * tela. Testar isso não pode depender de navegador.
 *
 * Quatro recusas, nesta ordem:
 * 1. efeito irreversível ou de assinatura — nunca, nem listado em `autorizadas`;
 * 2. rotina que não é autônoma — ela não decide: quem decide é o usuário;
 * 3. autônoma sem lista de autorizadas — lista vazia é "nada autorizado";
 * 4. passo fora da lista — reprova o plano inteiro, não só o passo.
 */
export function avaliarPassos(r: Rotina, passos: PassoParaAvaliar[]): { aprovado: boolean; motivo?: string } {
  const escritas = passos.filter((p) => p.efeito !== "leitura" && p.efeito !== "interna" && p.efeito !== "externo");
  if (!escritas.length) return { aprovado: true };

  const grave = escritas.find((p) => p.efeito === "irreversivel" || p.efeito === "assinatura");
  if (grave) {
    return {
      aprovado: false,
      motivo: `"${grave.tool}" é ${grave.efeito === "assinatura" ? "assinatura" : "irreversível"} e uma rotina nunca faz isso sozinha. Peça ao usuário na conversa.`,
    };
  }
  if (r.alcance === "leitura") {
    return { aprovado: false, motivo: "Esta rotina é de leitura: ela não altera nada no SEI. Responda com o que foi encontrado." };
  }
  if (r.alcance === "aprovar") {
    return { aprovado: false, motivo: "Esta rotina precisa da aprovação do usuário para escrever." };
  }
  const autorizadas = r.autorizadas ?? [];
  const barrada = escritas.find((p) => !autorizadas.includes(p.tool));
  if (barrada) {
    return {
      aprovado: false,
      motivo: `"${barrada.tool}" não está entre as ferramentas autorizadas desta rotina (${autorizadas.join(", ") || "nenhuma"}).`,
    };
  }
  return { aprovado: true };
}

/** Nome do alarme do navegador de uma rotina. */
export const NOME_ALARME = "rotina:";

/**
 * Os alarmes que o navegador deve ter, um por rotina agendada.
 *
 * Rotina manual não tem alarme (ela roda quando o usuário manda), nem rotina
 * desligada ou sem instrução. O período é sempre de uma hora: é a menor
 * janela que existe (a frequência horária) e o `chrome.alarms` não é preciso
 * o bastante para valer um período menor — quem decide se a rotina está
 * vencida é `vencidas`, não o alarme.
 */
export function alarmesDe(rotinas: Rotina[]): Array<{ nome: string; periodoMin: number }> {
  return rotinas
    .filter((r) => r.ativa && r.frequencia !== "manual" && temInstrucao(r))
    .map((r) => ({ nome: `${NOME_ALARME}${r.id}`, periodoMin: 60 }));
}

/**
 * Título e corpo da notificação do navegador.
 *
 * O corpo é a primeira linha útil do resultado: quem recebe o aviso precisa
 * saber o que aconteceu sem abrir o painel.
 */
export function textoDoAviso(r: Rotina, e: Execucao, desligada: boolean): { titulo: string; corpo: string } {
  const primeira = e.resumo.split("\n").find((l) => l.trim())?.trim() ?? "";
  const corpo = desligada
    ? "A rotina foi desligada depois de uma falha ao alterar o SEI. Veja a conversa."
    : e.ok
      ? primeira.slice(0, 180) || "Terminou sem nada a relatar."
      : `Falhou: ${primeira.slice(0, 160) || "sem detalhe"}`;
  return { titulo: `Rotina: ${r.nome}`, corpo };
}

/**
 * O gasto desta execução passou do teto da rotina?
 *
 * O teto é em reais (é assim que o usuário pensa) e o custo vem em dólares do
 * provedor, então a cotação do dia entra na conta. Sem teto, nunca estoura —
 * continuam valendo os limites gerais por conversa e por dia.
 */
export function estourouTeto(r: Rotina, gastoDolares: number, cotacao: number): boolean {
  if (!r.teto || r.teto <= 0) return false;
  return gastoDolares * cotacao > r.teto;
}
