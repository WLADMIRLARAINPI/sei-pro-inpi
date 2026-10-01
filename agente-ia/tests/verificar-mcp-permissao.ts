/**
 * Conectores MCP: permissão por ferramenta, nomes e endereços aceitos.
 *
 * A regra que não pode escapar: ferramenta bloqueada não executa E não
 * aparece na descoberta — o modelo não deve saber que ela existe.
 */

import { acharConector, acharTool, conferirEndereco, destinoDe, nomeDeExibicao, permissaoDe, toolsVisiveis, type Conector } from "../src/mcp/conectores";
import { linhasDeConectores, toolsMcp } from "../src/mcp/tools";
import type { ContextoTool } from "../src/motor/tools";
import { checar, secao } from "./util";

const tool = (nome: string) => ({ nome, descricao: `faz ${nome}`, esquema: { type: "object", properties: {} } });

const conector = (c: Partial<Conector> = {}): Conector => ({
  id: "c1",
  nome: "Notion",
  url: "https://mcp.notion.com/mcp",
  ativo: true,
  auth: { tipo: "nenhuma" },
  padrao: "aprovar",
  permissoes: {},
  tools: [tool("buscar"), tool("criar_pagina"), tool("apagar")],
  ...c,
});

export function verificarMcpPermissao(): void {
  secao("mcp: permissao por ferramenta");
  const c = conector({ permissoes: { buscar: "sempre", apagar: "bloqueado" } });
  checar("sempre", permissaoDe(c, "buscar") === "sempre");
  checar("bloqueado", permissaoDe(c, "apagar") === "bloqueado");
  checar("tool sem permissao propria herda o padrao do conector", permissaoDe(c, "criar_pagina") === "aprovar");
  checar("tool que apareceu depois tambem herda o padrao", permissaoDe(c, "inventada_agora") === "aprovar");
  const bloqueiaTudo = conector({ padrao: "bloqueado", permissoes: { buscar: "sempre" } });
  checar("padrao bloqueado nao atropela a permissao explicita", permissaoDe(bloqueiaTudo, "buscar") === "sempre");

  secao("mcp: bloqueada nao aparece na descoberta");
  const visiveis = toolsVisiveis(c).map((t) => t.nome);
  checar("some da lista", !visiveis.includes("apagar"), visiveis);
  checar("as outras ficam", visiveis.length === 2);
  checar("conector com padrao bloqueado mostra so as liberadas", toolsVisiveis(bloqueiaTudo).map((t) => t.nome).join() === "buscar");

  secao("mcp: nomes");
  checar("nome de exibicao e previsivel", nomeDeExibicao(conector(), "buscar") === "mcp_notion_buscar");
  const feio = conector({ nome: "Serviços Compras.GOV" });
  checar("acento, ponto e caixa saem do nome", nomeDeExibicao(feio, "ConsultarARP") === "mcp_servicos_compras_gov_consultararp", nomeDeExibicao(feio, "ConsultarARP"));
  const longo = conector({ nome: "x".repeat(60) });
  checar("nome longo cabe em 64 caracteres", nomeDeExibicao(longo, "y".repeat(60)).length <= 64);
  const comTool = conector({ tools: [tool("ConsultarARP")], nome: "Compras" });
  checar("acha a tool pelo nome do servidor", acharTool(comTool, "ConsultarARP")?.nome === "ConsultarARP");
  checar("acha a tool pelo nome de exibicao", acharTool(comTool, "mcp_compras_consultararp")?.nome === "ConsultarARP");
  checar("tool que nao existe devolve nada", acharTool(comTool, "inventada") === undefined);

  secao("mcp: achar conector pelo nome");
  const lista = [conector(), conector({ id: "c2", nome: "Compras Públicas" })];
  checar("casa sem acento e sem caixa", acharConector(lista, "compras publicas")?.id === "c2");
  checar("nome desconhecido devolve nada", acharConector(lista, "linear") === undefined);

  secao("mcp: enderecos aceitos");
  checar("https vale", conferirEndereco("https://mcp.exemplo.com/mcp").ok);
  checar("localhost vale", conferirEndereco("http://localhost:3000/mcp").ok);
  checar("127.0.0.1 vale", conferirEndereco("http://127.0.0.1:3000/mcp").ok);
  const http = conferirEndereco("http://mcp.exemplo.com/mcp");
  checar("http externo nao vale", http.ok === false && /https/.test(http.motivo), http);
  checar("endereco sem sentido nao vale", !conferirEndereco("isso nao e url").ok);
  const bom = conferirEndereco("https://mcp.exemplo.com/mcp");
  checar("origem volta para pedir permissao", bom.ok === true && bom.origem === "https://mcp.exemplo.com", bom);

  secao("mcp: destino");
  const comToken = conector({ auth: { tipo: "token", cabecalho: "Authorization", valor: "Bearer segredo" } });
  checar("token entra como cabecalho", destinoDe(comToken).cabecalhos?.Authorization === "Bearer segredo");
  checar("sem auth, sem cabecalho", Object.keys(destinoDe(conector()).cabecalhos ?? {}).length === 0);
}

