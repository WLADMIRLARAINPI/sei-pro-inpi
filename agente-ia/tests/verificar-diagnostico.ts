/**
 * O log de auditoria do cartão de erro.
 *
 * Ele existe para ser COLADO num chamado, num grupo ou numa conversa com quem
 * mantém a extensão — então a regra que mais importa aqui é o que ele NÃO
 * pode levar junto: chave do serviço de IA, token de conector, conteúdo de
 * documento, número de processo, nome de pessoa.
 */

import { montarDiagnostico, textoDoDiagnostico } from "../src/painel/diagnostico";
import { checar, secao } from "./util";

const base = () => ({
  mensagem: "O OpenAI limitou o ritmo: espere 26 segundos.",
  erro: Object.assign(new Error("x"), { status: 429, corpo: '{"error":{"code":"rate_limit_exceeded"}}' }),
  config: {
    servico: "openai",
    url: "https://ia.interna.orgao.gov.br/v1",
    chave: "sk-proj-SEGREDO-QUE-NAO-PODE-VAZAR",
    modelo: "gpt-4o",
    modeloAuxiliar: "",
    nomes: true,
    cnpj: false,
    cache: true,
    memoria: true,
    dias: 30,
    guardar: true,
    reais: true,
    ajustes: { temperatura: 0.2 },
    instrucoes: "Trate o requerente sempre por Senhor Jose da Silva",
    limites: { porConversa: 5, porDia: 20 },
  },
  extensao: { nome: "SEI Pro", versao: "2.3" },
  navegador: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
  uso: { entrada: 74000, saida: 1200, custo: 0.0312, cache: 12000 },
  rodadas: 7,
  tela: { versao: "4.1.5", unidade: "SOG", processo: { protocolo: "99906.713-630.000032/2025-82" } },
  ferramentas: [
    { nome: "processos_listar", ok: true },
    { nome: "documento_ler", ok: false, erro: "documento restrito" },
  ],
  conectores: [{ nome: "Compras", ativo: true, url: "https://mcp.compras.gov.br/mcp" }],
  integridade: 1,
});

export function verificarDiagnostico(): void {
  secao("diagnostico: o que NUNCA pode vazar");
  {
    const texto = textoDoDiagnostico(montarDiagnostico(base() as never));
    checar("a chave do servico nao aparece", !texto.includes("SEGREDO-QUE-NAO-PODE-VAZAR") && !/sk-proj/.test(texto), texto.slice(0, 200));
    checar("as instrucoes do usuario nao aparecem", !/Jose da Silva/.test(texto), texto);
    checar("o numero do processo nao aparece", !texto.includes("99906.713-630.000032/2025-82"), texto);
    checar("a unidade nao aparece", !/\bSOG\b/.test(texto), texto);
    checar("o endereco interno vai so como host", texto.includes("ia.interna.orgao.gov.br") && !texto.includes("/v1"), texto);
  }

  secao("diagnostico: o que precisa estar la");
  {
    const d = montarDiagnostico(base() as never);
    const texto = textoDoDiagnostico(d);
    checar("versao da extensao e pacote", /SEI Pro 2\.3/.test(texto), texto);
    checar("navegador resumido", /Chrome 151/.test(texto) && !texto.includes("AppleWebKit"), texto);
    checar("servico e modelo", /openai/.test(texto) && /gpt-4o/.test(texto));
    checar("status HTTP do erro", /429/.test(texto));
    checar("a resposta do provedor", /rate_limit_exceeded/.test(texto));
    checar("a mensagem que o usuario viu", /limitou o ritmo/.test(texto));
    checar("tokens da conversa", /74\.?000|75\.200|74000/.test(texto), texto);
    checar("rodadas", /7 rodada/.test(texto));
    checar("versao do SEI", /4\.1\.5/.test(texto));
    checar("se havia processo aberto, sem dizer qual", /processo aberto: sim/i.test(texto), texto);
    checar("ultimas ferramentas com o resultado", /processos_listar.*ok/s.test(texto) && /documento_ler.*falhou/s.test(texto), texto);
    checar("conector pelo nome, sem token", /Compras/.test(texto));
    checar("achados de integridade", /integridade: 1/.test(texto));
  }

  secao("diagnostico: formato de colar");
  {
    const texto = textoDoDiagnostico(montarDiagnostico(base() as never));
    checar("cabe numa mensagem", texto.length < 1500, texto.length);
    checar("e um bloco legivel, linha a linha", texto.split("\n").length > 8);
    checar("comeca identificando o que e", /^Diagnóstico do Agente de IA/.test(texto), texto.slice(0, 60));
  }

  secao("diagnostico: sem dados, nao inventa");
  {
    const texto = textoDoDiagnostico(montarDiagnostico({ mensagem: "falhou", extensao: { nome: "SEI Pro Lab", versao: "2.3" }, navegador: "", config: { servico: "openrouter", modelo: "" } } as never));
    checar("nao quebra", texto.length > 20, texto);
    checar("e omite o que nao sabe", !/undefined|null|NaN/.test(texto), texto);
  }
}

