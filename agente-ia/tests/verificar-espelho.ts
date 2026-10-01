/**
 * O espelho da configuração no `storage.sync`.
 *
 * O que não pode escapar: segredo não viaja, o que se reconstrói não ocupa
 * cota, e o que chega de outro computador não apaga o que só existe aqui.
 */

import {
  aplicarDoSync,
  CHAVE_CONFIG_SYNC,
  configDoSync,
  configParaSync,
  espelhar,
  espelharConfig,
  ESPELHOS,
  unirNaPrimeiraVez,
} from "../src/painel/espelho";
import type { Conector } from "../src/mcp/conectores";
import type { Config } from "../src/painel/main";
import type { Regra } from "../src/painel/regras";
import type { Rotina } from "../src/painel/rotinas";
import type { SkillUsuario } from "../src/painel/skills";
import { guardarConectores } from "../src/mcp/conectores";
import { guardarMemoria } from "../src/painel/memoria";
import { guardarRegras } from "../src/painel/regras";
import { guardarRotinas } from "../src/painel/rotinas";
import { guardarSkills } from "../src/painel/skills";
import { checar, secao } from "./util";

const skill = (s: Partial<SkillUsuario> = {}): SkillUsuario => ({
  id: "s1",
  nome: "Despacho",
  slug: "despacho",
  descricao: "encaminhar",
  texto: "x".repeat(5000),
  url: "https://github.com/o/r/blob/main/d.md",
  sincronizar: true,
  etag: 'W/"abc"',
  verificadaEm: 1,
  atualizadaEm: 2,
  ...s,
});

const conector = (c: Partial<Conector> = {}): Conector => ({
  id: "c1",
  nome: "Compras",
  url: "https://mcp.exemplo.gov.br/mcp",
  ativo: true,
  auth: { tipo: "token", cabecalho: "Authorization", valor: "Bearer segredo" },
  padrao: "aprovar",
  permissoes: { buscar: "sempre", apagar: "aprovar" },
  tools: [{ nome: "buscar", descricao: "busca", esquema: { type: "object", properties: {} } }],
  servidor: { nome: "s", versao: "1", protocolo: "2025-06-18" },
  verificadoEm: 9,
  consentido: true,
  ...c,
});

const rotina = (r: Partial<Rotina> = {}): Rotina => ({
  id: "r1",
  nome: "Parados",
  pergunta: "liste",
  frequencia: "uteis",
  hora: "08:00",
  ativa: true,
  alcance: "autonoma",
  autorizadas: ["processo_marcador"],
  avisar: true,
  teto: 2,
  ultimaEm: 123,
  ultimas: [{ em: 1, ok: true, resumo: "oito processos", custo: 0.02 }],
  falhas: 0,
  ...r,
});

export const regra = (id: string): Regra => ({ id, nome: `Regra ${id}`, ativa: true, efeito: "avisar", ferramentas: [], mensagem: "cuidado" });

const configCheia = (c: Partial<Config> = {}): Config =>
  ({
    reais: true,
    guardar: true,
    dias: 30,
    servico: "openrouter",
    url: "",
    chave: "sk-segredo-nao-pode-sair",
    modelo: "anthropic/claude-sonnet-4.5",
    nomes: true,
    cnpj: false,
    ajustes: {},
    instrucoes: "assim",
    limites: { porConversa: 0, porDia: 0 },
    cache: true,
    memoria: true,
    modeloAuxiliar: "",
    ...c,
  }) as Config;

