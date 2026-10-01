/**
 * Conectores MCP: permissão por ferramenta, nomes e endereços aceitos.
 *
 * A regra que não pode escapar: ferramenta bloqueada não executa E não
 * aparece na descoberta — o modelo não deve saber que ela existe.
 */

import { acharConector, acharTool, conferirEndereco, destinoDe, nomeDeExibicao, permissaoDe, toolsVisiveis, type Conector } from "../src/mcp/conectores";
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
