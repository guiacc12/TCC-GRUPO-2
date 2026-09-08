const pausa = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

/**
 * fetch com retry/backoff exponencial para 429 e 5xx (regra das integrações).
 * Respeita o header Retry-After quando presente (PipeRun envia em segundos).
 * Erros de rede também são re-tentados. Outras respostas voltam como estão —
 * cabe ao chamador validar status e envelope `success`.
 */
export async function requisicaoComRetry(url, opcoes = {}, { tentativas = 3, baseMs = 500 } = {}) {
  for (let tentativa = 0; ; tentativa++) {
    let resposta;
    try {
      resposta = await fetch(url, opcoes);
    } catch (erro) {
      if (tentativa >= tentativas) throw erro;
      await pausa(baseMs * 2 ** tentativa);
      continue;
    }

    if ((resposta.status === 429 || resposta.status >= 500) && tentativa < tentativas) {
      const retryAfter = Number(resposta.headers.get('retry-after'));
      await pausa(retryAfter > 0 ? retryAfter * 1000 : baseMs * 2 ** tentativa);
      continue;
    }
    return resposta;
  }
}