export function verificarEspelho(): void {
  secao("espelho: o que NAO viaja");
  {
    const bruto = ESPELHOS.skills.paraSync(skill())!;
    checar("texto da skill fica em casa", !("texto" in bruto), bruto);
    checar("mas a url viaja", bruto.url === "https://github.com/o/r/blob/main/d.md");
    checar("etag e datas de conferencia nao viajam", !("etag" in bruto) && !("verificadaEm" in bruto));
    checar("skill de colecao nao gera chave", ESPELHOS.skills.paraSync(skill({ colecao: "c1" })) === null);
    checar("skill colada viaja sem o texto", (ESPELHOS.skills.paraSync(skill({ url: undefined }))! as { nome: string }).nome === "Despacho");

    const c = ESPELHOS.conectores.paraSync(conector())!;
    const comoTexto = JSON.stringify(c);
    checar("token do conector nao viaja", !comoTexto.includes("segredo"), comoTexto);
    checar("mas o cabecalho viaja", comoTexto.includes("Authorization"));
    checar("catalogo de ferramentas nao viaja", !("tools" in c));
    checar("so a permissao diferente do padrao viaja", JSON.stringify(c.permissoes) === '{"buscar":"sempre"}', c.permissoes);

    const r = ESPELHOS.rotinas.paraSync(rotina())!;
    checar("historico de execucoes nao viaja", !("ultimas" in r) && !("ultimaEm" in r), r);
    checar("mas o alcance e as autorizadas viajam", JSON.stringify(r.autorizadas) === '["processo_marcador"]');

    const f = ESPELHOS.fluxos.paraSync({
      id: "f1",
      nome: "Contrato",
      ativo: true,
      aplicaSe: { tipoProcessoContem: ["Contrato"] },
      etapas: [],
      origem: "manual",
      atualizadoEm: 1,
      modelos: [{ protocolo: "50300.018905/2018-67", quando: 1 }],
    } as never)!;
    checar("processos modelo do fluxo nao viajam", !("modelos" in f), f);

    const cfg = configParaSync(configCheia());
    checar("chave da IA nunca viaja", !JSON.stringify(cfg).includes("sk-segredo"), cfg);
    checar("instrucoes viajam", cfg.instrucoes === "assim");
    checar("a chave do item e spro_ia", CHAVE_CONFIG_SYNC === "spro_ia");
  }

  secao("espelho: chegada do sync preserva o que e local");
  {
    const local = skill({ texto: "o texto que esta aqui" });
    const vindo = { id: "s1", nome: "Despacho novo", slug: "despacho", descricao: "d", url: local.url, sincronizar: true };
    const juntado = ESPELHOS.skills.doSync(vindo, local)!;
    checar("o nome vem do sync", juntado.nome === "Despacho novo");
    checar("o texto continua o local", juntado.texto === "o texto que esta aqui");
    const semLocal = ESPELHOS.skills.doSync(vindo, undefined)!;
    checar("skill nova chega sem texto, para ser baixada pela url", semLocal.texto === "" && semLocal.url === local.url, semLocal);

    const conectorLocal = conector();
    const conectorVindo = { id: "c1", nome: "Compras", url: conectorLocal.url, ativo: false, padrao: "bloqueado", auth: { tipo: "token", cabecalho: "X-Chave" }, permissoes: {} };
    const juntoC = ESPELHOS.conectores.doSync(conectorVindo, conectorLocal)!;
    checar("o token local sobrevive", juntoC.auth.tipo === "token" && (juntoC.auth as { valor: string }).valor === "Bearer segredo", juntoC.auth);
    checar("o cabecalho vem do sync", (juntoC.auth as { cabecalho: string }).cabecalho === "X-Chave");
    checar("o catalogo local sobrevive", juntoC.tools?.length === 1);
    checar("o estado ligado/desligado vem do sync", juntoC.ativo === false);
    checar("conector novo do sync chega sem token e sem catalogo", (() => {
      const novo = ESPELHOS.conectores.doSync(conectorVindo, undefined)!;
      return novo.auth.tipo === "nenhuma" && !novo.tools?.length && !novo.consentido;
    })());

    const juntoR = ESPELHOS.rotinas.doSync({ id: "r1", nome: "Parados", pergunta: "liste", frequencia: "diaria", hora: "09:00", ativa: true, alcance: "leitura" }, rotina())!;
    checar("o historico local sobrevive", juntoR.ultimas?.length === 1 && juntoR.ultimaEm === 123, juntoR);
    checar("a frequencia vem do sync", juntoR.frequencia === "diaria" && juntoR.hora === "09:00");
    checar("alcance que desceu para leitura nao mantem autorizadas", !juntoR.autorizadas?.length, juntoR);

    const cfgJunto = configDoSync({ reais: true, dias: 90, servico: "openrouter", instrucoes: "novas" }, configCheia({ chave: "sk-local", dias: 7 }));
    checar("a chave local sobrevive", cfgJunto.chave === "sk-local");
    checar("o resto vem do sync", cfgJunto.dias === 90 && cfgJunto.instrucoes === "novas");
  }

  secao("espelho: identidade e prefixos");
  {
    const prefixos = Object.values(ESPELHOS).map((e) => e.prefixo);
    checar("todo prefixo comeca com spro_", prefixos.every((p) => p.startsWith("spro_")), prefixos);
    checar("nenhum prefixo e prefixo de outro", prefixos.every((p) => prefixos.filter((q) => q.startsWith(p)).length === 1), prefixos);
    checar("o id da skill e o id do registro", ESPELHOS.skills.id(skill()) === "s1");
  }
}

