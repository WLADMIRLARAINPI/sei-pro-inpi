/**
 * Interface das rotinas: a seção da configuração e o cadastro.
 *
 * Saiu de `main.ts` quando a rotina ganhou alcance, skills e aviso — o
 * formulário tem travas próprias (nada de alcance autônomo sem confirmação e
 * sem ferramenta escolhida) e elas merecem ficar num arquivo que se lê.
 */

import type { Efeito } from "../motor/tipos";
import { h, icone } from "./dom";
import type { AbrirModal } from "./mcp-ui";
import { descreverAlcance, descreverFrequencia, DIAS, type Alcance, type Frequencia, type Rotina } from "./rotinas";

export interface OpcoesRotinas {
  rotinas(): Rotina[];
  definir(lista: Rotina[]): Promise<void>;
  /** Skills cadastradas, para servirem de instrução. */
  skills(): Array<{ id: string; nome: string }>;
  /** Ferramentas que alteram o SEI, com o efeito de cada uma. */
  escritasDisponiveis(): Array<{ nome: string; efeito: Efeito }>;
  abrirModal: AbrirModal;
  rodarAgora(r: Rotina): void;
  pedirPermissaoDeAviso(): Promise<boolean>;
}

const FREQUENCIAS: Array<[Frequencia, string]> = [
  ["manual", "Quando eu mandar"],
  ["horaria", "A cada hora"],
  ["diaria", "Todo dia"],
  ["uteis", "Dias úteis"],
  ["semanal", "Toda semana"],
  ["mensal", "Todo mês"],
];

const ALCANCES: Array<[Alcance, string]> = [
  ["leitura", "Só leitura"],
  ["aprovar", "Pode propor, eu aprovo"],
  ["autonoma", "Altera sem me perguntar"],
];

const dinheiro = (dolares: number): string => `R$ ${(dolares * 5.5).toFixed(2).replace(".", ",")}`;

/** "ontem, R$ 0,17" — a última execução, do jeito que cabe na lista. */
function ultimaExecucao(r: Rotina): string {
  const e = r.ultimas?.[0];
  if (!e) return "ainda não rodou";
  const quando = e.em ? new Date(e.em).toLocaleString("pt-BR") : "em data desconhecida";
  if (!e.ok) return `falhou em ${quando}`;
  return `rodou em ${quando}${e.custo > 0 ? ` · ${dinheiro(e.custo)}` : ""}${e.escritas?.length ? ` · alterou o SEI (${e.escritas.join(", ")})` : ""}`;
}

