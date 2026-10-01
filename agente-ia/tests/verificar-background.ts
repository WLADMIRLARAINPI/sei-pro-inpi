/**
 * O `dist/background.js` com um navegador de mentira.
 *
 * O background é JavaScript legado, sem build e sem tipos, e ganhou o
 * tratamento dos alarmes das rotinas — a única parte da extensão que roda
 * sem painel. Carregá-lo aqui prova que ele registra os ouvintes e que, na
 * hora do alarme, faz a coisa certa: avisa o painel quando ele está aberto e
 * mostra notificação quando não está.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checar, secao } from "./util";

const AQUI = dirname(fileURLToPath(import.meta.url));
const FONTE = readFileSync(join(AQUI, "..", "..", "dist", "background.js"), "utf8");

interface Ouvintes {
  instalado: Array<(d: unknown) => void>;
  mensagem: Array<(m: unknown, s: unknown) => void>;
  conexao: Array<(p: unknown) => void>;
  alarme: Array<(a: { name: string }) => void>;
  clique: Array<(id: string) => void>;
}

/** Monta o `chrome` falso e roda o background dentro dele. */
function carregar(rotinas: unknown[]) {
  const ouvintes: Ouvintes = { instalado: [], mensagem: [], conexao: [], alarme: [], clique: [] };
  const notificadas: Array<{ id: string; titulo: string; corpo: string }> = [];
  const abas: string[] = [];
  const paineisAbertos: number[] = [];
  const chrome = {
    runtime: {
      onInstalled: { addListener: (f: (d: unknown) => void) => ouvintes.instalado.push(f) },
      onMessage: { addListener: (f: (m: unknown, s: unknown) => void) => ouvintes.mensagem.push(f) },
      onConnect: { addListener: (f: (p: unknown) => void) => ouvintes.conexao.push(f) },
      getURL: (p: string) => `chrome-extension://teste/${p}`,
      getManifest: () => ({ version: "2.2.5" }),
    },
    storage: { local: { get: async () => ({ agenteIA_rotinas: rotinas }), set: async () => undefined } },
    alarms: { onAlarm: { addListener: (f: (a: { name: string }) => void) => ouvintes.alarme.push(f) } },
    notifications: {
      create: (id: string, o: { title: string; message: string }, cb?: () => void) => {
        notificadas.push({ id, titulo: o.title, corpo: o.message });
        cb?.();
      },
      clear: () => undefined,
      onClicked: { addListener: (f: (id: string) => void) => ouvintes.clique.push(f) },
    },
    tabs: { create: (o: { url: string }) => void abas.push(o.url), query: async () => [{ id: 7 }] },
    sidePanel: { open: async (o: { tabId: number }) => void paineisAbertos.push(o.tabId) },
  };
  // O arquivo roda como script de service worker: `self`/`chrome` globais.
  const executar = new Function("chrome", "self", `${FONTE}\nreturn typeof portasDoAgente;`);
  const tipo = executar(chrome, chrome) as string;
  return { ouvintes, notificadas, abas, paineisAbertos, tipo };
}

export async function verificarBackground(): Promise<void> {
  secao("background: carrega e registra os ouvintes");
  const base = carregar([]);
  checar("o arquivo roda sem lancar", base.tipo === "object");
  checar("ouve a instalacao", base.ouvintes.instalado.length === 1);
  checar("ouve o pedido de abrir o agente", base.ouvintes.mensagem.length === 1);
  checar("ouve a porta do painel", base.ouvintes.conexao.length === 1);
  checar("ouve o alarme das rotinas", base.ouvintes.alarme.length === 1);
  checar("ouve o clique na notificacao", base.ouvintes.clique.length === 1);

  secao("background: alarme com o painel aberto");
  {
    const amb = carregar([{ id: "r1", nome: "Parados", ativa: true }]);
    const recebidas: unknown[] = [];
    const porta = {
      name: "agente-vivo",
      postMessage: (m: unknown) => void recebidas.push(m),
      onDisconnect: { addListener: () => undefined },
    };
    amb.ouvintes.conexao[0](porta);
    amb.ouvintes.alarme[0]({ name: "rotina:r1" });
    await new Promise((r) => setTimeout(r, 10));
    checar("manda o painel rodar", JSON.stringify(recebidas) === JSON.stringify([{ tipo: "rodarRotinas", rotina: "r1" }]), recebidas);
    checar("e nao notifica nada", amb.notificadas.length === 0, amb.notificadas);
  }

  secao("background: alarme com o painel fechado");
  {
    const amb = carregar([{ id: "r1", nome: "Parados", ativa: true }]);
    amb.ouvintes.alarme[0]({ name: "rotina:r1" });
    await new Promise((r) => setTimeout(r, 10));
    checar("notifica a pendencia com o nome da rotina", amb.notificadas[0]?.titulo === "Rotina pendente: Parados", amb.notificadas);
    checar("e diz o que fazer", /Abra o Agente/.test(amb.notificadas[0]?.corpo ?? ""), amb.notificadas[0]);
  }

  secao("background: porta de outro nome e rotina desligada");
  {
    const amb = carregar([{ id: "r1", nome: "Parados", ativa: false }]);
    const recebidas: unknown[] = [];
    amb.ouvintes.conexao[0]({ name: "outra-coisa", postMessage: (m: unknown) => void recebidas.push(m), onDisconnect: { addListener: () => undefined } });
    amb.ouvintes.alarme[0]({ name: "rotina:r1" });
    await new Promise((r) => setTimeout(r, 10));
    checar("porta de outro nome nao recebe nada", recebidas.length === 0);
    checar("rotina desligada nao notifica", amb.notificadas.length === 0, amb.notificadas);
  }

  secao("background: alarme que nao e de rotina");
  {
    const amb = carregar([{ id: "r1", nome: "Parados", ativa: true }]);
    amb.ouvintes.alarme[0]({ name: "outro-alarme" });
    await new Promise((r) => setTimeout(r, 10));
    checar("e ignorado", amb.notificadas.length === 0);
  }

  secao("background: clique na notificacao abre o agente");
  {
    const amb = carregar([]);
    amb.ouvintes.clique[0]("rotina-pendente:r1");
    await new Promise((r) => setTimeout(r, 10));
    checar("abre o painel lateral na aba ativa", amb.paineisAbertos.join() === "7", amb.paineisAbertos);
    amb.ouvintes.clique[0]("promocao-qualquer");
    await new Promise((r) => setTimeout(r, 10));
    checar("notificacao de outra origem e ignorada", amb.paineisAbertos.length === 1 && amb.abas.length === 0);
  }
}
