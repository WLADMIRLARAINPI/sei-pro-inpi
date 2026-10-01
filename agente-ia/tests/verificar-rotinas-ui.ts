/**
 * A tela das rotinas, montada de verdade (linkedom).
 *
 * O que importa aqui são as travas do formulário: alcance autônomo não se
 * salva sem confirmação e sem ferramenta escolhida, ferramenta irreversível
 * ou de assinatura não aparece para escolher, e a caixa de aviso volta a
 * desmarcada quando o navegador recusa a notificação.
 */

import { DOMParser } from "linkedom";
import { secaoRotinas } from "../src/painel/rotinas-ui";
import type { AbrirModal } from "../src/painel/mcp-ui";
import type { Rotina } from "../src/painel/rotinas";
import { checar, secao } from "./util";

const doc = new DOMParser().parseFromString("<html><body></body></html>", "text/html") as unknown as Document;
(globalThis as { document?: Document }).document = doc;

interface DialogFalso extends HTMLElement {
  close(): void;
  aberto: boolean;
}

function fabricarModal(): { abrirModal: AbrirModal; ultimo: () => DialogFalso } {
  let ultimo: DialogFalso | null = null;
  const abrirModal: AbrirModal = (o) => {
    const dlg = doc.createElement("div") as unknown as DialogFalso;
    dlg.aberto = true;
    dlg.close = () => void (dlg.aberto = false);
    (dlg as unknown as { addEventListener: (t: string, f: () => void) => void }).addEventListener = () => undefined;
    for (const n of [...o.corpo, ...o.acoes]) if (n && typeof n !== "string") dlg.append(n);
    doc.body.append(dlg);
    ultimo = dlg;
    return dlg as unknown as HTMLDialogElement;
  };
  return { abrirModal, ultimo: () => ultimo as DialogFalso };
}

const botao = (raiz: ParentNode, texto: string) => [...raiz.querySelectorAll("button")].find((b) => b.textContent === texto) as HTMLButtonElement | undefined;
const porRotulo = (raiz: ParentNode, rotulo: string) => raiz.querySelector(`[aria-label="${rotulo}"]`) as HTMLElement | null;
const escolher = (sel: HTMLSelectElement, valor: string) => {
  // `select.value` é só leitura no linkedom: marcar a opção é o equivalente.
  const opcoes = [...sel.options];
  opcoes.find((o) => o.hasAttribute("selected"))?.removeAttribute("selected");
  opcoes.find((o) => o.value === valor)?.setAttribute("selected", "");
  sel.dispatchEvent(new (doc.defaultView as unknown as { Event: typeof Event }).Event("change"));
};

const rotina = (r: Partial<Rotina> = {}): Rotina => ({
  id: "r1",
  nome: "Parados",
  pergunta: "liste os processos parados",
  frequencia: "diaria",
  hora: "08:00",
  ativa: true,
  alcance: "leitura",
  ...r,
});

const ESCRITAS = [
  { nome: "processo_marcador", efeito: "escrita" as const },
  { nome: "documento_criar", efeito: "escrita" as const },
  { nome: "documento_excluir", efeito: "irreversivel" as const },
  { nome: "documento_assinar", efeito: "assinatura" as const },
];

function montar(lista: Rotina[], o: { permitirAviso?: boolean } = {}) {
  let guardadas = lista;
  const rodadas: string[] = [];
  const { abrirModal, ultimo } = fabricarModal();
  const ui = secaoRotinas({
    rotinas: () => guardadas,
    definir: async (l) => void (guardadas = l),
    skills: () => [{ id: "s1", nome: "Despacho padrão" }],
    escritasDisponiveis: () => ESCRITAS,
    abrirModal,
    rodarAgora: (r) => void rodadas.push(r.id),
    pedirPermissaoDeAviso: async () => o.permitirAviso ?? true,
  });
  return { ui, ultimo, rodadas, guardadas: () => guardadas };
}

