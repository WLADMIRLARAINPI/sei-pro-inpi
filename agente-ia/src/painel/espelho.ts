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

export function configDoSync(bruto: Record<string, unknown>, local: Config): Config {
  return { ...local, ...(bruto as Partial<Config>), chave: local.chave };
}
