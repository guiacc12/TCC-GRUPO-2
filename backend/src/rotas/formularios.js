import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { banco, emTransacao } from '../config/banco.js';
import { ErroHttp } from '../middlewares/erros.js';

export const rotasFormularios = Router();

const esquemaCampo = z.object({
  nome_campo: z.string().min(1).max(80).regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, 'use letras, números e _ (começando por letra)'),
  rotulo: z.string().min(1).max(160),
  tipo: z.enum(['texto', 'email', 'telefone', 'textarea', 'select', 'checkbox', 'numero', 'data', 'oculto']).default('texto'),
  papel: z.enum(['nome', 'email', 'telefone', 'personalizado']).default('personalizado'),
  obrigatorio: z.boolean().default(false),
  placeholder: z.string().max(160).optional(),
  opcoes: z.array(z.string()).optional(),
  mapeamento_crm: z.array(z.string().max(160)).max(5).optional().nullable(),
});

const esquemaFormulario = z.object({
  nome: z.string().min(2).max(160),
  mensagem_sucesso: z.string().max(255).optional(),
  redirect_url: z.string().url().max(500).optional(),
  ativo: z.boolean().default(true),
  origem: z.string().max(160).optional().nullable(),
  tags: z.array(z.string().max(80)).max(20).optional().nullable(),
  mapeamentos_fixos_crm: z.array(z.object({
    campo: z.string().max(160),
    valor: z.union([z.string(), z.array(z.string())]),
    rotulo: z.string().max(160).optional(),
  })).max(20).optional().nullable(),
  mapeamentos_utm_crm: z.array(z.object({
    utm_param: z.enum(['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']),
    campo: z.string().max(160),
  })).max(10).optional().nullable(),
  leadpass_tags: z.array(z.string().max(160)).max(50).optional().nullable(),
  leadpass_campos_fixos: z.array(z.object({
    tipo: z.enum(['contact', 'contact_cf', 'opp_cf']),
    campo: z.string().max(160),
    origem: z.enum(['fixo', 'pergunta']).default('fixo'),
    valor: z.union([z.string(), z.array(z.string())]).optional().nullable(),
    campo_origem: z.string().max(80).optional().nullable(),
  })).max(20).optional().nullable(),
  campos: z.array(esquemaCampo).min(1, 'o formulário precisa de ao menos um campo'),
});

function validarPapeisUnicos(campos) {
  for (const papel of ['nome', 'email', 'telefone']) {
    if (campos.filter((c) => c.papel === papel).length > 1) {
      throw new ErroHttp(422, `Apenas um campo pode ter o papel "${papel}"`);
    }
  }
}

async function inserirCampos(cx, formularioId, campos) {
  for (const [indice, campo] of campos.entries()) {
    await cx.query(
      `INSERT INTO formulario_campos
         (formulario_id, nome_campo, rotulo, tipo, papel, obrigatorio, placeholder, opcoes_json, mapeamento_crm, ordem)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        formularioId, campo.nome_campo, campo.rotulo, campo.tipo, campo.papel,
        campo.obrigatorio ? 1 : 0, campo.placeholder ?? null,
        campo.opcoes ? JSON.stringify(campo.opcoes) : null,
        campo.mapeamento_crm?.length ? JSON.stringify(campo.mapeamento_crm) : null,
        indice,
      ]
    );
  }
}

function normalizarTags(tags) {
  if (!tags || tags.length === 0) return null;
  return JSON.stringify(tags);
}

rotasFormularios.post('/', async (req, res, next) => {
  try {
    const dados = esquemaFormulario.parse(req.body);
    validarPapeisUnicos(dados.campos);
    const formKey = crypto.randomUUID();

    const formularioId = await emTransacao(async (cx) => {
      const [resultado] = await cx.query(
        `INSERT INTO formularios
           (empresa_id, nome, form_key, mensagem_sucesso, redirect_url, ativo, origem, tags,
            mapeamentos_fixos_crm, mapeamentos_utm_crm, leadpass_tags, leadpass_campos_fixos)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.empresaId, dados.nome, formKey,
          dados.mensagem_sucesso ?? null, dados.redirect_url ?? null,
          dados.ativo ? 1 : 0,
          dados.origem ?? null, normalizarTags(dados.tags),
          dados.mapeamentos_fixos_crm?.length ? JSON.stringify(dados.mapeamentos_fixos_crm) : null,
          dados.mapeamentos_utm_crm?.length ? JSON.stringify(dados.mapeamentos_utm_crm) : null,
          dados.leadpass_tags?.length ? JSON.stringify(dados.leadpass_tags) : null,
          dados.leadpass_campos_fixos?.length ? JSON.stringify(dados.leadpass_campos_fixos) : null,
        ]
      );
      await inserirCampos(cx, resultado.insertId, dados.campos);
      return resultado.insertId;
    });

    res.status(201).json({ sucesso: true, formulario_id: formularioId, form_key: formKey });
  } catch (erro) {
    if (erro.code === 'ER_DUP_ENTRY') return next(new ErroHttp(409, 'Há campos com nomes repetidos'));
    next(erro);
  }
});