/**
 * `chrome.storage` de mentira: só o que o espelho usa.
 *
 * `bytes` finge o espaço já ocupado (para provar o guarda-chuva) e `falhar`
 * finge a recusa do navegador por cota.
 */
function navegadorFalso(inicial: Record<string, unknown> = {}, o: { falhar?: boolean; bytes?: number } = {}) {
  const dados: Record<string, unknown> = { ...inicial };
  const area = {
    get: async (chaves?: string | string[] | null) => {
      // Ordem alfabetica: o navegador nao promete a ordem de insercao, e o
      // codigo nao pode depender dela.
      if (!chaves) return Object.fromEntries(Object.keys(dados).sort().map((k) => [k, dados[k]]));
      const lista = Array.isArray(chaves) ? chaves : [chaves];
      return Object.fromEntries(lista.filter((k) => k in dados).map((k) => [k, dados[k]]));
    },
    set: async (itens: Record<string, unknown>) => {
      if (o.falhar) throw new Error("QUOTA_BYTES quota exceeded");
      Object.assign(dados, itens);
    },
    remove: async (chaves: string | string[]) => {
      for (const k of Array.isArray(chaves) ? chaves : [chaves]) delete dados[k];
    },
    getBytesInUse: async () => o.bytes ?? JSON.stringify(dados).length,
  };
  (globalThis as { chrome?: unknown }).chrome = { storage: { sync: area, local: area } };
  return dados;
}

