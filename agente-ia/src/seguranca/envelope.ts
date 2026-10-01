/**
 * Envelope do conteúdo de documento entregue ao modelo.
 *
 * Delimitar não basta se o delimitador for conhecido: o próprio documento
 * escreve o fechamento e segue "do lado de fora", como instrução. Por isso o
 * envelope leva um NONCE sorteado por conversa — o documento foi escrito antes
 * e não tem como adivinhá-lo — e qualquer tentativa de fechamento dentro do
 * conteúdo é desarmada antes de entrar.
 */

/** Sorteia o identificador do envelope desta conversa. */
export function nonceDaConversa(): string {
  try {
    const b = new Uint8Array(4);
    crypto.getRandomValues(b);
    return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  } catch {
    return Math.random().toString(16).slice(2, 10);
  }
}

/**
 * Põe o conteúdo dentro do envelope, desarmando os fechamentos que ele trouxer.
 *
 * O desarme troca `<` por `‹` apenas nas tentativas de fechamento: o texto
 * continua legível (e citável) sem poder encerrar a delimitação.
 */
export function envelopar(id: string, texto: string, nonce: string): string {
  const semFechamento = texto.replace(/<\/\s*documento\b[^>]*>/gi, (m) => `‹${m.slice(1)}`);
  const semNonce = semFechamento.split(nonce).join("‹nonce omitido›");
  return `<documento id="${id}" nonce="${nonce}">\n${semNonce}\n</documento nonce="${nonce}">`;
}
