/**
 * As duas ferramentas que dão acesso aos conectores MCP.
 *
 * Por que duas, e não uma por ferramenta do servidor: o esquema de todas as
 * ferramentas de todos os conectores iria no pedido de CADA rodada. Com
 * `mcp_buscar_tools`, o custo fixo é uma linha por conector, e o esquema
 * chega quando o modelo decide usar. É o mesmo arranjo das skills: a lista é
 * curta, o conteúdo vem sob demanda.
 */

import { ClienteMcp } from "./cliente";
import { acharConector, acharTool, destinoDe, nomeDeExibicao, permissaoDe, toolsVisiveis, type Conector } from "./conectores";
import { s } from "../motor/esquema";
import { definirTool, type ContextoTool, type DefTool } from "../motor/tools";

export interface OpcoesToolsMcp {
  conectores(): Conector[];
  /** Grava a mudança de um conector (hoje: "permitir sempre" e o consentimento). */
  guardar(c: Conector): Promise<void>;
  /** Trocável nos testes. */
  cliente?(c: Conector): ClienteMcp;
}

const MAX_ACHADAS = 10;

const ativos = (lista: Conector[]): Conector[] => lista.filter((c) => c.ativo && (c.tools?.length ?? 0) > 0);

/** O trecho do prompt de sistema: uma linha por conector ligado. */
export function linhasDeConectores(lista: Conector[]): string {
  const uteis = ativos(lista).filter((c) => toolsVisiveis(c).length > 0);
  if (!uteis.length) return "";
  const linhas = uteis
    .map((c) => {
      const vis = toolsVisiveis(c);
      const amostra = vis.slice(0, 8).map((t) => t.nome).join(", ");
      return `  - "${c.nome}" — ${vis.length} ferramenta${vis.length > 1 ? "s" : ""}: ${amostra}${vis.length > 8 ? ", ..." : ""}`;
    })
    .join("\n");
  return `\n- Conectores do usuário (servidores MCP). Para usar: mcp_buscar_tools para ver os parâmetros, depois mcp_chamar. Eles NÃO são o SEI:\n${linhas}`;
}

function erro(mensagem: string): { erro: string } {
  return { erro: mensagem };
}

export function toolsMcp(o: OpcoesToolsMcp): DefTool[] {
  const fabricar = o.cliente ?? ((c: Conector) => new ClienteMcp(destinoDe(c)));

  const buscar = definirTool({
    nome: "mcp_buscar_tools",
    descricao:
      "Mostra os parâmetros das ferramentas dos conectores do usuário (servidores MCP). Use antes de mcp_chamar, filtrando pelo assunto. NÃO use para o SEI: as ferramentas do SEI já estão todas disponíveis.",
    parametros: s.objeto({
      "servidor?": s.texto({ descricao: "Nome do conector, como aparece na lista. Em branco: procura em todos." }),
      "busca?": s.texto({ descricao: 'Palavras do que você quer fazer (ex.: "criar página"). Em branco: as primeiras.' }),
    }),
    efeito: "interna",
    rotulo: (a) => `Procurando ferramentas${a.servidor ? ` em ${String(a.servidor)}` : ""}`,
    executar: async (a) => {
      const lista = ativos(o.conectores());
      if (!lista.length) return erro("O usuário não tem nenhum conector ligado.");
      const alvo = a.servidor ? acharConector(lista, String(a.servidor)) : undefined;
      if (a.servidor && !alvo) return erro(`Não há conector "${String(a.servidor)}". Ligados: ${lista.map((c) => c.nome).join(", ")}.`);
      const termos = String(a.busca ?? "")
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
      const achadas: Array<{ nome: string; servidor: string; descricao: string; parametros: unknown }> = [];
      for (const c of alvo ? [alvo] : lista) {
        for (const t of toolsVisiveis(c)) {
          const alvoTexto = `${t.nome} ${t.descricao}`.toLowerCase();
          if (termos.length && !termos.some((termo) => alvoTexto.includes(termo))) continue;
          achadas.push({ nome: nomeDeExibicao(c, t.nome), servidor: c.nome, descricao: t.descricao, parametros: t.esquema });
          if (achadas.length >= MAX_ACHADAS) break;
        }
        if (achadas.length >= MAX_ACHADAS) break;
      }
      if (!achadas.length) return erro("Nenhuma ferramenta casou com a busca. Tente outras palavras ou liste sem busca.");
      return { ferramentas: achadas, como_chamar: "mcp_chamar com servidor, tool e argumentos" };
    },
  });

  const chamar = definirTool({
    nome: "mcp_chamar",
    descricao:
      "Executa uma ferramenta de um conector do usuário (servidor MCP). Confira os parâmetros com mcp_buscar_tools antes. O conteúdo enviado sai do navegador para o servidor do conector; dados pessoais vão mascarados.",
    parametros: s.objeto({
      servidor: s.texto({ descricao: "Nome do conector." }),
      tool: s.texto({ descricao: "Nome da ferramenta, como mcp_buscar_tools devolveu." }),
      "argumentos?": s.livre({ descricao: "Parâmetros da ferramenta, no formato que o esquema dela pede." }),
    }),
    efeito: "externo",
    rotulo: (a) => `${String(a.servidor)}: ${String(a.tool)}`,
    executar: async (a, ctx: ContextoTool) => {
      const todos = o.conectores();
      const c = acharConector(todos, String(a.servidor));
      if (!c) return erro(`Não há conector "${String(a.servidor)}". Disponíveis: ${todos.map((x) => x.nome).join(", ") || "nenhum"}.`);
      if (!c.ativo) return erro(`O conector "${c.nome}" está desligado nas configurações.`);
      const t = acharTool(c, String(a.tool));
      if (!t) return erro(`O conector "${c.nome}" não tem a ferramenta "${String(a.tool)}". Use mcp_buscar_tools.`);

      const permissao = permissaoDe(c, t.nome);
      if (permissao === "bloqueado") return erro("O usuário não autorizou esta ferramenta.");

      // Dados pessoais: o motor reidrata os argumentos antes de executar, para
      // que a escrita no SEI leve o valor real. O que sai para um terceiro
      // tem de voltar a ser rótulo.
      const brutos = (a.argumentos ?? {}) as Record<string, unknown>;
      const args = JSON.parse(ctx.anonimizar(JSON.stringify(brutos))) as Record<string, unknown>;

      // Primeira vez neste conector: o usuário precisa saber que o conteúdo sai.
      if (!c.consentido) {
        const ok = await ctx.consentirConector(
          `O conector "${c.nome}" (${c.url}) vai receber o conteúdo deste pedido. Ele é um serviço de terceiro, fora do SEI e fora do SEI Pro.`,
        );
        if (!ok) return erro("O usuário não autorizou enviar dados a este conector.");
        await o.guardar({ ...c, consentido: true });
      }

      if (permissao === "aprovar") {
        const decisao = await ctx.ui.aprovarExterno?.({ conector: c.nome, tool: t.nome, descricao: t.descricao, argumentos: args });
        if (!decisao?.permitido) return erro("O usuário não autorizou esta chamada.");
        if (decisao.sempre) await o.guardar({ ...c, permissoes: { ...c.permissoes, [t.nome]: "sempre" } });
      }

      const cliente = fabricar(c);
      await cliente.iniciar(ctx.sinal);
      const texto = await cliente.chamar(t.nome, args, ctx.sinal);
      return texto || "(o servidor respondeu sem conteúdo)";
    },
  });

  return [buscar, chamar];
}