/** Contexto mínimo: só o que as tools de MCP usam. */
const ctx = (ui: Record<string, unknown> = {}): ContextoTool =>
  ({
    sinal: new AbortController().signal,
    anonimizar: (x: string) => x.replace(/João da Silva/g, "[PESSOA_1]"),
    consentirConector: async () => true,
    ui: { aprovarExterno: async () => ({ permitido: true }), ...ui },
  }) as unknown as ContextoTool;

export async function verificarMcpTools(): Promise<void> {
  const chamado: Array<{ tool: string; args: Record<string, unknown> }> = [];
  const clienteFalso = () =>
    ({
      iniciar: async () => ({ nome: "n", versao: "1", protocolo: "2025-06-18" }),
      listarTools: async () => [tool("buscar")],
      chamar: async (t: string, a: Record<string, unknown>) => (chamado.push({ tool: t, args: a }), "resultado do servidor"),
    }) as never;

  const monta = (c: Conector, ui: Record<string, unknown> = {}) => {
    const guardados: Conector[] = [];
    const tools = toolsMcp({ conectores: () => [c], guardar: async (x) => void guardados.push(x), cliente: clienteFalso });
    return {
      buscar: tools.find((t) => t.nome === "mcp_buscar_tools")!,
      chamar: tools.find((t) => t.nome === "mcp_chamar")!,
      guardados,
      contexto: ctx(ui),
    };
  };

  secao("mcp: descoberta");
  {
    const { buscar, contexto } = monta(conector({ permissoes: { apagar: "bloqueado" }, consentido: true }));
    const r = (await buscar.executar({ busca: "" }, contexto)) as { ferramentas: Array<{ nome: string }> };
    const nomes = r.ferramentas.map((f) => f.nome);
    checar("descoberta nao mostra a bloqueada", !nomes.some((n) => n.includes("apagar")), nomes);
    checar("descoberta mostra as liberadas", nomes.length === 2, nomes);
    const filtrada = (await buscar.executar({ busca: "pagina" }, contexto)) as { ferramentas: Array<{ nome: string }> };
    checar("a busca filtra", filtrada.ferramentas.length === 1 && filtrada.ferramentas[0].nome.includes("criar_pagina"), filtrada);
    const vazia = (await buscar.executar({ busca: "coisa que nao existe" }, contexto)) as { erro?: string };
    checar("busca sem resultado explica", Boolean(vazia.erro), vazia);
  }

  secao("mcp: chamada e permissao");
  {
    const { chamar, contexto } = monta(conector({ permissoes: { buscar: "sempre" }, consentido: true }));
    const r = await chamar.executar({ servidor: "Notion", tool: "buscar", argumentos: { q: "x" } }, contexto);
    checar("sempre permitir executa", String(r).includes("resultado do servidor"), r);
  }
  {
    const { chamar, contexto } = monta(conector({ permissoes: { apagar: "bloqueado" }, consentido: true }));
    const r = (await chamar.executar({ servidor: "Notion", tool: "apagar", argumentos: {} }, contexto)) as { erro: string };
    checar("bloqueada nao executa", /não autorizou/i.test(r.erro), r);
  }
  {
    const vistos: unknown[] = [];
    const { chamar, contexto } = monta(conector({ consentido: true }), { aprovarExterno: async (p: unknown) => (vistos.push(p), { permitido: false }) });
    const r = (await chamar.executar({ servidor: "Notion", tool: "criar_pagina", argumentos: { titulo: "t" } }, contexto)) as { erro: string };
    checar("aprovar pergunta ao usuario", vistos.length === 1, vistos);
    checar("recusa devolve texto neutro, sem rodeio", /não autorizou/i.test(r.erro), r);
  }
  {
    const { chamar, guardados, contexto } = monta(conector({ consentido: true }), { aprovarExterno: async () => ({ permitido: true, sempre: true }) });
    await chamar.executar({ servidor: "Notion", tool: "criar_pagina", argumentos: {} }, contexto);
    checar("permitir sempre grava a permissao", guardados[0]?.permissoes.criar_pagina === "sempre", guardados[0]?.permissoes);
  }

  secao("mcp: o que sai do navegador");
  {
    chamado.length = 0;
    const { chamar, contexto } = monta(conector({ permissoes: { buscar: "sempre" }, consentido: true }));
    await chamar.executar({ servidor: "Notion", tool: "buscar", argumentos: { quem: "João da Silva" } }, contexto);
    checar("argumento com nome real sai mascarado", chamado[0].args.quem === "[PESSOA_1]", chamado[0].args);
  }
  {
    chamado.length = 0;
    let pedidos = 0;
    const tools = toolsMcp({
      conectores: () => [conector({ permissoes: { buscar: "sempre" } })],
      guardar: async () => undefined,
      cliente: clienteFalso,
    });
    const chamar = tools.find((t) => t.nome === "mcp_chamar")!;
    const contexto = { ...ctx(), consentirConector: async () => (pedidos += 1, false) } as unknown as ContextoTool;
    const r = (await chamar.executar({ servidor: "Notion", tool: "buscar", argumentos: {} }, contexto)) as { erro: string };
    checar("conector sem consentimento pergunta antes de enviar", pedidos === 1);
    checar("consentimento recusado nao chama o servidor", chamado.length === 0 && /não autorizou/i.test(r.erro), r);
  }

  secao("mcp: conector indisponivel");
  {
    const { chamar, contexto } = monta(conector({ ativo: false, consentido: true }));
    const r = (await chamar.executar({ servidor: "Notion", tool: "buscar", argumentos: {} }, contexto)) as { erro: string };
    checar("conector desligado avisa", /desligado/i.test(r.erro), r);
  }
  {
    const { chamar, contexto } = monta(conector({ consentido: true }));
    const r = (await chamar.executar({ servidor: "Servidor Que Nao Existe", tool: "buscar", argumentos: {} }, contexto)) as { erro: string };
    checar("conector desconhecido lista os que existem", /Notion/.test(r.erro), r);
  }

  secao("mcp: linha no prompt");
  {
    const texto = linhasDeConectores([conector({ consentido: true, permissoes: { apagar: "bloqueado" } })]);
    checar("diz o nome e quantas ferramentas", /Notion/.test(texto) && /2 ferramenta/.test(texto), texto);
    checar("nao cita a bloqueada", !/apagar/.test(texto), texto);
    checar("sem conector, sem trecho", linhasDeConectores([]) === "");
    checar("conector desligado nao entra", linhasDeConectores([conector({ ativo: false })]) === "");
  }
}
