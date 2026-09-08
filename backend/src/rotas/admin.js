import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { banco, emTransacao } from '../config/banco.js';
import { autenticarAdmin } from '../middlewares/autenticacao.js';
import { ErroHttp } from '../middlewares/erros.js';

export const rotasAdmin = Router();
rotasAdmin.use(autenticarAdmin);

const esquemaNovaEmpresa = z.object({
  nome: z.string().min(2).max(160),
  slug: z.string().min(2).max(80).regex(/^[a-z0-9-]+$/, 'use apenas letras minúsculas, números e hífens'),
  email_contato: z.string().email().optional(),
  usuario: z.object({
    nome: z.string().min(2).max(160),
    email: z.string().email(),
    senha: z.string().min(8, 'mínimo 8 caracteres'),
  }),
});

// Cria a empresa já com o primeiro usuário (proprietário)
rotasAdmin.post('/empresas', async (req, res, next) => {
  try {
    const dados = esquemaNovaEmpresa.parse(req.body);
    const senhaHash = await bcrypt.hash(dados.usuario.senha, 10);

    const empresaId = await emTransacao(async (cx) => {
      const [resEmpresa] = await cx.query(
        'INSERT INTO empresas (nome, slug, email_contato, criado_por_admin_id) VALUES (?, ?, ?, ?)',
        [dados.nome, dados.slug, dados.email_contato ?? null, req.adminId]
      );
      await cx.query(
        'INSERT INTO usuarios (empresa_id, nome, email, senha_hash, papel) VALUES (?, ?, ?, ?, ?)',
        [resEmpresa.insertId, dados.usuario.nome, dados.usuario.email, senhaHash, 'proprietario']
      );
      return resEmpresa.insertId;
    });

    res.status(201).json({ sucesso: true, empresa_id: empresaId });
  } catch (erro) {
    if (erro.code === 'ER_DUP_ENTRY') {
      return next(new ErroHttp(409, 'Slug da empresa ou e-mail do usuário já cadastrado'));
    }
    next(erro);
  }
});

rotasAdmin.get('/empresas', async (req, res, next) => {
  try {
    const [linhas] = await banco.query(
      `SELECT e.id, e.nome, e.slug, e.email_contato, e.status, e.criado_em,
              (SELECT COUNT(*) FROM usuarios u WHERE u.empresa_id = e.id)    AS total_usuarios,
              (SELECT COUNT(*) FROM formularios f WHERE f.empresa_id = e.id) AS total_formularios,
              (SELECT COUNT(*) FROM leads l WHERE l.empresa_id = e.id)       AS total_leads
       FROM empresas e ORDER BY e.criado_em DESC`
    );
    res.json({ sucesso: true, empresas: linhas });
  } catch (erro) {
    next(erro);
  }
});

const esquemaStatus = z.object({ status: z.enum(['ativa', 'suspensa', 'cancelada']) });

// Suspender/reativar/cancelar tenant — efeito imediato (middleware reconsulta o status)
rotasAdmin.patch('/empresas/:id/status', async (req, res, next) => {
  try {
    const { status } = esquemaStatus.parse(req.body);
    const [resultado] = await banco.query('UPDATE empresas SET status = ? WHERE id = ?', [status, req.params.id]);
    if (resultado.affectedRows === 0) throw new ErroHttp(404, 'Empresa não encontrada');
    res.json({ sucesso: true });
  } catch (erro) {
    next(erro);
  }
});
