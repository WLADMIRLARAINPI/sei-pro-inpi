/**
 * O cartão de erro da conversa.
 *
 * Um erro no agente costuma ter duas vidas: a de quem o vê (precisa saber o
 * que fazer agora) e a de quem vai ajudar a resolver (precisa de versão,
 * modelo, status HTTP e o que o provedor respondeu). Daí os dois botões, só
 * com ícone: **copiar** leva a mensagem e o diagnóstico juntos, prontos para
 * colar num chamado ou num grupo; **a seta** abre o diagnóstico aqui mesmo,
 * para quem quiser conferir antes o que está mandando.
 */

import { textoDoDiagnostico, type Diagnostico } from "./diagnostico";
import { h, icone } from "./dom";

export function cartaoDeErro(texto: string, diagnostico?: Diagnostico): HTMLElement {
  const cartao = h("div", { class: "msg erro" }, icone("alerta", 14), h("span", { class: "erro-texto" }, texto));
  if (!diagnostico) return cartao;

  const log = textoDoDiagnostico(diagnostico);
  const detalhes = h("pre", { class: "erro-detalhes", hidden: true }, log);
  const copiar = h("button", { class: "icone pequeno", title: "Copiar o erro e o diagnóstico", "aria-label": "Copiar o erro e o diagnóstico" }, icone("copiar", 13));
  const expandir = h(
    "button",
    { class: "icone pequeno gira", title: "Ver detalhes do erro", "aria-label": "Ver detalhes do erro", "aria-expanded": "false" },
    icone("seta", 13),
  );

  copiar.addEventListener("click", () => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(`${texto}\n\n${log}`);
        copiar.replaceChildren(icone("check", 13));
        copiar.title = "Copiado";
        setTimeout(() => {
          copiar.replaceChildren(icone("copiar", 13));
          copiar.title = "Copiar o erro e o diagnóstico";
        }, 2000);
      } catch {
        // Sem permissão de área de transferência (acontece em janela sem foco):
        // abre os detalhes para copiar à mão, em vez de falhar calado.
        abrir(true);
      }
    })();
  });

  const abrir = (sim: boolean) => {
    detalhes.hidden = !sim;
    expandir.setAttribute("aria-expanded", String(sim));
    expandir.classList.toggle("aberta", sim);
    expandir.title = sim ? "Esconder os detalhes" : "Ver detalhes do erro";
  };
  expandir.addEventListener("click", () => abrir(detalhes.hidden));

  cartao.append(h("span", { class: "erro-acoes" }, copiar, expandir), detalhes);
  return cartao;
}
