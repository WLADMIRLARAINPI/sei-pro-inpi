/**
 * Log de auditoria do cartão de erro.
 *
 * Serve para ser COLADO: num chamado, num grupo de trabalho, numa conversa com
 * quem mantém a extensão. É por isso que o desenho começa pelo avesso — pelo
 * que ele NÃO pode levar junto.
 *
 * Fora, sempre: a chave do serviço de IA e os tokens dos conectores (segredo);
 * o conteúdo de documentos e o texto da conversa (sigilo do processo); o
 * número do processo, a sigla da unidade e as instruções que o usuário
 * escreveu (identificam pessoas e casos). Dos endereços fica só o host: um
 * serviço de IA interno é um dado da rede do órgão, mas saber QUAL servidor
 * respondeu é o que resolve o chamado.
 *
 * Dentro: o que um desenvolvedor precisa para reproduzir — versão, navegador,
 * serviço, modelo, status HTTP, resposta do provedor, tamanho da conversa e as
 * últimas ferramentas com o resultado de cada uma.
 */

export interface DadosDiagnostico {
  mensagem: string;
  erro?: { status?: number; corpo?: string } | null;
  config?: { servico?: string; url?: string; modelo?: string; modeloAuxiliar?: string; cache?: boolean };
  extensao?: { nome?: string; versao?: string };
  navegador?: string;
  uso?: { entrada: number; saida: number; custo: number; cache?: number };
  rodadas?: number;
  tela?: { versao?: string; processo?: unknown } | null;
  ferramentas?: Array<{ nome: string; ok: boolean; erro?: string }>;
  conectores?: Array<{ nome: string; ativo: boolean }>;
  integridade?: number;
  /**
   * O navegador autorizou esta extensão a falar com o endereço do serviço?
   *
   * Sem essa autorização o `fetch` morre com "Failed to fetch" — a mesma
   * mensagem de quando não há rede. Dizer qual dos dois é poupa o chamado
   * inteiro.
   */
  acessoAoServico?: boolean;
}

export interface Diagnostico {
  linhas: Array<[string, string]>;
}

/** "Chrome 151 (macOS)" — sem a sopa de letras do user agent. */
export function navegadorResumido(ua: string): string {
  if (!ua) return "";
  const nome = /Firefox\/(\d+)/.exec(ua) ? `Firefox ${/Firefox\/(\d+)/.exec(ua)![1]}` : /Edg\/(\d+)/.exec(ua) ? `Edge ${/Edg\/(\d+)/.exec(ua)![1]}` : /Chrome\/(\d+)/.exec(ua) ? `Chrome ${/Chrome\/(\d+)/.exec(ua)![1]}` : "navegador desconhecido";
  const so = /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return so ? `${nome} (${so})` : nome;
}

/** Só o host do endereço: o caminho pode dizer mais do que precisa. */
function hostDe(url?: string): string {
  if (!url?.trim()) return "";
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

const numero = (n: number): string => n.toLocaleString("pt-BR");

export function montarDiagnostico(d: DadosDiagnostico): Diagnostico {
  const linhas: Array<[string, string]> = [];
  const por = (rotulo: string, valor: string | number | undefined | null) => {
    if (valor === undefined || valor === null || valor === "" || (typeof valor === "number" && Number.isNaN(valor))) return;
    linhas.push([rotulo, String(valor)]);
  };

  por("quando", new Date().toLocaleString("pt-BR"));
  por("extensão", [d.extensao?.nome, d.extensao?.versao].filter(Boolean).join(" "));
  por("navegador", navegadorResumido(d.navegador ?? ""));
  por("serviço", [d.config?.servico, hostDe(d.config?.url)].filter(Boolean).join(" · "));
  por("modelo", [d.config?.modelo, d.config?.modeloAuxiliar ? `auxiliar: ${d.config.modeloAuxiliar}` : ""].filter(Boolean).join(" · "));
  por("erro", d.mensagem);
  if (d.erro?.status) por("resposta HTTP", String(d.erro.status));
  if (d.erro?.corpo) por("resposta do provedor", d.erro.corpo.replace(/\s+/g, " ").slice(0, 300));
  if (d.uso) {
    const cache = d.uso.cache ? `, ${numero(d.uso.cache)} do cache` : "";
    por("tokens da conversa", `${numero(d.uso.entrada)} de entrada, ${numero(d.uso.saida)} de saída${cache}`);
    por("custo da conversa", `US$ ${d.uso.custo.toFixed(4)}`);
  }
  por("rodadas", d.rodadas ? `${d.rodadas} rodada(s)` : "");
  por("SEI", d.tela?.versao ? `versão ${d.tela.versao}` : "");
  // O NÚMERO do processo não entra: o que o chamado precisa saber é se havia
  // um processo na tela, não qual.
  if (d.tela) por("processo aberto", d.tela.processo ? "sim" : "não");
  if (d.ferramentas?.length) {
    const ultimas = d.ferramentas.slice(-5).map((f) => `${f.nome} ${f.ok ? "ok" : `falhou${f.erro ? ` (${f.erro.slice(0, 60)})` : ""}`}`);
    por("últimas ferramentas", ultimas.join("; "));
  }
  if (d.conectores?.length) por("conectores", d.conectores.map((c) => `${c.nome}${c.ativo ? "" : " (desligado)"}`).join(", "));
  if (d.integridade) por("integridade", String(d.integridade));
  if (d.acessoAoServico !== undefined) por("acesso ao endere\u00E7o do servi\u00E7o", d.acessoAoServico ? "autorizado" : "N\u00C3O autorizado pelo navegador");
  return { linhas };
}

/** O texto que vai para a área de transferência. */
export function textoDoDiagnostico(d: Diagnostico): string {
  // Sem alinhamento por espacos: isto e colado em WhatsApp, e-mail e chamado,
  // onde a fonte nao e monoespacada e o alinhamento vira sujeira.
  const corpo = d.linhas.map(([r, v]) => `${r}: ${v}`).join("\n");
  return `Diagnóstico do Agente de IA (SEI Pro)\n${corpo}`;
}