rotasFormularios.get('/', async (req, res, next) => {
  try {
    const [linhas] = await banco.query(
      `SELECT f.id, f.nome, f.form_key, f.ativo, f.origem, f.tags, f.criado_em,
              (SELECT COUNT(*) FROM leads l WHERE l.formulario_id = f.id) AS total_leads
       FROM formularios f WHERE f.empresa_id = ? ORDER BY f.criado_em DESC`,
      [req.empresaId]
    );
    res.json({ sucesso: true, formularios: linhas });
  } catch (erro) {
    next(erro);
  }
});

rotasFormularios.get('/:id', async (req, res, next) => {
  try {
    const [formularios] = await banco.query(
      `SELECT id, nome, form_key, mensagem_sucesso, redirect_url, ativo, origem, tags,
              mapeamentos_fixos_crm, mapeamentos_utm_crm, leadpass_tags, leadpass_campos_fixos, criado_em
       FROM formularios WHERE id = ? AND empresa_id = ?`,
      [req.params.id, req.empresaId]
    );
    if (formularios.length === 0) throw new ErroHttp(404, 'Formulário não encontrado');

    const [campos] = await banco.query(
      `SELECT nome_campo, rotulo, tipo, papel, obrigatorio, placeholder, opcoes_json, mapeamento_crm, ordem
       FROM formulario_campos WHERE formulario_id = ? ORDER BY ordem`,
      [req.params.id]
    );
    res.json({ sucesso: true, formulario: { ...formularios[0], campos } });
  } catch (erro) {
    next(erro);
  }
});

rotasFormularios.put('/:id', async (req, res, next) => {
  try {
    const dados = esquemaFormulario.parse(req.body);
    validarPapeisUnicos(dados.campos);

    await emTransacao(async (cx) => {
      const [resultado] = await cx.query(
        `UPDATE formularios SET nome = ?, mensagem_sucesso = ?, redirect_url = ?, ativo = ?, origem = ?, tags = ?,
                mapeamentos_fixos_crm = ?, mapeamentos_utm_crm = ?, leadpass_tags = ?, leadpass_campos_fixos = ?
         WHERE id = ? AND empresa_id = ?`,
        [
          dados.nome, dados.mensagem_sucesso ?? null, dados.redirect_url ?? null,
          dados.ativo ? 1 : 0, dados.origem ?? null, normalizarTags(dados.tags),
          dados.mapeamentos_fixos_crm?.length ? JSON.stringify(dados.mapeamentos_fixos_crm) : null,
          dados.mapeamentos_utm_crm?.length ? JSON.stringify(dados.mapeamentos_utm_crm) : null,
          dados.leadpass_tags?.length ? JSON.stringify(dados.leadpass_tags) : null,
          dados.leadpass_campos_fixos?.length ? JSON.stringify(dados.leadpass_campos_fixos) : null,
          req.params.id, req.empresaId,
        ]
      );
      if (resultado.affectedRows === 0) throw new ErroHttp(404, 'Formulário não encontrado');
      await cx.query('DELETE FROM formulario_campos WHERE formulario_id = ?', [req.params.id]);
      await inserirCampos(cx, req.params.id, dados.campos);
    });

    res.json({ sucesso: true });
  } catch (erro) {
    next(erro);
  }
});

rotasFormularios.delete('/:id', async (req, res, next) => {
  try {
    const [resultado] = await banco.query(
      'DELETE FROM formularios WHERE id = ? AND empresa_id = ?',
      [req.params.id, req.empresaId]
    );
    if (resultado.affectedRows === 0) throw new ErroHttp(404, 'Formulário não encontrado');
    res.json({ sucesso: true });
  } catch (erro) {
    next(erro);
  }
});
