import { ZodError } from 'zod';
import { logger } from '../util/logger.js';

/** Erro de negócio com status HTTP — lançado pelas rotas/serviços. */
export class ErroHttp extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

export function rota404(req, res) {
  res.status(404).json({ sucesso: false, erro: 'Rota não encontrada' });
}

// eslint-disable-next-line no-unused-vars
export function tratadorDeErros(erro, req, res, next) {
  if (erro instanceof ZodError) {
    return res.status(422).json({
      sucesso: false,
      erro: 'Dados inválidos',
      detalhes: erro.errors.map((e) => ({ campo: e.path.join('.'), mensagem: e.message })),
    });
  }
  if (erro instanceof ErroHttp) {
    return res.status(erro.status).json({ sucesso: false, erro: erro.message });
  }
  if (erro.type === 'entity.parse.failed') {
    return res.status(400).json({ sucesso: false, erro: 'JSON malformado' });
  }
  logger.erro('erro não tratado', { rota: `${req.method} ${req.originalUrl}`, erro: erro.message, stack: erro.stack });
  res.status(500).json({ sucesso: false, erro: 'Erro interno' });
}
