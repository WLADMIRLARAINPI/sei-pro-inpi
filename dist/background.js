/******************************************************************************
 SPro: Extensão para o Firefox e Chrome que adiciona ao Sistema Eletrônico de Informações (SEI) funções avançadas.
 Autor: Pedro Henrique Soares (pedrohsoares.adv@gmail.com)
*******************************************************************************/

function handleInstalled(details) {
  console.log(details.reason);

  // O onInstalled tambem dispara quando o NAVEGADOR e atualizado (chrome_update / browser_update) e
  // quando um modulo compartilhado muda: nesses casos nao ha novidade do SEI Pro para mostrar.
  if (details.reason != "install" && details.reason != "update") return;
  // Recarregar a extensao descompactada tambem gera "update", mas sem mudar a versao.
  if (details.reason == "update" && details.previousVersion == browser.runtime.getManifest().version) return;

  function onError(error) { console.log(`Error: ${error}`); }
  function AbrirUrlSeiPro(item) {
    // Ao instalar ou atualizar.
    item.InstallOrUpdate = true;
    browser.storage.local.set(item);

    // A instalacao era deduzida da ausencia de CheckTypes, chave da extensao antiga (SPro) que as
    // configuracoes atuais nao gravam mais (elas usam storage.sync/dataValues): sem o details.reason,
    // toda atualizacao abria a pagina inicial em vez do historico de versoes.
    if (details.reason == "install") {
      browser.tabs.create({ url: "https://seipro.app/" });
    } else if (item.CheckTypes == undefined || item.CheckTypes.indexOf("hidemsgupdate") == -1) {
      browser.tabs.create({ url: "https://seipro.app/pages/HISTORICO.html" });
    }
  }

  if (isChrome) { /* Chrome: */
    browser.storage.local.get("CheckTypes", AbrirUrlSeiPro);
  } else {
    var gettingItem = browser.storage.local.get("CheckTypes");
    gettingItem.then(AbrirUrlSeiPro, onError);
  }
}

/******************************************************************************
 * Inicio                                                                     *
 ******************************************************************************/
const isChrome = (typeof browser === "undefined"); /* Chrome: */
if (isChrome) { var browser = chrome; } /* Chrome: */

browser.runtime.onInstalled.addListener(handleInstalled);

// O Chrome recente tambem expoe um `browser` global no service worker (medido no Chrome 152), entao
// isChrome deixou de separar os dois navegadores. getBrowserInfo so existe no Firefox: chamado no Chrome,
// o erro no carregamento derruba o registro do service worker e o onInstalled nunca dispara.
if(!isChrome && typeof browser.runtime.getBrowserInfo === "function") {
  browser.runtime.getBrowserInfo().then(function (info) {
    browser.storage.local.set({version: info.version}).then(null, null);
  });
}

/******************************************************************************
 * Agente de IA: o item "Agente de IA" no menu do SEI (js/init_agente.js) pede
 * para abrir o painel lateral. O clique do usuario e o gesto que o Chrome
 * exige para sidePanel.open; por isso a chamada e feita direto no listener.
 ******************************************************************************/
browser.runtime.onMessage.addListener(function (msg, sender) {
  if (!msg || msg.tipo !== "abrirAgente" || !sender || !sender.tab) return;
  if (typeof chrome !== "undefined" && chrome.sidePanel && chrome.sidePanel.open) {
    chrome.sidePanel.open({ tabId: sender.tab.id }).catch(function (e) { console.log(e); });
  } else if (browser.sidebarAction && browser.sidebarAction.open) {
    browser.sidebarAction.open();
  }
});

/******************************************************************************
 * Rotinas do Agente de IA: o alarme AVISA, o painel EXECUTA.
 *
 * A sessao do SEI e da aba do usuario, e a ponte liga o content script direto
 * ao painel: nao ha como consultar o SEI daqui. Entao, na hora marcada, se o
 * painel esta aberto (porta "agente-vivo"), pedimos que ele rode; se nao esta,
 * mostramos uma notificacao que ao ser clicada abre o agente.
 *
 * No Firefox nada disto roda: o manifest v2 do SEI Pro nao declara background.
 ******************************************************************************/
var portasDoAgente = [];

browser.runtime.onConnect.addListener(function (porta) {
  if (!porta || porta.name !== "agente-vivo") return;
  portasDoAgente.push(porta);
  porta.onDisconnect.addListener(function () {
    portasDoAgente = portasDoAgente.filter(function (p) { return p !== porta; });
  });
});

function avisarRotinaPendente(id, nome) {
  if (!browser.notifications || !browser.notifications.create) return;
  browser.notifications.create("rotina-pendente:" + id, {
    type: "basic",
    iconUrl: browser.runtime.getURL("icons/menu/botpro_icon.svg"),
    title: "Rotina pendente: " + nome,
    // "Abra o agente" e literal: a rotina so roda com o painel aberto.
    message: "Abra o Agente de IA para rodar esta rotina."
  }, function () { /* sem permissao de notificacao: nada a fazer */ });
}

if (browser.alarms && browser.alarms.onAlarm) {
  browser.alarms.onAlarm.addListener(function (alarme) {
    if (!alarme || alarme.name.indexOf("rotina:") !== 0) return;
    var id = alarme.name.slice("rotina:".length);
    if (portasDoAgente.length) {
      portasDoAgente.forEach(function (p) { p.postMessage({ tipo: "rodarRotinas", rotina: id }); });
      return;
    }
    browser.storage.local.get("agenteIA_rotinas").then(function (v) {
      var lista = (v && v.agenteIA_rotinas) || [];
      var achadas = lista.filter(function (x) { return x.id === id; });
      if (achadas.length && achadas[0].ativa) avisarRotinaPendente(id, achadas[0].nome);
    });
  });
}

if (browser.notifications && browser.notifications.onClicked) {
  browser.notifications.onClicked.addListener(function (id) {
    if (id.indexOf("rotina") !== 0) return;
    browser.notifications.clear(id);
    function emAba() { browser.tabs.create({ url: browser.runtime.getURL("html/agente.html") }); }
    // O clique na notificacao e gesto do usuario: serve para abrir o painel.
    if (typeof chrome !== "undefined" && chrome.sidePanel && chrome.sidePanel.open) {
      browser.tabs.query({ active: true, currentWindow: true }).then(function (abas) {
        if (abas && abas.length) chrome.sidePanel.open({ tabId: abas[0].id }).catch(emAba);
        else emAba();
      });
    } else if (browser.sidebarAction && browser.sidebarAction.open) {
      browser.sidebarAction.open();
    } else {
      emAba();
    }
  });
}
