/**
 * O espelho da configuração no `storage.sync`.
 *
 * O que não pode escapar: segredo não viaja, o que se reconstrói não ocupa
 * cota, e o que chega de outro computador não apaga o que só existe aqui.
 */

import { CHAVE_CONFIG_SYNC, configDoSync, configParaSync, ESPELHOS } from "../src/painel/espelho";
import type { Conector } from "../src/mcp/conectores";
import type { Config } from "../src/painel/main";
import type { Regra } from "../src/painel/regras";
import type { Rotina } from "../src/painel/rotinas";
import type { SkillUsuario } from "../src/painel/skills";
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