/** O cartão de erro montado de verdade (linkedom). */
export async function verificarCartaoDeErro(): Promise<void> {
  const { DOMParser } = await import("linkedom");
  const doc = new DOMParser().parseFromString("<html><body></body></html>", "text/html") as unknown as Document;
  (globalThis as { document?: Document }).document = doc;
  const copiados: string[] = [];
  (globalThis as { navigator?: unknown }).navigator = { clipboard: { writeText: async (t: string) => void copiados.push(t) } };
  const { cartaoDeErro } = await import("../src/painel/erro-ui");

  secao("cartao de erro: os dois botoes");
  const diag = montarDiagnostico(base() as never);
  const cartao = cartaoDeErro("O OpenAI limitou o ritmo: espere 26 segundos.", diag);
  const botoes = [...cartao.querySelectorAll("button")];
  checar("tem exatamente dois botoes", botoes.length === 2, botoes.length);
  checar("e nenhum deles tem texto, so icone", botoes.every((b) => !(b.textContent ?? "").trim()), botoes.map((b) => b.textContent));
  checar("com rotulo acessivel", botoes.every((b) => (b.getAttribute("aria-label") ?? "").length > 5), botoes.map((b) => b.getAttribute("aria-label")));

  secao("cartao de erro: expandir");
  const detalhes = cartao.querySelector(".erro-detalhes") as HTMLElement;
  const expandir = botoes[1];
  checar("os detalhes comecam escondidos", detalhes.hidden === true);
  checar("e o botao diz que esta fechado", expandir.getAttribute("aria-expanded") === "false");
  expandir.click();
  checar("ao clicar, abre", (cartao.querySelector(".erro-detalhes") as HTMLElement).hidden === false);
  checar("e avisa a leitores de tela", expandir.getAttribute("aria-expanded") === "true");
  checar("mostrando o diagnostico", /resposta HTTP: 429/.test(detalhes.textContent ?? ""), (detalhes.textContent ?? "").slice(0, 120));
  expandir.click();
  checar("clicar de novo fecha", (cartao.querySelector(".erro-detalhes") as HTMLElement).hidden === true);

  secao("cartao de erro: copiar leva o erro E o log");
  botoes[0].click();
  await new Promise((r) => setTimeout(r, 10));
  checar("copiou alguma coisa", copiados.length === 1, copiados.length);
  checar("com a mensagem que o usuario viu", /limitou o ritmo/.test(copiados[0] ?? ""), copiados[0]?.slice(0, 80));
  checar("e com o diagnostico junto", /Diagn\u00F3stico do Agente de IA/.test(copiados[0] ?? ""));
  checar("sem a chave do servico", !/SEGREDO-QUE-NAO-PODE-VAZAR/.test(copiados[0] ?? ""));
  checar("sem o numero do processo", !(copiados[0] ?? "").includes("99906.713-630.000032/2025-82"));
}