export async function verificarEspelhoSync(): Promise<void> {
  secao("espelho: subir");
  {
    const dados = navegadorFalso();
    const r = await espelhar(ESPELHOS.regras, [regra("a"), regra("b")]);
    checar("gravou uma chave por registro", r.gravados === 2 && Object.keys(dados).length === 2, Object.keys(dados));
    checar("a chave usa o prefixo e o id", "spro_regra_a" in dados, Object.keys(dados));
    const denovo = await espelhar(ESPELHOS.regras, [regra("a"), regra("b")]);
    checar("nada mudou: nao gasta escrita", denovo.gravados === 0, denovo);
    const comUmaSo = await espelhar(ESPELHOS.regras, [regra("a")]);
    checar("registro que saiu da lista tem a chave removida", !("spro_regra_b" in dados) && comUmaSo.removidos === 1, Object.keys(dados));
  }
  {
    const dados = navegadorFalso();
    await espelhar(ESPELHOS.skills, [skill(), skill({ id: "s2", colecao: "c1" })]);
    checar("skill de colecao nao ocupa chave no sync", Object.keys(dados).join() === "spro_skill_s1", Object.keys(dados));
  }

  secao("espelho: aplicar de volta");
  {
    navegadorFalso({ spro_regra_z: { id: "z", nome: "Do outro computador", ativa: true, efeito: "avisar", ferramentas: [], mensagem: "m" } });
    const r = await aplicarDoSync(ESPELHOS.regras, [regra("a")]);
    checar("registro novo do sync entra", r.lista.some((x) => x.id === "z"), r.lista);
    checar("registro local que nao esta no sync SAI (exclusao propagada)", !r.lista.some((x) => x.id === "a"), r.lista);
    checar("avisa que mudou", r.mudou);
    const igual = await aplicarDoSync(ESPELHOS.regras, r.lista);
    checar("aplicar de novo nao muda nada", !igual.mudou);
  }
  {
    // O caso que mais importa: o que chega não pode levar o texto embora.
    navegadorFalso({ spro_skill_s1: { id: "s1", nome: "Despacho renomeado", slug: "despacho", descricao: "d", url: "https://github.com/o/r/blob/main/d.md", sincronizar: true } });
    const r = await aplicarDoSync(ESPELHOS.skills, [skill({ texto: "o texto que esta aqui" })]);
    checar("o texto local sobrevive a chegada do sync", r.lista[0].texto === "o texto que esta aqui", r.lista[0]);
    checar("e o nome foi atualizado", r.lista[0].nome === "Despacho renomeado");
  }

  secao("espelho: primeira vez (uniao por id)");
  {
    const dados = navegadorFalso({ spro_regra_z: { id: "z", nome: "Do outro", ativa: true, efeito: "avisar", ferramentas: [], mensagem: "m" } });
    const lista = await unirNaPrimeiraVez(ESPELHOS.regras, [regra("a")]);
    checar("o que so existe aqui fica", lista.some((x) => x.id === "a"), lista);
    checar("o que so existe no sync baixa", lista.some((x) => x.id === "z"), lista);
    checar("e o que estava aqui sobe para o sync", "spro_regra_a" in dados, Object.keys(dados));
  }

  secao("espelho: cota");
  {
    navegadorFalso({}, { bytes: 90_000 });
    const r = await espelhar(ESPELHOS.regras, [regra("a")]);
    checar("acima do teto, nao sobe", r.gravados === 0, r);
    checar("e explica por que", /espaço/i.test(r.aviso ?? ""), r.aviso);
  }
  {
    const dados = navegadorFalso({}, { falhar: true });
    const r = await espelhar(ESPELHOS.regras, [regra("a")]);
    checar("recusa do navegador nao lanca", r.gravados === 0 && Boolean(r.aviso), r);
    checar("e nada foi gravado pela metade", Object.keys(dados).length === 0);
  }
  {
    (globalThis as { chrome?: unknown }).chrome = { storage: {} };
    const r = await espelhar(ESPELHOS.regras, [regra("a")]);
    checar("sem storage.sync, segue em silencio", r.gravados === 0 && r.removidos === 0 && !r.aviso, r);
    const v = await aplicarDoSync(ESPELHOS.regras, [regra("a")]);
    checar("e aplicar de volta devolve o local intacto", v.lista.length === 1 && !v.mudou, v);
  }

  secao("espelho: a cota dos cenarios medidos na especificacao");
  {
    const dados = navegadorFalso();
    const nLembrancas = 30;
    await espelharConfig(configCheia());
    await espelhar(ESPELHOS.skills, Array.from({ length: 15 }, (_, i) => skill({ id: `s${i}` })));
    await espelhar(ESPELHOS.regras, Array.from({ length: 15 }, (_, i) => regra(`r${i}`)));
    await espelhar(
      ESPELHOS.memoria,
      Array.from({ length: nLembrancas }, (_, i) => ({ id: `l${i}`, texto: "m".repeat(240), quando: 1, origem: "agente" as const })),
    );
    await espelhar(ESPELHOS.rotinas, Array.from({ length: 8 }, (_, i) => rotina({ id: `ro${i}` })));
    await espelhar(
      ESPELHOS.conectores,
      Array.from({ length: 3 }, (_, i) => conector({ id: `c${i}`, permissoes: Object.fromEntries(Array.from({ length: 40 }, (_, j) => [`f${j}`, "sempre" as const])) })),
    );
    const bytes = Object.entries(dados).reduce((n, [k, v]) => n + k.length + JSON.stringify(v).length, 0);
    const maior = Math.max(...Object.entries(dados).map(([k, v]) => k.length + JSON.stringify(v).length));
    checar(`cenario pesado cabe nos 100 KB (${bytes} bytes)`, bytes < 102_400, bytes);
    checar(`nenhum item passa de 8 KB (maior: ${maior})`, maior < 8_192, maior);
    checar(`menos de 512 itens (${Object.keys(dados).length})`, Object.keys(dados).length < 512);
  }
}

/** Duas áreas separadas, como no navegador de verdade. */
function duasAreas() {
  const local: Record<string, unknown> = {};
  const sync: Record<string, unknown> = {};
  const area = (dados: Record<string, unknown>) => ({
    get: async (chaves?: string | string[] | null) => {
      // Ordem alfabetica: o navegador nao promete a ordem de insercao, e o
      // codigo nao pode depender dela.
      if (!chaves) return Object.fromEntries(Object.keys(dados).sort().map((k) => [k, dados[k]]));
      const lista = Array.isArray(chaves) ? chaves : [chaves];
      return Object.fromEntries(lista.filter((k) => k in dados).map((k) => [k, dados[k]]));
    },
    set: async (itens: Record<string, unknown>) => void Object.assign(dados, itens),
    remove: async (chaves: string | string[]) => {
      for (const k of Array.isArray(chaves) ? chaves : [chaves]) delete dados[k];
    },
    getBytesInUse: async () => JSON.stringify(dados).length,
  });
  (globalThis as { chrome?: unknown }).chrome = { storage: { local: area(local), sync: area(sync) } };
  return { local, sync };
}

