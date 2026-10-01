/**
 * Espelho da configuração no `chrome.storage.sync`.
 *
 * O `storage.local` continua sendo de onde a conversa lê — é ele que funciona
 * sem conta, sem rede e sem cota. O `sync` é um espelho com UMA CHAVE POR
 * REGISTRO, e é essa granularidade que resolve os dois problemas da cota do
 * navegador: cada item cabe nos 8 KB que o Chrome permite, e dois computadores
 * que editam coisas diferentes não se atropelam (o conflito fica contido no
 * registro que os dois mudaram, onde vale a última gravação).
 *
 * O que NÃO viaja, e por quê:
 * - a chave do serviço de IA e o token do conector: são segredos, e a política
 *   de privacidade promete que a chave nunca sai deste navegador;
 * - o texto das skills: é o que mais pesa (uma skill real da ANTAQ tem 26 mil
 *   caracteres) e a origem no GitHub basta para o outro computador buscar;
 * - o catálogo de ferramentas do conector: 49 KB num caso real, e se refaz com
 *   um clique em "Atualizar lista";
 * - o histórico de execuções das rotinas: é registro do que aconteceu NAQUELE
 *   computador, não configuração.
 */

import type { Conector, Permissao } from "../mcp/conectores";
import type { Fluxo } from "../fluxos/modelo";
import type { Config } from "./main";
import type { Lembranca } from "./memoria";
import type { Regra } from "./regras";
import type { Rotina } from "./rotinas";
import type { ColecaoSkills, SkillUsuario } from "./skills";

/** Teto prático: o navegador dá 102.400 bytes, e a margem é para crescer. */
export const TETO_SYNC = 85_000;

export const CHAVE_CONFIG_SYNC = "spro_ia";

/** Marca de que a união inicial já aconteceu neste navegador. */
export const CHAVE_MIGRADO = "spro_migrado";

export interface Espelhada<T> {
  /** Prefixo da chave no sync: `spro_skill_`. */
  prefixo: string;
  id(item: T): string;
  /** O recorte que viaja, ou `null` quando o registro não deve viajar. */
  paraSync(item: T): Record<string, unknown> | null;
  /** Remonta o registro juntando o que veio do sync com o que já existe aqui. */
  doSync(bruto: Record<string, unknown>, local: T | undefined): T | null;
}

