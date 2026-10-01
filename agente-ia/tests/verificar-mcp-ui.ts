/**
 * A tela dos conectores MCP, montada de verdade (linkedom).
 *
 * Existe porque a prova no navegador não é possível aqui: o Chrome não deixa
 * a automação navegar para `html/agente.html`, que é o painel lateral e não é
 * recurso de acesso web. Então o que se verifica é o DOM que o usuário vê e
 * clica — lista, cadastro, os três estados e o cartão de autorização.
 */

import { DOMParser } from "linkedom";
import { cartaoExterno, secaoConectores, type AbrirModal } from "../src/painel/mcp-ui";
import type { Conector } from "../src/mcp/conectores";
import { checar, secao } from "./util";

const doc = new DOMParser().parseFromString("<html><body></body></html>", "text/html") as unknown as Document;
(globalThis as { document?: Document }).document = doc;

/** O linkedom não tem `<dialog>` com close/showModal: o bastante para o teste. */
interface DialogFalso extends HTMLElement {
  close(): void;
  aberto: boolean;
}

function fabricarModal(): { abrirModal: AbrirModal; ultimo: () => DialogFalso | null } {
  let ultimo: DialogFalso | null = null;
  const abrirModal: AbrirModal = (o) => {
    const dlg = doc.createElement("div") as unknown as DialogFalso;
    const ouvintes: Array<() => void> = [];
    dlg.aberto = true;
    dlg.close = () => {
      dlg.aberto = false;
      for (const f of ouvintes) f();
    };
    (dlg as unknown as { addEventListener: (t: string, f: () => void) => void }).addEventListener = (tipo, f) => {
      if (tipo === "close") ouvintes.push(f);
    };
    for (const n of [...o.corpo, ...o.acoes]) if (n && typeof n !== "string") dlg.append(n);
    doc.body.append(dlg);
    ultimo = dlg;
    return dlg as unknown as HTMLDialogElement;
  };
  return { abrirModal, ultimo: () => ultimo };
}

const botao = (raiz: ParentNode, texto: string): HTMLButtonElement | undefined =>
  [...raiz.querySelectorAll("button")].find((b) => b.textContent === texto) as HTMLButtonElement | undefined;

const tool = (nome: string) => ({ nome, descricao: `faz ${nome}`, esquema: { type: "object", properties: {} } });