/**
 * A ligação: `guardarX` grava no local E espelha no sync.
 *
 * É o passo que faz a função existir de verdade — sem ele, a camada de
 * espelho seria código correto que ninguém chama.
 */
export async function verificarEspelhoNosModulos(): Promise<void> {
  secao("espelho: guardar grava nos dois lugares");
  {
    const { local, sync } = duasAreas();
    await guardarRegras([regra("a")]);
    await new Promise((r) => setTimeout(r, 10));
    checar("a regra foi para o local", Array.isArray(local.agenteIA_regras), Object.keys(local));
    checar("e espelhada no sync", "spro_regra_a" in sync, Object.keys(sync));
  }
  {
    const { local, sync } = duasAreas();
    await guardarSkills([skill({ texto: "texto grande que nao deve viajar" })]);
    await new Promise((r) => setTimeout(r, 10));
    checar("o texto da skill fica no local", JSON.stringify(local.agenteIA_skills).includes("nao deve viajar"));
    checar("e NAO no sync", !JSON.stringify(sync).includes("nao deve viajar"), Object.keys(sync));
  }
  {
    const { local, sync } = duasAreas();
    await guardarConectores([conector()]);
    await new Promise((r) => setTimeout(r, 10));
    checar("o token do conector fica no local", JSON.stringify(local.agenteIA_mcp).includes("Bearer segredo"));
    checar("e NAO no sync", !JSON.stringify(sync).includes("Bearer segredo"), JSON.stringify(sync).slice(0, 120));
  }
  {
    const { sync } = duasAreas();
    await guardarRotinas([rotina()]);
    await new Promise((r) => setTimeout(r, 10));
    checar("o historico da rotina nao viaja", !JSON.stringify(sync).includes("oito processos"), JSON.stringify(sync).slice(0, 160));
  }
  {
    const { local, sync } = duasAreas();
    await guardarMemoria(Array.from({ length: 3 }, (_, i) => ({ id: `l${i}`, texto: "lembrete", quando: 1, origem: "usuario" as const })));
    await new Promise((r) => setTimeout(r, 10));
    checar("cada lembranca ganha a sua chave", Object.keys(sync).length === 3 && Array.isArray(local.agenteIA_memoria), Object.keys(sync));
  }
}

export async function verificarEspelhoRevisao(): Promise<void> {
  secao("espelho: a ordem da lista nao se embaralha");
  {
    // As chaves do sync voltam em ordem alfabetica; a lista que o usuario ve
    // tem de continuar na ordem em que ele cadastrou.
    navegadorFalso({
      spro_regra_c: { ...regra("c") },
      spro_regra_a: { ...regra("a") },
      spro_regra_b: { ...regra("b") },
    });
    const r = await aplicarDoSync(ESPELHOS.regras, [regra("c"), regra("a")]);
    checar("os locais ficam na ordem local", r.lista.slice(0, 2).map((x) => x.id).join() === "c,a", r.lista.map((x) => x.id));
    checar("e o novo entra no fim", r.lista[2]?.id === "b", r.lista.map((x) => x.id));
  }

  secao("espelho: servico de IA diferente em cada computador");
  {
    // Caso real: no trabalho o usuario usa OpenRouter; em casa, Gemini com
    // chave propria. Trazer o servico do outro computador deixaria a chave
    // daqui invalida e o agente simplesmente pararia de responder.
    const aqui = configCheia({ servico: "gemini", chave: "chave-do-gemini", modelo: "gemini-3-pro", url: "" });
    const junto = configDoSync({ servico: "openrouter", modelo: "anthropic/claude-sonnet-4.5", instrucoes: "novas", dias: 90 }, aqui);
    checar("o servico daqui e preservado", junto.servico === "gemini", junto.servico);
    checar("o modelo daqui tambem", junto.modelo === "gemini-3-pro", junto.modelo);
    checar("mas o resto vem do sync", junto.instrucoes === "novas" && junto.dias === 90);
    const semChave = configDoSync({ servico: "openrouter", modelo: "m-novo" }, configCheia({ servico: "gemini", chave: "" }));
    checar("computador novo (sem chave) aceita o servico do sync", semChave.servico === "openrouter" && semChave.modelo === "m-novo", semChave);
    const mesmoServico = configDoSync({ servico: "gemini", modelo: "gemini-3-flash" }, aqui);
    checar("mesmo servico: o modelo vem do sync", mesmoServico.modelo === "gemini-3-flash");
  }
}
