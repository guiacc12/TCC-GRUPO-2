import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { banco } from '../config/banco.js';
import { env } from '../config/env.js';
import { ErroHttp } from '../middlewares/erros.js';

export const rotasAuth = Router();

// Força bruta: 10 tentativas de login por IP por minuto
rotasAuth.use(rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false }));

const esquemaLogin = z.object({
  email: z.string().email(),
  senha: z.string().min(1),
});

// Login do painel da empresa
rotasAuth.post('/login', async (req, res, next) => {
  try {
    const { email, senha } = esquemaLogin.parse(req.body);

    const [linhas] = await banco.query(
      `SELECT u.id, u.empresa_id, u.nome, u.senha_hash, u.papel, e.status AS empresa_status, e.nome AS empresa_nome
       FROM usuarios u JOIN empresas e ON e.id = u.empresa_id
       WHERE u.email = ? AND u.ativo = 1`,
      [email]
    );
    const usuario = linhas[0];
    if (!usuario || !(await bcrypt.compare(senha, usuario.senha_hash))) {
      throw new ErroHttp(401, 'E-mail ou senha incorretos');
    }
    if (usuario.empresa_status !== 'ativa') throw new ErroHttp(403, 'Empresa suspensa — contate o suporte');

    await banco.query('UPDATE usuarios SET ultimo_login_em = NOW() WHERE id = ?', [usuario.id]);

    const token = jwt.sign(
      { sub: usuario.id, empresa_id: usuario.empresa_id, papel: usuario.papel, tipo: 'empresa' },
      env.jwtSecret,
      { expiresIn: env.jwtExpiracao }
    );
    res.json({
      sucesso: true,
      token,
      usuario: { id: usuario.id, nome: usuario.nome, papel: usuario.papel, empresa: usuario.empresa_nome },
    });
  } catch (erro) {
    next(erro);
  }
});

// Login do Super Admin
rotasAuth.post('/admin/login', async (req, res, next) => {
  try {
    const { email, senha } = esquemaLogin.parse(req.body);

    const [linhas] = await banco.query(
      'SELECT id, nome, senha_hash FROM super_admins WHERE email = ? AND ativo = 1',
      [email]
    );
    const admin = linhas[0];
    if (!admin || !(await bcrypt.compare(senha, admin.senha_hash))) {
      throw new ErroHttp(401, 'E-mail ou senha incorretos');
    }

    const token = jwt.sign({ sub: admin.id, tipo: 'admin' }, env.jwtSecret, { expiresIn: env.jwtExpiracao });
    res.json({ sucesso: true, token, admin: { id: admin.id, nome: admin.nome } });
  } catch (erro) {
    next(erro);
  }
});