/** Remove as chaves de valor `undefined`, que o JSON do sync não carrega. */
function limpo(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

const skills: Espelhada<SkillUsuario> = {
  prefixo: "spro_skill_",
  id: (s) => s.id,
  paraSync: (s) =>
    // Skill de coleção não viaja: a coleção (que viaja) a recria no outro
    // computador, e duplicá-la aqui faria a mesma skill chegar duas vezes.
    s.colecao ? null : limpo({ id: s.id, nome: s.nome, slug: s.slug, descricao: s.descricao, url: s.url, sincronizar: s.sincronizar }),
  doSync: (b, local) => ({
    ...(local ?? { texto: "" }),
    ...(b as unknown as SkillUsuario),
    // O texto é local: quem chega sem ele fica esperando a primeira
    // sincronização pela url (ver `sincronizarSkills`).
    texto: local?.texto ?? "",
    ...(local?.etag ? { etag: local.etag } : {}),
    ...(local?.verificadaEm ? { verificadaEm: local.verificadaEm } : {}),
  }),
};

const colecoes: Espelhada<ColecaoSkills> = {
  prefixo: "spro_colecao_",
  id: (c) => c.id,
  paraSync: (c) => limpo({ id: c.id, nome: c.nome, url: c.url, sincronizar: c.sincronizar }),
  doSync: (b, local) => ({ ...(local ?? {}), ...(b as unknown as ColecaoSkills) }),
};

const regras: Espelhada<Regra> = {
  prefixo: "spro_regra_",
  id: (r) => r.id,
  paraSync: (r) => ({ ...r }),
  doSync: (b) => b as unknown as Regra,
};

const memoria: Espelhada<Lembranca> = {
  // Uma chave por lembrança: trinta lembranças de 240 caracteres passam dos
  // 8 KB de um item só.
  prefixo: "spro_lembranca_",
  id: (l) => l.id,
  paraSync: (l) => ({ ...l }),
  doSync: (b) => b as unknown as Lembranca,
};

const rotinas: Espelhada<Rotina> = {
  prefixo: "spro_rotina_",
  id: (r) => r.id,
  paraSync: (r) =>
    limpo({
      id: r.id,
      nome: r.nome,
      pergunta: r.pergunta,
      skills: r.skills,
      frequencia: r.frequencia,
      hora: r.hora,
      diaSemana: r.diaSemana,
      diaMes: r.diaMes,
      ativa: r.ativa,
      alcance: r.alcance,
      autorizadas: r.autorizadas,
      avisar: r.avisar,
      teto: r.teto,
    }),
  doSync: (b, local) => {
    const vindo = b as unknown as Rotina;
    return {
      ...vindo,
      // Alcance que deixou de ser autônomo não carrega autorização nenhuma.
      ...(vindo.alcance === "autonoma" ? {} : { autorizadas: undefined }),
      ...(local?.ultimas ? { ultimas: local.ultimas } : {}),
      ...(local?.ultimaEm ? { ultimaEm: local.ultimaEm } : {}),
      ...(local?.falhas ? { falhas: local.falhas } : {}),
    };
  },
};

const conectores: Espelhada<Conector> = {
  prefixo: "spro_mcp_",
  id: (c) => c.id,
  paraSync: (c) => {
    // Só as permissões que DIFEREM do padrão: um conector com 60 ferramentas
    // todas em "sempre" cai de 2.120 para 365 bytes.
    const excecoes = Object.fromEntries(Object.entries(c.permissoes ?? {}).filter(([, v]) => v !== c.padrao));
    return limpo({
      id: c.id,
      nome: c.nome,
      url: c.url,
      ativo: c.ativo,
      padrao: c.padrao,
      // O NOME do cabeçalho viaja; o valor, nunca.
      auth: c.auth.tipo === "token" ? { tipo: "token", cabecalho: c.auth.cabecalho } : { tipo: c.auth.tipo },
      permissoes: excecoes,
    });
  },
  doSync: (b, local) => {
    const vindo = b as unknown as Conector;
    const auth =
      vindo.auth?.tipo === "token"
        ? { tipo: "token" as const, cabecalho: (vindo.auth as { cabecalho?: string }).cabecalho || "Authorization", valor: local?.auth.tipo === "token" ? local.auth.valor : "" }
        : local?.auth ?? { tipo: "nenhuma" as const };
    return {
      ...vindo,
      // Sem token guardado aqui, o conector chega como "sem autenticação": é
      // o usuário que digita o token neste computador.
      auth: auth.tipo === "token" && !auth.valor ? { tipo: "nenhuma" } : auth,
      permissoes: (vindo.permissoes ?? {}) as Record<string, Permissao>,
      ...(local?.tools ? { tools: local.tools } : {}),
      ...(local?.servidor ? { servidor: local.servidor } : {}),
      ...(local?.verificadoEm ? { verificadoEm: local.verificadoEm } : {}),
      ...(local?.consentido ? { consentido: true } : {}),
    };
  },
};

const fluxos: Espelhada<Fluxo> = {
  prefixo: "spro_fluxo_",
  id: (f) => f.id,
  paraSync: (f) => {
    const { modelos: _modelos, ...resto } = f as Fluxo & { modelos?: unknown };
    return { ...resto };
  },
  doSync: (b, local) => ({ ...(b as unknown as Fluxo), ...(local?.modelos ? { modelos: local.modelos } : {}) }),
};

export const ESPELHOS = { skills, colecoes, regras, memoria, rotinas, conectores, fluxos };

/** A configuração é um item só: tudo menos a chave do serviço de IA. */
export function configParaSync(c: Config): Omit<Config, "chave"> {
  const { chave: _chave, ...resto } = c;
  return resto;
}

/**
 * A configuração que o `local` passa a ter, com a chave daqui.
 *
 * Um cuidado que o caso real exige: a chave do serviço de IA é de UM serviço.
 * Se este computador usa Gemini com chave própria e o outro usa OpenRouter,
 * trazer o serviço de lá deixaria a chave daqui inválida e o agente pararia de
 * responder sem explicação. Então, quando o serviço difere e já existe chave
 * aqui, o serviço, o endereço e os modelos daqui são preservados — o resto
 * (instruções, limites, privacidade, cache) vem do sync como de hábito.
 */
export function configDoSync(bruto: Record<string, unknown>, local: Config): Config {
  const vindo = bruto as Partial<Config>;
  const outroServico = Boolean(vindo.servico) && vindo.servico !== local.servico;
  const preservar: Partial<Config> =
    outroServico && local.chave ? { servico: local.servico, url: local.url, modelo: local.modelo, modeloAuxiliar: local.modeloAuxiliar } : {};
  return { ...local, ...vindo, ...preservar, chave: local.chave };
}

// ------------------------------------------------------------ o espelho em si

/** Onde avisar o usuário quando a cota não permitir subir (ver `aoAvisar`). */
let ouvinteDeAviso: ((texto: string) => void) | null = null;

/** O painel registra aqui para mostrar o aviso da cota uma vez por sessão. */
export function aoAvisar(f: (texto: string) => void): void {
  ouvinteDeAviso = f;
}

const AVISO_COTA =
  "A configuração passou do espaço que o navegador reserva para sincronizar. O que já está sincronizado continua valendo; o que vier agora fica só neste computador.";

/** A área de sincronização, ou `null` quando o navegador não a oferece. */
function areaSync(): chrome.storage.SyncStorageArea | null {
  try {
    return chrome.storage?.sync ?? null;
  } catch {
    return null;
  }
}

export interface ResultadoEspelho {
  gravados: number;
  removidos: number;
  /** Mensagem para o usuário quando não foi possível subir. */
  aviso?: string;
}

/**
 * Sobe a lista para o `sync`: uma chave por registro.
 *
 * Grava só o que mudou (escrita no `sync` é limitada a 1.800 por hora) e
 * remove as chaves do prefixo que não correspondem mais a nenhum registro —
 * é assim que a exclusão feita aqui chega ao outro computador.
 *
 * Nunca lança: a gravação no `local` já aconteceu, e o espelho que falha é um
 * aviso, não um erro.
 */
export async function espelhar<T>(e: Espelhada<T>, lista: T[]): Promise<ResultadoEspelho> {
  const area = areaSync();
  if (!area) return { gravados: 0, removidos: 0 };
  try {
    const desejado = new Map<string, Record<string, unknown>>();
    for (const item of lista) {
      const recorte = e.paraSync(item);
      if (recorte) desejado.set(`${e.prefixo}${e.id(item)}`, recorte);
    }
    const atual = await area.get(null);
    const minhas = Object.keys(atual).filter((k) => k.startsWith(e.prefixo));
    const sobrando = minhas.filter((k) => !desejado.has(k));
    const mudados = Object.fromEntries([...desejado].filter(([k, v]) => JSON.stringify(atual[k]) !== JSON.stringify(v)));

    if (sobrando.length) await area.remove(sobrando);
    if (!Object.keys(mudados).length) return { gravados: 0, removidos: sobrando.length };

    // Guarda-chuva: perto do teto, para de subir em vez de deixar o navegador
    // recusar a gravação em silêncio.
    const usados = await area.getBytesInUse(null).catch(() => 0);
    if (usados > TETO_SYNC) {
      ouvinteDeAviso?.(AVISO_COTA);
      return { gravados: 0, removidos: sobrando.length, aviso: AVISO_COTA };
    }
    await area.set(mudados);
    return { gravados: Object.keys(mudados).length, removidos: sobrando.length };
  } catch {
    ouvinteDeAviso?.(AVISO_COTA);
    return { gravados: 0, removidos: 0, aviso: AVISO_COTA };
  }
}

/** Lê as chaves do prefixo e devolve a lista que o `local` deve passar a ter. */
async function daArea<T>(e: Espelhada<T>, local: T[], removerAusentes: boolean): Promise<{ lista: T[]; mudou: boolean }> {
  const area = areaSync();
  if (!area) return { lista: local, mudou: false };
  try {
    const tudo = await area.get(null);
    const vindos = new Map(
      Object.entries(tudo)
        .filter(([k]) => k.startsWith(e.prefixo))
        .map(([k, v]) => [k.slice(e.prefixo.length), v as Record<string, unknown>]),
    );
    const nova: T[] = [];
    // A ORDEM é a de cá: o navegador não promete a ordem das chaves, e a lista
    // que o usuário vê (skills, regras, rotinas) não pode se reembaralhar a
    // cada abertura do painel. O que vem de fora entra no fim.
    for (const item of local) {
      const id = e.id(item);
      const bruto = vindos.get(id);
      if (bruto) {
        const junto = e.doSync(bruto, item);
        if (junto) nova.push(junto);
      } else if (!removerAusentes) {
        // União da primeira vez: o que ainda não subiu fica.
        nova.push(item);
      }
    }
    const conhecidos = new Set(local.map((x) => e.id(x)));
    for (const [id, bruto] of vindos) {
      if (conhecidos.has(id)) continue;
      const junto = e.doSync(bruto, undefined);
      if (junto) nova.push(junto);
    }
    const mudou = JSON.stringify(local) !== JSON.stringify(nova);
    return { lista: nova, mudou };
  } catch {
    return { lista: local, mudou: false };
  }
}

/** O que o `local` passa a ter depois de aplicar o `sync` (exclusão inclusa). */
export function aplicarDoSync<T>(e: Espelhada<T>, local: T[]): Promise<{ lista: T[]; mudou: boolean }> {
  return daArea(e, local, true);
}

/**
 * Primeira execução neste navegador: união por id.
 *
 * Ninguém tem chaves `spro_*` antes desta versão, e os registros não têm data
 * de alteração — então o que existe só aqui sobe, o que existe só lá baixa, e
 * o que existe nos dois fica com a versão do `sync`. É o único momento em que
 * a ausência no `sync` NÃO significa exclusão.
 */
export async function unirNaPrimeiraVez<T>(e: Espelhada<T>, local: T[]): Promise<T[]> {
  const { lista } = await daArea(e, local, false);
  await espelhar(e, lista);
  return lista;
}

export async function espelharConfig(c: Config): Promise<ResultadoEspelho> {
  const area = areaSync();
  if (!area) return { gravados: 0, removidos: 0 };
  try {
    const recorte = configParaSync(c);
    const atual = (await area.get(CHAVE_CONFIG_SYNC))[CHAVE_CONFIG_SYNC];
    if (JSON.stringify(atual) === JSON.stringify(recorte)) return { gravados: 0, removidos: 0 };
    const usados = await area.getBytesInUse(null).catch(() => 0);
    if (usados > TETO_SYNC) {
      ouvinteDeAviso?.(AVISO_COTA);
      return { gravados: 0, removidos: 0, aviso: AVISO_COTA };
    }
    await area.set({ [CHAVE_CONFIG_SYNC]: recorte });
    return { gravados: 1, removidos: 0 };
  } catch {
    ouvinteDeAviso?.(AVISO_COTA);
    return { gravados: 0, removidos: 0, aviso: AVISO_COTA };
  }
}

/** A configuração que o `local` deve passar a ter, com a chave daqui. */
export async function aplicarConfigDoSync(local: Config): Promise<{ config: Config; mudou: boolean }> {
  const area = areaSync();
  if (!area) return { config: local, mudou: false };
  try {
    const bruto = (await area.get(CHAVE_CONFIG_SYNC))[CHAVE_CONFIG_SYNC] as Record<string, unknown> | undefined;
    if (!bruto) return { config: local, mudou: false };
    const config = configDoSync(bruto, local);
    return { config, mudou: JSON.stringify(config) !== JSON.stringify(local) };
  } catch {
    return { config: local, mudou: false };
  }
}
