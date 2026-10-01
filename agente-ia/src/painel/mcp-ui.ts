/**
 * Interface dos conectores MCP: a seção da configuração e o cartão de
 * autorização que aparece na conversa.
 *
 * Em arquivo próprio porque `main.ts` já passa de 2.600 linhas — e porque
 * esta tela tem vida própria: lista, dois modais e um teste de conexão.
 */

import { ClienteMcp } from "../mcp/cliente";
import {
  conferirEndereco,
  destinoDe,
  MAX_CONECTORES,
  MAX_TOOLS,
  permissaoDe,
  toolsVisiveis,
  type Conector,
  type Permissao,
} from "../mcp/conectores";
import type { DecisaoExterna, PedidoExterno } from "../motor/tipos";
import { h, icone } from "./dom";

/** O modal da configuração (`App.abrirModal`), passado de fora. */
export type AbrirModal = (o: {
  titulo: string;
  corpo: Array<Node | string | null | false>;
  acoes: Array<Node | string | null | false>;
  obrigatorio?: boolean;
}) => HTMLDialogElement;

export interface OpcoesSecao {
  conectores(): Conector[];
  definir(lista: Conector[]): Promise<void>;
  abrirModal: AbrirModal;
  aviso(texto: string): void;
}

const ROTULOS: Array<{ valor: Permissao; texto: string }> = [
  { valor: "sempre", texto: "Sempre permitir" },
  { valor: "aprovar", texto: "Requer aprovação" },
  { valor: "bloqueado", texto: "Bloqueado" },
];

/** Host sem o esquema, para a lista não ficar comprida. */
const hostDe = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/**
 * Autorização de acesso à rede daquele servidor.
 *
 * Pedir permissão exige gesto do usuário, e é por isso que isto acontece no
 * clique de "Testar" — nunca no carregamento do painel.
 */
async function autorizarOrigem(origem: string): Promise<boolean> {
  try {
    if (await chrome.permissions.contains({ origins: [`${origem}/*`] })) return true;
    return await chrome.permissions.request({ origins: [`${origem}/*`] });
  } catch {
    return false;
  }
}

