import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { banco } from '../config/banco.js';
import { ErroHttp } from './erros.js';

function extrairToken(req) {
  const cabecalho = req.headers.authorization || '';
  if (!cabecalho.startsWith('Bearer ')) throw new ErroHttp(401, 'Token ausente');
  return cabecalho.slice(7);
}

function verificarJwt(req) {
  try {
    return jwt.verify(extrairToken(req), env.jwtSecret);
  } catch (erro) {
    if (erro instanceof ErroHttp) throw erro;
    throw new ErroHttp(401, 'Token inválido ou expirado');
  }
}

/**
 * Painel da empresa. empresa_id SEMPRE sai do token — nunca do corpo/query.
 * Reconsulta o status da empresa a cada requisição: suspensão tem efeito imediato.
 */
export async function autenticarEmpresa(req, res, next) {
  try {
    const payload = verificarJwt(req);
    if (payload.tipo !== 'empresa') throw new ErroHttp(403, 'Acesso restrito ao painel da empresa');

    const [linhas] = await banco.query(
      `SELECT e.status FROM usuarios u JOIN empresas e ON e.id = u.empresa_id
       WHERE u.id = ? AND u.empresa_id = ? AND u.ativo = 1`,
      [payload.sub, payload.empresa_id]
    );
    if (linhas.length === 0) throw new ErroHttp(401, 'Sessão inválida');
    if (linhas[0].status !== 'ativa') throw new ErroHttp(403, 'Empresa suspensa — contate o suporte');

    req.empresaId = payload.empresa_id;
    req.usuarioId = payload.sub;
    req.papel = payload.papel;
    next();
  } catch (erro) {
    next(erro);
  }
}

/** Painel do Super Admin. */
export async function autenticarAdmin(req, res, next) {
  try {
    const payload = verificarJwt(req);
    if (payload.tipo !== 'admin') throw new ErroHttp(403, 'Acesso restrito ao Super Admin');

    const [linhas] = await banco.query('SELECT id FROM super_admins WHERE id = ? AND ativo = 1', [payload.sub]);
    if (linhas.length === 0) throw new ErroHttp(401, 'Sessão inválida');

    req.adminId = payload.sub;
    next();
  } catch (erro) {
    next(erro);
  }
}
