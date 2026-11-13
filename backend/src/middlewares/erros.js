import { z, ZodError } from 'zod';
import { logger } from '../util/logger.js';

// Mensagens de validação em português para todos os schemas do projeto.
// Mensagens escritas à mão num schema (ex.: .regex(..., 'texto')) têm prioridade.
z.setErrorMap((issue, ctx) => {
  switch (issue.code) {
    case 'invalid_type':
      return { message: issue.received === 'undefined' ? 'Campo obrigatório' : 'Valor inválido' };
    case 'too_small':
      if (issue.type === 'string') {
        return { message: issue.minimum === 1 ? 'Campo obrigatório' : `Mínimo de ${issue.minimum} caracteres` };
      }
      if (issue.type === 'array') return { message: `Informe ao menos ${issue.minimum} item(ns)` };
      return { message: `Valor mínimo: ${issue.minimum}` };
    case 'too_big':
      if (issue.type === 'string') return { message: `Máximo de ${issue.maximum} caracteres` };
      if (issue.type === 'array') return { message: `Máximo de ${issue.maximum} item(ns)` };
      return { message: `Valor máximo: ${issue.maximum}` };
    case 'invalid_string':
      if (issue.validation === 'email') return { message: 'E-mail inválido' };
      if (issue.validation === 'url') return { message: 'URL inválida' };
      return { message: 'Formato inválido' };
    case 'invalid_enum_value':
    case 'invalid_union_discriminator':
      return { message: 'Opção inválida' };
    case 'invalid_literal':
      return { message: 'Valor inválido' };
    default:
      return { message: ctx.defaultError };
  }
});

/** Erro de negócio com status HTTP — lançado pelas rotas/serviços. */
export class ErroHttp extends Error {
  /** `codigo` é opcional e vai na resposta para o frontend reagir sem depender do texto. */
  constructor(status, mensagem, codigo) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
  }
}

/**
 * Falha de serviço externo (Evolution, Pipedrive, PipeRun, LeadPass) com frase em português.
 * `status` é o que o serviço respondeu (0 = nem respondeu); `tecnico` é o texto original,
 * que só vai para log/fila. Devolve sempre 502: um 401 do CRM repassado ao painel
 * derrubaria a sessão do usuário (o frontend trata 401 como sessão expirada).
 */
export function erroExterno(servico, status, tecnico) {
  let frase = `O ${servico} respondeu com erro`;
  if (!status) frase = `Não foi possível conectar ao ${servico}. Tente novamente em instantes`;
  else if (status === 401 || status === 403) frase = `Credencial do ${servico} inválida ou sem permissão`;
  else if (status === 404) frase = `Não encontrado no ${servico}`;
  else if (status === 429) frase = `O ${servico} limitou as chamadas. Aguarde um minuto`;
  else if (status >= 500) frase = `O ${servico} está instável. Tente novamente`;
  else if (status >= 400) frase = `O ${servico} recusou os dados enviados`;

  const erro = new ErroHttp(502, frase);
  erro.tecnico = String(tecnico ?? '');
  erro.codigoHttp = status || null; // gravado pela fila no log de entregas
  return erro;
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
    if (erro.tecnico) {
      logger.aviso('falha em serviço externo', { rota: `${req.method} ${req.originalUrl}`, tecnico: erro.tecnico });
    }
    return res.status(erro.status).json({ sucesso: false, erro: erro.message, ...(erro.codigo && { codigo: erro.codigo }) });
  }
  if (erro.type === 'entity.parse.failed') {
    return res.status(400).json({ sucesso: false, erro: 'JSON malformado' });
  }
  if (erro.type === 'entity.too.large') {
    return res.status(413).json({ sucesso: false, erro: 'Dados grandes demais' });
  }
  if (erro.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ sucesso: false, erro: 'Já existe um registro com esses dados' });
  }
  if (erro.code === 'ER_DATA_TOO_LONG') {
    return res.status(422).json({ sucesso: false, erro: 'Texto longo demais' });
  }
  logger.erro('erro não tratado', { rota: `${req.method} ${req.originalUrl}`, erro: erro.message, stack: erro.stack });
  res.status(500).json({ sucesso: false, erro: 'Erro interno' });
}
