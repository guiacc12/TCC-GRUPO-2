import { Router } from 'express';
import { banco } from '../config/banco.js';
import { ErroHttp } from '../middlewares/erros.js';

export const rotasLeads = Router();

// Listagem com filtros do painel — toda condição é parametrizada e ancorada em empresa_id
rotasLeads.get('/', async (req, res, next) => {
  try {
    const condicoes = ['l.empresa_id = ?'];
    const parametros = [req.empresaId];

    if (req.query.formulario_id) {
      condicoes.push('l.formulario_id = ?');
      parametros.push(req.query.formulario_id);
    }
    if (req.query.status) {
      condicoes.push('l.status = ?');
      parametros.push(req.query.status);
    }
    if (req.query.utm_source) {
      condicoes.push('l.utm_source = ?');
      parametros.push(req.query.utm_source);
    }
    if (req.query.de) {
      condicoes.push('l.criado_em >= ?');
      parametros.push(req.query.de);
    }
    if (req.query.ate) {
      condicoes.push('l.criado_em < DATE_ADD(?, INTERVAL 1 DAY)');
      parametros.push(req.query.ate);
    }
    if (req.query.busca) {
      condicoes.push('(l.nome LIKE ? OR l.email LIKE ? OR l.telefone LIKE ?)');
      const termo = `%${req.query.busca}%`;
      parametros.push(termo, termo, termo);
    }

    const pagina = Math.max(1, Number(req.query.pagina) || 1);
    const porPagina = Math.min(100, Math.max(1, Number(req.query.por_pagina) || 25));
    const where = condicoes.join(' AND ');

    const [[{ total }]] = await banco.query(`SELECT COUNT(*) AS total FROM leads l WHERE ${where}`, parametros);
    const [linhas] = await banco.query(
      `SELECT l.id, l.nome, l.email, l.telefone, l.status, l.utm_source, l.utm_campaign,
              l.crm_id_externo, l.criado_em, f.nome AS formulario_nome
       FROM leads l LEFT JOIN formularios f ON f.id = l.formulario_id
       WHERE ${where} ORDER BY l.criado_em DESC LIMIT ? OFFSET ?`,
      [...parametros, porPagina, (pagina - 1) * porPagina]
    );

    res.json({ sucesso: true, total, pagina, por_pagina: porPagina, leads: linhas });
  } catch (erro) {
    next(erro);
  }
});

// Exclusão em lote — só apaga leads da própria empresa
rotasLeads.delete('/', async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
    if (ids.length === 0) throw new ErroHttp(422, 'Informe ao menos um id para excluir');
    if (ids.length > 500) throw new ErroHttp(422, 'Máximo de 500 leads por operação');

    const [resultado] = await banco.query(
      `DELETE FROM leads WHERE empresa_id = ? AND id IN (${ids.map(() => '?').join(',')})`,
      [req.empresaId, ...ids]
    );
    res.json({ sucesso: true, excluidos: resultado.affectedRows });
  } catch (erro) {
    next(erro);
  }
});

// Reenvio (replay) de um lead — reabre o lead e cria um novo job de roteamento CRM.
// Permitido para status 'erro' (falha) e 'entregue' (força nova oportunidade, ex.:
// correção de um merge indevido no CRM). Bloqueado para 'novo'/'processando' (já em andamento).
rotasLeads.post('/:id/replay', async (req, res, next) => {
  try {
    const [leads] = await banco.query(
      'SELECT id, status FROM leads WHERE id = ? AND empresa_id = ?',
      [req.params.id, req.empresaId]
    );
    if (leads.length === 0) throw new ErroHttp(404, 'Lead não encontrado');
    if (!['erro', 'entregue'].includes(leads[0].status)) {
      throw new ErroHttp(422, 'Só é possível reenviar leads com status de erro ou já entregues');
    }

    const [jobsEmAndamento] = await banco.query(
      `SELECT id FROM lead_jobs WHERE lead_id = ? AND empresa_id = ? AND tipo = 'rotear_crm' AND status IN ('pendente', 'processando')`,
      [req.params.id, req.empresaId]
    );
    if (jobsEmAndamento.length > 0) throw new ErroHttp(422, 'Este lead já está sendo processado');

    await banco.query("UPDATE leads SET status = 'novo' WHERE id = ? AND empresa_id = ?", [req.params.id, req.empresaId]);
    await banco.query(
      "INSERT INTO lead_jobs (empresa_id, lead_id, tipo) VALUES (?, ?, 'rotear_crm')",
      [req.empresaId, req.params.id]
    );

    res.json({ sucesso: true });
  } catch (erro) {
    next(erro);
  }
});