export async function verificarMcpUi(): Promise<void> {
  secao("mcp/ui: lista");
  {
    let guardados: Conector[] = [];
    const { abrirModal } = fabricarModal();
    const secaoUI = secaoConectores({
      conectores: () => guardados,
      definir: async (l) => void (guardados = l),
      abrirModal,
      aviso: () => undefined,
    });
    checar("sem conector, explica o que e um conector", /servidor MCP/.test(secaoUI.elemento.textContent ?? ""), secaoUI.elemento.textContent?.slice(0, 80));
    checar("tem o botao de cadastrar", Boolean(botao(secaoUI.elemento, "Novo conector")));
    checar("a nota de privacidade aparece na secao", /sai do seu navegador/.test(secaoUI.elemento.textContent ?? ""));

    guardados = [
      {
        id: "c1",
        nome: "Compras",
        url: "https://mcp.compras.gov.br/mcp",
        ativo: true,
        auth: { tipo: "token", cabecalho: "Authorization", valor: "Bearer x" },
        padrao: "aprovar",
        permissoes: { apagar: "bloqueado" },
        tools: [tool("buscar"), tool("apagar")],
      },
    ];
    secaoUI.redesenhar();
    const item = secaoUI.elemento.querySelector(".skill.conector");
    checar("o conector entra na lista", Boolean(item));
    checar("conta so as ferramentas visiveis", item?.querySelector("code")?.textContent === "1 ferramenta(s)", item?.querySelector("code")?.textContent);
    checar("diz que ha token guardado, sem mostra-lo", /token salvo/.test(item?.textContent ?? "") && !/Bearer x/.test(item?.textContent ?? ""));
    const titulos = [...(item?.querySelectorAll("button.icone") ?? [])].map((b) => (b as HTMLButtonElement).title);
    checar("a stack completa esta na lista", titulos.join("|") === "Testar conexão|Ferramentas|Editar|Excluir", titulos);
    // No linkedom `.checked` não espelha o atributo; o que importa é o `h`
    // ter marcado o campo como ligado.
    const liga = item?.querySelector("input.switch");
    checar("o switch reflete o estado ligado", liga?.hasAttribute("checked") === true);
  }

  secao("mcp/ui: cadastro recusa endereco ruim");
  {
    const guardados: Conector[] = [];
    const { abrirModal, ultimo } = fabricarModal();
    const secaoUI = secaoConectores({ conectores: () => guardados, definir: async () => undefined, abrirModal, aviso: () => undefined });
    botao(secaoUI.elemento, "Novo conector")!.click();
    const dlg = ultimo()!;
    const campos = [...dlg.querySelectorAll("input")] as HTMLInputElement[];
    campos[0].value = "Servidor";
    campos[1].value = "http://mcp.exemplo.com/mcp";
    botao(dlg, "Adicionar")!.click();
    await new Promise((r) => setTimeout(r, 10));
    checar("http externo nao passa", /https/.test(dlg.querySelector(".status")?.textContent ?? ""), dlg.querySelector(".status")?.textContent);
    checar("e o modal continua aberto", dlg.aberto);
    campos[0].value = "";
    campos[1].value = "https://mcp.exemplo.com/mcp";
    botao(dlg, "Adicionar")!.click();
    await new Promise((r) => setTimeout(r, 10));
    checar("sem nome nao passa", /nome/i.test(dlg.querySelector(".status")?.textContent ?? ""), dlg.querySelector(".status")?.textContent);
  }

  secao("mcp/ui: os tres estados por ferramenta");
  {
    let guardados: Conector[] = [
      {
        id: "c1",
        nome: "Compras",
        url: "https://mcp.compras.gov.br/mcp",
        ativo: true,
        auth: { tipo: "nenhuma" },
        padrao: "aprovar",
        permissoes: {},
        tools: [tool("buscar"), tool("apagar")],
      },
    ];
    const { abrirModal, ultimo } = fabricarModal();
    const secaoUI = secaoConectores({
      conectores: () => guardados,
      definir: async (l) => void (guardados = l),
      abrirModal,
      aviso: () => undefined,
    });
    ([...secaoUI.elemento.querySelectorAll("button.icone")] as HTMLButtonElement[]).find((b) => b.title === "Ferramentas")!.click();
    const dlg = ultimo()!;
    const selects = [...dlg.querySelectorAll("select")] as HTMLSelectElement[];
    checar("um seletor por ferramenta, mais o padrao do conector", selects.length === 3, selects.length);
    checar("as tres opcoes estao la", [...selects[0].options].map((o) => o.value).join() === "sempre,aprovar,bloqueado");
    checar("o padrao vem marcado", selects[0].value === "aprovar", selects[0].value);
    // `select.value` é só leitura no linkedom: marcar a opção é o equivalente
    // ao que o navegador faz quando o usuário escolhe.
    const opcoes = [...selects[1].options];
    opcoes.find((o) => o.hasAttribute("selected"))?.removeAttribute("selected");
    opcoes.find((o) => o.value === "bloqueado")!.setAttribute("selected", "");
    selects[1].dispatchEvent(new (doc.defaultView as unknown as { Event: typeof Event }).Event("change"));
    await new Promise((r) => setTimeout(r, 10));
    checar("mudar o seletor grava a permissao", guardados[0].permissoes.buscar === "bloqueado", guardados[0].permissoes);
  }

  secao("mcp/ui: cartao de autorizacao");
  {
    const { abrirModal, ultimo } = fabricarModal();
    const promessa = cartaoExterno({ conector: "Compras", tool: "buscar_arp", descricao: "Busca atas", argumentos: { objeto: "papel A4" } }, abrirModal);
    const dlg = ultimo()!;
    checar("mostra a ferramenta", /buscar_arp/.test(dlg.textContent ?? ""));
    checar("mostra o que vai ser enviado", /papel A4/.test(dlg.querySelector(".args-externo")?.textContent ?? ""));
    checar("avisa que sai do navegador", /sai do seu navegador/.test(dlg.textContent ?? ""));
    const rotulos = [...dlg.querySelectorAll("button")].map((b) => b.textContent);
    checar("as tres saidas", rotulos.join("|") === "Recusar|Permitir sempre|Permitir uma vez", rotulos);
    botao(dlg, "Permitir sempre")!.click();
    const decisao = await promessa;
    checar("permitir sempre devolve sempre", decisao.permitido && decisao.sempre === true, decisao);
  }
  {
    const { abrirModal, ultimo } = fabricarModal();
    const promessa = cartaoExterno({ conector: "Compras", tool: "buscar", descricao: "", argumentos: {} }, abrirModal);
    botao(ultimo()!, "Recusar")!.click();
    const decisao = await promessa;
    checar("recusar devolve negado", decisao.permitido === false, decisao);
  }
  {
    const { abrirModal, ultimo } = fabricarModal();
    const promessa = cartaoExterno({ conector: "Compras", tool: "buscar", descricao: "", argumentos: {} }, abrirModal);
    // Fechar o cartão sem escolher (Esc, clique fora) é recusa: nada sai do
    // navegador porque o usuário não decidiu.
    ultimo()!.close();
    const decisao = await promessa;
    checar("fechar sem escolher e recusa", decisao.permitido === false, decisao);
  }
}