export async function verificarRotinasUi(): Promise<void> {
  secao("rotinas/ui: lista");
  {
    const { ui, rodadas } = montar([
      rotina({ alcance: "autonoma", autorizadas: ["processo_marcador"], ultimas: [{ em: Date.now(), ok: true, resumo: "8 processos", custo: 0.03 }] }),
      rotina({ id: "r2", nome: "Marcar", ativa: false, falhas: 1, alcance: "autonoma" }),
      rotina({ id: "r3", nome: "Manual", frequencia: "manual" }),
    ]);
    const itens = [...ui.elemento.querySelectorAll(".skill.rotina")];
    checar("as tres rotinas aparecem", itens.length === 3, itens.length);
    checar("o alcance autonomo e destacado", itens[0].querySelector(".selo-alcance") !== null);
    checar("diz que altera sem aprovacao", /sem pedir aprova/.test(itens[0].textContent ?? ""), itens[0].textContent);
    checar("a ultima execucao aparece com custo", /R\$ 0,1[5-7]|8 processos/.test(itens[0].textContent ?? ""), itens[0].textContent);
    checar("rotina desligada por falha explica o motivo", /[Dd]esligada/.test(itens[1].textContent ?? ""), itens[1].textContent);
    botao(itens[2], "Rodar agora")!.click();
    checar("o botao Rodar agora chama quem executa", rodadas.join() === "r3", rodadas);
  }

  secao("rotinas/ui: campos conforme a frequencia");
  {
    const { ui, ultimo } = montar([]);
    botao(ui.elemento, "Nova rotina")!.click();
    const dlg = ultimo();
    const freq = porRotulo(dlg, "Frequência") as HTMLSelectElement;
    const hora = porRotulo(dlg, "A partir das") as HTMLInputElement;
    const dia = porRotulo(dlg, "Dia da semana") as HTMLSelectElement;
    checar("as seis frequencias estao la", [...freq.options].map((o) => o.value).join() === "manual,horaria,diaria,uteis,semanal,mensal", [...freq.options].map((o) => o.value));
    escolher(freq, "manual");
    checar("manual esconde a hora", hora.hidden === true);
    escolher(freq, "horaria");
    checar("horaria tambem esconde a hora", hora.hidden === true);
    escolher(freq, "uteis");
    checar("dias uteis mostra a hora", hora.hidden === false);
    checar("e nao mostra dia da semana", dia.hidden === true);
    escolher(freq, "semanal");
    checar("semanal mostra o dia da semana", dia.hidden === false);
  }

  secao("rotinas/ui: alcance autonomo");
  {
    const { ui, ultimo, guardadas } = montar([]);
    botao(ui.elemento, "Nova rotina")!.click();
    const dlg = ultimo();
    const alcance = porRotulo(dlg, "Alcance") as HTMLSelectElement;
    const ferramentas = porRotulo(dlg, "Ferramentas autorizadas") as HTMLSelectElement;
    checar("a lista de ferramentas comeca escondida", ferramentas.hidden === true);
    escolher(alcance, "autonoma");
    checar("alcance autonomo revela as ferramentas", ferramentas.hidden === false);
    const oferecidas = [...ferramentas.options].map((o) => o.value);
    checar("irreversivel nao entra na lista", !oferecidas.includes("documento_excluir"), oferecidas);
    checar("assinatura nao entra na lista", !oferecidas.includes("documento_assinar"), oferecidas);
    checar("escritas comuns entram", oferecidas.join() === "processo_marcador,documento_criar", oferecidas);

    (porRotulo(dlg, "Nome da rotina") as HTMLInputElement).value = "Marcar parados";
    (porRotulo(dlg, "Instruções") as HTMLTextAreaElement).value = "marque os processos parados";
    botao(dlg, "Adicionar")!.click();
    await new Promise((r) => setTimeout(r, 10));
    checar("sem confirmar, nao salva", guardadas().length === 0 && /confirme|entendo/i.test(dlg.querySelector(".status")?.textContent ?? ""), dlg.querySelector(".status")?.textContent);

    const confirma = porRotulo(dlg, "Confirmo o alcance autónomo") as HTMLInputElement;
    confirma.checked = true;
    botao(dlg, "Adicionar")!.click();
    await new Promise((r) => setTimeout(r, 10));
    checar("confirmado mas sem ferramenta, nao salva", guardadas().length === 0 && /ferramenta/i.test(dlg.querySelector(".status")?.textContent ?? ""), dlg.querySelector(".status")?.textContent);

    [...ferramentas.options].find((o) => o.value === "processo_marcador")!.setAttribute("selected", "");
    botao(dlg, "Adicionar")!.click();
    await new Promise((r) => setTimeout(r, 10));
    const salva = guardadas()[0];
    checar("agora salva", Boolean(salva), guardadas());
    checar("com o alcance e a ferramenta", salva?.alcance === "autonoma" && salva?.autorizadas?.join() === "processo_marcador", salva);
    checar("e com o aviso ligado, sem o usuario pedir", salva?.avisar === true, salva);
  }

  secao("rotinas/ui: aviso recusado pelo navegador");
  {
    const { ui, ultimo } = montar([], { permitirAviso: false });
    botao(ui.elemento, "Nova rotina")!.click();
    const dlg = ultimo();
    const avisar = porRotulo(dlg, "Avisar quando terminar") as HTMLInputElement;
    avisar.checked = true;
    avisar.dispatchEvent(new (doc.defaultView as unknown as { Event: typeof Event }).Event("change"));
    await new Promise((r) => setTimeout(r, 10));
    // Reconsultado de propósito: o TypeScript estreita o tipo depois da
    // atribuição acima e a comparação direta não compilaria.
    checar("a caixa volta a desmarcada", (porRotulo(dlg, "Avisar quando terminar") as HTMLInputElement).checked === false);
    checar("e explica por que", /não autorizou/i.test(dlg.textContent ?? ""), dlg.textContent?.slice(-120));
  }

  secao("rotinas/ui: skills como instrucao");
  {
    const { ui, ultimo, guardadas } = montar([]);
    botao(ui.elemento, "Nova rotina")!.click();
    const dlg = ultimo();
    (porRotulo(dlg, "Nome da rotina") as HTMLInputElement).value = "Pela skill";
    const caixa = dlg.querySelector('input[type="checkbox"][value="s1"]') as HTMLInputElement | null;
    checar("a skill cadastrada aparece para escolher", Boolean(caixa));
    caixa!.checked = true;
    botao(dlg, "Adicionar")!.click();
    await new Promise((r) => setTimeout(r, 10));
    checar("salva so com skill, sem texto", guardadas()[0]?.skills?.join() === "s1", guardadas()[0]);
  }
}