// Grupos de leads com o mesmo crm_id_externo (possível merge indevido de deals no CRM)
rotasLeads.get('/duplicados-crm', async (req, res, next) => {
  try {
    const [grupos] = await banco.query(
      `SELECT crm_id_externo FROM leads
       WHERE empresa_id = ? AND crm_id_externo IS NOT NULL AND crm_id_externo <> ''
       GROUP BY crm_id_externo HAVING COUNT(*) > 1`,
      [req.empresaId]
    );
    if (grupos.length === 0) return res.json({ sucesso: true, grupos: [] });

    const idsExternos = grupos.map((g) => g.crm_id_externo);
    const [linhas] = await banco.query(
      `SELECT id, nome, email, telefone, crm_id_externo, criado_em FROM leads
       WHERE empresa_id = ? AND crm_id_externo IN (${idsExternos.map(() => '?').join(',')})
       ORDER BY crm_id_externo, criado_em`,
      [req.empresaId, ...idsExternos]
    );

    const porCrmId = new Map();
    linhas.forEach((lead) => {
      if (!porCrmId.has(lead.crm_id_externo)) porCrmId.set(lead.crm_id_externo, []);
      porCrmId.get(lead.crm_id_externo).push(lead);
    });

    res.json({
      sucesso: true,
      grupos: [...porCrmId.entries()].map(([crm_id_externo, leads]) => ({ crm_id_externo, leads })),
    });
  } catch (erro) {
    next(erro);
  }
});

// Correção manual do id do deal no CRM — uso: usuário recria o deal manualmente
// no CRM após um merge indevido e vincula o novo id aqui.
rotasLeads.patch('/:id/crm-id', async (req, res, next) => {
  try {
    const [leads] = await banco.query(
      'SELECT id FROM leads WHERE id = ? AND empresa_id = ?',
      [req.params.id, req.empresaId]
    );
    if (leads.length === 0) throw new ErroHttp(404, 'Lead não encontrado');

    const valor = typeof req.body?.crm_id_externo === 'string' ? req.body.crm_id_externo.trim() : '';
    await banco.query(
      'UPDATE leads SET crm_id_externo = ? WHERE id = ? AND empresa_id = ?',
      [valor || null, req.params.id, req.empresaId]
    );
    res.json({ sucesso: true });
  } catch (erro) {
    next(erro);
  }
});

// Detalhe do lead + trilha de entregas (auditoria)
rotasLeads.get('/:id', async (req, res, next) => {
  try {
    const [leads] = await banco.query(
      `SELECT l.*, f.nome AS formulario_nome
       FROM leads l LEFT JOIN formularios f ON f.id = l.formulario_id
       WHERE l.id = ? AND l.empresa_id = ?`,
      [req.params.id, req.empresaId]
    );
    if (leads.length === 0) throw new ErroHttp(404, 'Lead não encontrado');

    const [entregas] = await banco.query(
      'SELECT canal, destino, sucesso, codigo_http, detalhe, criado_em FROM logs_entrega WHERE lead_id = ? ORDER BY criado_em',
      [req.params.id]
    );
    res.json({ sucesso: true, lead: leads[0], entregas });
  } catch (erro) {
    next(erro);
  }
});