export function secaoConectores(o: OpcoesSecao): { elemento: HTMLElement; redesenhar: () => void } {
  const lista = h("div", { class: "skills" });
  const novo = h("button", {}, "Novo conector");

  const salvar = async (c: Conector) => {
    const atual = o.conectores();
    await o.definir(atual.some((x) => x.id === c.id) ? atual.map((x) => (x.id === c.id ? c : x)) : [...atual, c]);
    redesenhar();
  };

  /** Conversa com o servidor e guarda o catálogo. */
  const testar = async (c: Conector, status?: HTMLElement): Promise<void> => {
    const diga = (texto: string, classe = "status") => {
      if (status) {
        status.className = classe;
        status.textContent = texto;
      }
    };
    const endereco = conferirEndereco(c.url);
    if (!endereco.ok) return diga(endereco.motivo, "status erro");
    if (!(await autorizarOrigem(endereco.origem))) {
      await salvar({ ...c, erro: "Falta autorizar o acesso a este endereço." });
      return diga("O navegador não autorizou o acesso a este endereço.", "status erro");
    }
    diga("Conversando com o servidor...");
    const cliente = new ClienteMcp(destinoDe(c));
    const sinal = new AbortController().signal;
    try {
      const servidor = await cliente.iniciar(sinal);
      const tools = (await cliente.listarTools(sinal)).slice(0, MAX_TOOLS);
      await salvar({ ...c, tools, servidor, verificadoEm: Date.now(), erro: undefined });
      diga(`${servidor.nome}: ${tools.length} ferramenta(s).`, "status ok");
    } catch (e) {
      const msg = (e as Error).message;
      await salvar({ ...c, erro: msg, verificadoEm: Date.now() });
      diga(msg, "status erro");
    }
  };

  /** Permissão de cada ferramenta, e o padrão para as que aparecerem depois. */
  const abrirFerramentas = (c: Conector): void => {
    const busca = h("input", { type: "search", placeholder: "Filtrar ferramentas", "aria-label": "Filtrar ferramentas" });
    const padrao = h(
      "select",
      { "aria-label": "Padrão para ferramenta nova" },
      ...ROTULOS.map((r) => h("option", { value: r.valor, ...(c.padrao === r.valor ? { selected: true } : {}) }, r.texto)),
    );
    const corpoLista = h("div", { class: "skills" });
    const status = h("div", { class: "status" });
    const atualizar = h("button", {}, "Atualizar lista");
    let atual = c;

    const desenhar = () => {
      const termo = busca.value.trim().toLowerCase();
      const tools = (atual.tools ?? []).filter((t) => !termo || `${t.nome} ${t.descricao}`.toLowerCase().includes(termo));
      corpoLista.replaceChildren(
        ...(tools.length
          ? tools.map((t) => {
              const escolha = h(
                "select",
                { "aria-label": `Permissão de ${t.nome}` },
                ...ROTULOS.map((r) => h("option", { value: r.valor, ...(permissaoDe(atual, t.nome) === r.valor ? { selected: true } : {}) }, r.texto)),
              );
              escolha.addEventListener("change", async () => {
                atual = { ...atual, permissoes: { ...atual.permissoes, [t.nome]: escolha.value as Permissao } };
                await salvar(atual);
              });
              return h(
                "div",
                { class: "skill" },
                h("div", { class: "skill-texto" }, h("strong", {}, t.nome), h("small", {}, t.descricao || "sem descrição")),
                escolha,
              );
            })
          : [h("div", { class: "ajuda" }, atual.tools?.length ? "Nenhuma ferramenta com esse filtro." : "Nenhuma ferramenta ainda. Use “Atualizar lista”.")]),
      );
    };

    busca.addEventListener("input", desenhar);
    padrao.addEventListener("change", async () => {
      atual = { ...atual, padrao: padrao.value as Permissao };
      await salvar(atual);
      desenhar();
    });
    atualizar.addEventListener("click", async () => {
      await testar(atual, status);
      atual = o.conectores().find((x) => x.id === atual.id) ?? atual;
      desenhar();
    });
    desenhar();

    const dlg = o.abrirModal({
      titulo: `Ferramentas de ${c.nome}`,
      corpo: [
        h(
          "div",
          { class: "campo" },
          h("label", {}, "Ferramenta nova, por padrão"),
          padrao,
          h("div", { class: "ajuda" }, "Vale para a ferramenta que o servidor passar a oferecer depois. Bloqueada não aparece para o agente."),
        ),
        h("div", { class: "campo" }, h("label", {}, "Ferramentas"), busca, corpoLista),
        h("div", { class: "com-botao" }, atualizar, status),
      ],
      acoes: [h("button", { class: "primario", onclick: () => dlg.close() }, "Fechar")],
    });
  };

  /** Cadastro e edição: nome, endereço e token. */
  const abrirCadastro = (c: Conector | null): void => {
    const nome = h("input", { type: "text", value: c?.nome ?? "", placeholder: "Compras Públicas", "aria-label": "Nome do conector" });
    const url = h("input", {
      type: "url",
      value: c?.url ?? "",
      placeholder: "https://servidor.gov.br/mcp",
      spellcheck: "false",
      "aria-label": "Endereço do servidor",
    });
    const cabecalho = h("input", {
      type: "text",
      value: c?.auth.tipo === "token" ? c.auth.cabecalho : "Authorization",
      spellcheck: "false",
      "aria-label": "Nome do cabeçalho",
    });
    const token = h("input", {
      type: "password",
      value: c?.auth.tipo === "token" ? c.auth.valor : "",
      placeholder: "Bearer ...",
      spellcheck: "false",
      "aria-label": "Token",
    });
    const status = h("div", { class: "status" });
    const confirmar = h("button", { class: "primario" }, c ? "Salvar" : "Adicionar");

    const dlg = o.abrirModal({
      titulo: c ? `Editar ${c.nome}` : "Novo conector",
      corpo: [
        h("div", { class: "campo" }, h("label", {}, "Nome"), nome, h("div", { class: "ajuda" }, "É por este nome que você e o agente se referem ao conector.")),
        h(
          "div",
          { class: "campo" },
          h("label", {}, "Endereço do servidor"),
          url,
          h("div", { class: "ajuda" }, "O endereço do transporte HTTP do servidor MCP. Só https (http vale para localhost)."),
        ),
        h(
          "div",
          { class: "campo" },
          h("label", {}, "Autenticação (opcional)"),
          h("div", { class: "finos" }, h("div", { class: "campo-fino" }, h("label", {}, "Cabeçalho"), cabecalho), h("div", { class: "campo-fino" }, h("label", {}, "Valor"), token)),
          h("div", { class: "ajuda" }, "Fica guardado só neste navegador, como a chave do serviço de IA. Em branco: servidor sem autenticação."),
        ),
      ],
      acoes: [status, h("button", { onclick: () => dlg.close() }, "Cancelar"), confirmar],
    });

    confirmar.addEventListener("click", async () => {
      const n = nome.value.trim();
      const endereco = conferirEndereco(url.value);
      if (!n) {
        status.className = "status erro";
        status.textContent = "Informe o nome.";
        return;
      }
      if (!endereco.ok) {
        status.className = "status erro";
        status.textContent = endereco.motivo;
        return;
      }
      if (!c && o.conectores().length >= MAX_CONECTORES) {
        status.className = "status erro";
        status.textContent = `O limite é de ${MAX_CONECTORES} conectores.`;
        return;
      }
      const valor = token.value.trim();
      const novoConector: Conector = {
        id: c?.id ?? crypto.randomUUID(),
        nome: n,
        url: url.value.trim(),
        ativo: c?.ativo ?? true,
        auth: valor ? { tipo: "token", cabecalho: cabecalho.value.trim() || "Authorization", valor } : { tipo: "nenhuma" },
        padrao: c?.padrao ?? "aprovar",
        permissoes: c?.permissoes ?? {},
        ...(c?.tools ? { tools: c.tools } : {}),
        ...(c?.servidor ? { servidor: c.servidor } : {}),
        ...(c?.consentido ? { consentido: true } : {}),
      };
      await salvar(novoConector);
      dlg.close();
      // Endereço ou token novos: o catálogo antigo não vale mais.
      void testar(novoConector).then(() => o.aviso(`Conector "${n}" salvo.`));
    });
  };

  const redesenhar = () => {
    const conectores = o.conectores();
    lista.replaceChildren(
      ...(conectores.length
        ? conectores.map((c) => {
            const liga = h("input", { type: "checkbox", class: "switch", ...(c.ativo ? { checked: true } : {}) });
            liga.addEventListener("change", async () => {
              await salvar({ ...c, ativo: liga.checked });
            });
            const status = h("div", { class: "status" });
            return h(
              "div",
              { class: "skill conector" },
              liga,
              h(
                "div",
                { class: "skill-texto" },
                h("strong", {}, c.nome),
                h("code", {}, c.erro ? "com erro" : `${toolsVisiveis(c).length} ferramenta(s)`),
                h("small", { class: "origem" }, `${hostDe(c.url)}${c.auth.tipo === "token" ? " · token salvo" : ""}`),
                c.erro ? h("small", { class: "falha" }, c.erro) : null,
                status,
              ),
              h("button", { class: "icone", title: "Testar conexão", "aria-label": `Testar ${c.nome}`, onclick: () => void testar(c, status) }, icone("check", 15)),
              h("button", { class: "icone", title: "Ferramentas", "aria-label": `Ferramentas de ${c.nome}`, onclick: () => abrirFerramentas(c) }, icone("ajustes", 15)),
              h("button", { class: "icone", title: "Editar", "aria-label": `Editar ${c.nome}`, onclick: () => abrirCadastro(c) }, icone("lapis", 15)),
              h(
                "button",
                {
                  class: "icone",
                  title: "Excluir",
                  "aria-label": `Excluir ${c.nome}`,
                  onclick: async (ev: Event) => {
                    const botao = ev.currentTarget as HTMLButtonElement;
                    // Duas etapas: o token vai embora com o conector.
                    if (botao.dataset.confirmar !== "sim") {
                      botao.dataset.confirmar = "sim";
                      botao.title = `Clique de novo para excluir ${c.nome} e o token guardado`;
                      botao.classList.add("perigo");
                      return;
                    }
                    await o.definir(o.conectores().filter((x) => x.id !== c.id));
                    redesenhar();
                  },
                },
                icone("lixeira", 15),
              ),
            );
          })
        : [
            h(
              "div",
              { class: "ajuda" },
              "Nenhum conector. Conector é um servidor MCP — um serviço de fora do SEI que oferece ferramentas ao agente (consultas, sistemas do órgão, APIs públicas).",
            ),
          ]),
    );
  };

  redesenhar();
  novo.addEventListener("click", () => abrirCadastro(null));

  const elemento = h(
    "div",
    { class: "campo" },
    h("label", {}, "Conectores (MCP)"),
    lista,
    h("div", { class: "com-botao" }, novo),
    h(
      "div",
      { class: "nota" },
      icone("escudo", 15),
      h(
        "span",
        {},
        "O conteúdo que você mandar a um conector sai do seu navegador para o endereço dele. Dados pessoais vão mascarados, como nas conversas; o resto do pedido vai como está. Cada ferramenta tem a permissão que você der, e na primeira vez o agente pede a sua autorização.",
      ),
    ),
  );

  return { elemento, redesenhar };
}

