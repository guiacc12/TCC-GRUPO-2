// Logs estruturados em JSON (uma linha por evento) — fáceis de filtrar no Railway.
function registrar(nivel, mensagem, meta = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), nivel, mensagem, ...meta }));
}

export const logger = {
  info: (mensagem, meta) => registrar('info', mensagem, meta),
  aviso: (mensagem, meta) => registrar('aviso', mensagem, meta),
  erro: (mensagem, meta) => registrar('erro', mensagem, meta),
};