export function secaoRotinas(o: OpcoesRotinas): { elemento: HTMLElement; redesenhar: () => void } {
  const lista = h("div", { class: "skills" });
  const nova = h("button", {}, "Nova rotina");

  const redesenhar = () => {
    const rotinas = o.rotinas();
    lista.replaceChildren(
      ...(rotinas.length
        ? rotinas.map((ro) => {
            const liga = h("input", {
              type: "checkbox",
              class: "switch",
              title: ro.ativa ? "Ativa" : "Desligada",
              ...(ro.ativa ? { checked: true } : {}),
            });
            liga.addEventListener("change", async () => {
              await o.definir(o.rotinas().map((x) => (x.id === ro.id ? { ...x, ativa: liga.checked, ...(liga.checked ? { falhas: 0 } : {}) } : x)));
              redesenhar();
            });
            return h(
              "div",
              { class: "skill rotina" },
              liga,
              h(
                "div",
                { class: "skill-texto" },
                h("strong", {}, ro.nome),
                h("code", {}, descreverFrequencia(ro)),
                ro.alcance === "leitura" ? null : h("code", { class: "selo-alcance" }, descreverAlcance(ro.alcance)),
                h("small", {}, ro.pergunta || (ro.skills?.length ? `pelas skills: ${ro.skills.length}` : "")),
                h("small", { class: "origem" }, ultimaExecucao(ro)),
                !ro.ativa && ro.falhas
                  ? h("small", { class: "falha" }, "Desligada depois de uma falha ao alterar o SEI. Religue quando quiser.")
                  : null,
              ),
              h("button", { onclick: () => o.rodarAgora(ro) }, "Rodar agora"),
              h("button", { class: "icone", title: "Editar", "aria-label": `Editar ${ro.nome}`, onclick: () => cadastrar(ro) }, icone("lapis", 15)),
              h(
                "button",
                {
                  class: "icone",
                  title: "Remover",
                  "aria-label": `Remover ${ro.nome}`,
                  onclick: async () => {
                    await o.definir(o.rotinas().filter((x) => x.id !== ro.id));
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
              "Nenhuma rotina. Rotina é trabalho que o agente faz sozinho de tempos em tempos — “processos parados há mais de 30 dias”, “documentos sem assinatura na unidade”.",
            ),
          ]),
    );
  };

  /** Cadastro e edição de uma rotina. */
  function cadastrar(rotina: Rotina | null): void {
    const nome = h("input", { type: "text", value: rotina?.nome ?? "", placeholder: "Processos parados", "aria-label": "Nome da rotina" });
    const pergunta = h(
      "textarea",
      {
        rows: "3",
        placeholder: "Liste os processos da minha unidade sem andamento há mais de 30 dias, do mais antigo para o mais novo.",
        "aria-label": "Instruções",
        value: rotina?.pergunta ?? "",
      },
    );
    const skills = o.skills();
    const caixasSkill = skills.map((s) =>
      h("label", { class: "linha-switch" }, h("input", { type: "checkbox", value: s.id, ...(rotina?.skills?.includes(s.id) ? { checked: true } : {}) }), h("span", {}, s.nome)),
    );
    const frequencia = h(
      "select",
      { "aria-label": "Frequência" },
      ...FREQUENCIAS.map(([v, t]) => h("option", { value: v, ...((rotina?.frequencia ?? "diaria") === v ? { selected: true } : {}) }, t)),
    );
    const diaSemana = h(
      "select",
      { "aria-label": "Dia da semana" },
      ...DIAS.map((d, i) => h("option", { value: String(i + 1), ...((rotina?.diaSemana ?? 1) === i + 1 ? { selected: true } : {}) }, d)),
    );
    const diaMes = h("input", { type: "number", min: "1", max: "28", value: String(rotina?.diaMes ?? 1), "aria-label": "Dia do mês" });
    const hora = h("input", { type: "time", value: rotina?.hora ?? "08:00", "aria-label": "A partir das" });
    const alcance = h(
      "select",
      { "aria-label": "Alcance" },
      ...ALCANCES.map(([v, t]) => h("option", { value: v, ...((rotina?.alcance ?? "leitura") === v ? { selected: true } : {}) }, t)),
    );
    // Irreversível e assinatura NÃO entram: rotina não exclui, não cancela e
    // não assina sozinha, nem com autorização — a trava se repete na execução.
    const escritas = o.escritasDisponiveis().filter((t) => t.efeito === "escrita");
    const ferramentas = h(
      "select",
      { multiple: true, size: "6", "aria-label": "Ferramentas autorizadas" },
      ...escritas.map((t) => h("option", { value: t.nome, ...(rotina?.autorizadas?.includes(t.nome) ? { selected: true } : {}) }, t.nome)),
    );
    const confirma = h("input", { type: "checkbox", "aria-label": "Confirmo o alcance autónomo", ...(rotina?.alcance === "autonoma" ? { checked: true } : {}) });
    const linhaConfirma = h(
      "label",
      { class: "linha-switch" },
      confirma,
      h("span", {}, "Entendo que esta rotina vai alterar o SEI sem me pedir aprovação", h("small", {}, "Exclusão, cancelamento e assinatura nunca são feitos por rotina.")),
    );
    const avisar = h("input", { type: "checkbox", class: "switch", "aria-label": "Avisar quando terminar", ...(rotina?.avisar ? { checked: true } : {}) });
    const ajudaAviso = h("div", { class: "ajuda" });
    const teto = h("input", { type: "number", min: "0", step: "0.5", value: rotina?.teto ? String(rotina.teto) : "", placeholder: "sem teto", "aria-label": "Teto por execução" });
    const status = h("div", { class: "status" });
    const salvar = h("button", { class: "primario" }, rotina ? "Salvar" : "Adicionar");
    const rodar = h("button", {}, "Rodar agora");

    const ajustar = () => {
      const f = frequencia.value as Frequencia;
      hora.hidden = f === "manual" || f === "horaria";
      diaSemana.hidden = f !== "semanal";
      diaMes.hidden = f !== "mensal";
      const autonoma = alcance.value === "autonoma";
      ferramentas.hidden = !autonoma;
      linhaConfirma.hidden = !autonoma;
      // Rotina que altera o SEI sozinha avisa sempre: o usuário tem de saber.
      if (autonoma) avisar.checked = true;
    };
    frequencia.addEventListener("change", ajustar);
    alcance.addEventListener("change", ajustar);
    avisar.addEventListener("change", async () => {
      if (!avisar.checked) {
        ajudaAviso.textContent = "";
        return;
      }
      if (await o.pedirPermissaoDeAviso()) {
        ajudaAviso.textContent = "O navegador vai mostrar uma notificação quando a rotina terminar.";
        return;
      }
      avisar.checked = false;
      ajudaAviso.textContent = "O navegador não autorizou as notificações, então não há como avisar.";
    });

    const dlg = o.abrirModal({
      titulo: rotina ? "Editar rotina" : "Nova rotina",
      corpo: [
        h("div", { class: "campo" }, h("label", {}, "Nome"), nome),
        h(
          "div",
          { class: "campo" },
          h("label", {}, "Instruções"),
          pergunta,
          h("div", { class: "ajuda" }, "Escreva como escreveria na conversa. Pode deixar em branco se escolher skills abaixo."),
          ...(caixasSkill.length ? [h("div", { class: "ajuda" }, "Skills que entram junto do pedido:"), ...caixasSkill] : []),
        ),
        h(
          "div",
          { class: "campo" },
          h("label", {}, "Quando"),
          h("div", { class: "com-botao" }, frequencia, diaSemana, diaMes, hora),
          h("div", { class: "ajuda" }, "A rotina roda com o agente aberto, na primeira oportunidade depois do horário marcado."),
        ),
        h(
          "div",
          { class: "campo" },
          h("label", {}, "O que ela pode fazer"),
          alcance,
          ferramentas,
          h("div", { class: "ajuda" }, "Segure Ctrl (ou Cmd) para escolher várias ferramentas."),
          linhaConfirma,
        ),
        h(
          "div",
          { class: "campo" },
          h("label", {}, "Aviso e gasto"),
          h("label", { class: "linha-switch" }, avisar, h("span", {}, "Avisar quando terminar", h("small", {}, "Notificação do navegador com o resultado em uma linha."))),
          ajudaAviso,
          h("div", { class: "finos" }, h("div", { class: "campo-fino" }, h("label", {}, "Teto por execução (R$)"), teto, h("small", {}, "Em branco: valem só os limites gerais."))),
        ),
      ],
      acoes: [status, rotina ? rodar : null, h("button", { onclick: () => dlg.close() }, "Cancelar"), salvar],
    });
    ajustar();

    if (rotina) {
      rodar.addEventListener("click", () => {
        dlg.close();
        o.rodarAgora(rotina);
      });
    }

    const erro = (texto: string) => {
      status.className = "status erro";
      status.textContent = texto;
    };

    salvar.addEventListener("click", async () => {
      const n = nome.value.trim();
      const q = pergunta.value.trim();
      const escolhidas = caixasSkill.map((l) => l.querySelector("input") as HTMLInputElement).filter((i) => i.checked).map((i) => i.value);
      if (!n) return erro("Informe o nome.");
      if (!q && !escolhidas.length) return erro("Escreva as instruções ou escolha ao menos uma skill.");
      const alc = alcance.value as Alcance;
      const autorizadas = [...ferramentas.options].filter((x) => x.selected).map((x) => x.value);
      if (alc === "autonoma" && !confirma.checked) return erro("Confirme que entende que a rotina vai alterar o SEI sem aprovação.");
      if (alc === "autonoma" && !autorizadas.length) return erro("Escolha ao menos uma ferramenta autorizada.");
      const f = frequencia.value as Frequencia;
      const nova: Rotina = {
        id: rotina?.id ?? crypto.randomUUID(),
        nome: n,
        pergunta: q,
        ...(escolhidas.length ? { skills: escolhidas } : {}),
        frequencia: f,
        hora: hora.value || "08:00",
        ...(f === "semanal" ? { diaSemana: Number(diaSemana.value) } : {}),
        ...(f === "mensal" ? { diaMes: Math.min(28, Math.max(1, Number(diaMes.value) || 1)) } : {}),
        ativa: rotina?.ativa ?? true,
        alcance: alc,
        ...(alc === "autonoma" ? { autorizadas } : {}),
        ...(avisar.checked || alc === "autonoma" ? { avisar: true } : {}),
        ...(Number(teto.value) > 0 ? { teto: Number(teto.value) } : {}),
        // Rotina nova não dispara retroativamente: conta a partir de agora.
        ultimaEm: rotina?.ultimaEm ?? Date.now(),
        ...(rotina?.ultimas?.length ? { ultimas: rotina.ultimas } : {}),
      };
      const atual = o.rotinas();
      await o.definir(rotina ? atual.map((x) => (x.id === rotina.id ? nova : x)) : [...atual, nova]);
      redesenhar();
      dlg.close();
    });
  }

  redesenhar();
  nova.addEventListener("click", () => cadastrar(null));

  const elemento = h(
    "div",
    { class: "campo" },
    h("label", {}, "Rotinas"),
    lista,
    h("div", { class: "com-botao" }, nova),
    h(
      "div",
      { class: "nota" },
      icone("escudo", 15),
      h(
        "span",
        {},
        "A rotina roda no SEU navegador, com a SUA sessão do SEI, e só com o agente aberto — não há servidor do SEI Pro agindo de madrugada. No Chrome, o navegador avisa na hora marcada mesmo com o painel fechado; no Firefox, ela roda quando a barra lateral do agente está aberta.",
      ),
    ),
  );

  return { elemento, redesenhar };
}