/**
 * Cartão de "requer aprovação": o usuário vê o conector, a ferramenta e o
 * que exatamente vai ser enviado, antes de sair do navegador.
 */
export function cartaoExterno(p: PedidoExterno, abrirModal: AbrirModal): Promise<DecisaoExterna> {
  return new Promise((resolver) => {
    let decidido: DecisaoExterna = { permitido: false };
    const uma = h("button", { class: "primario" }, "Permitir uma vez");
    const sempre = h("button", {}, "Permitir sempre");
    const nao = h("button", {}, "Recusar");
    const dlg = abrirModal({
      titulo: `Autorizar ${p.conector}`,
      corpo: [
        h("div", { class: "campo" }, h("label", {}, "Ferramenta"), h("div", { class: "ajuda" }, `${p.tool}${p.descricao ? ` — ${p.descricao}` : ""}`)),
        h("div", { class: "campo" }, h("label", {}, "Vai ser enviado"), h("pre", { class: "args-externo" }, JSON.stringify(p.argumentos, null, 2))),
        h("div", { class: "nota" }, icone("escudo", 15), h("span", {}, "Isto sai do seu navegador para o servidor do conector. Dados pessoais vão mascarados.")),
      ],
      acoes: [nao, sempre, uma],
    });
    uma.addEventListener("click", () => ((decidido = { permitido: true }), dlg.close()));
    sempre.addEventListener("click", () => ((decidido = { permitido: true, sempre: true }), dlg.close()));
    nao.addEventListener("click", () => dlg.close());
    dlg.addEventListener("close", () => resolver(decidido), { once: true });
  });
}
