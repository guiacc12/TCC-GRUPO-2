import { Router } from 'express';
import { z } from 'zod';
import { banco } from '../config/banco.js';
import { cifrar, decifrar } from '../util/criptografia.js';
import { ErroHttp } from '../middlewares/erros.js';
import { env } from '../config/env.js';
import {
  criarInstancia, obterQrCode, obterEstadoConexao, removerInstancia, listarGrupos,
} from '../servicos/evolution.js';

export const rotasWhatsapp = Router();

const MAPA_ESTADO = { open: 'conectada', connecting: 'conectando', close: 'desconectada' };

async function buscarInstancia(empresaId, instanciaId) {
  const [linhas] = await banco.query(
    'SELECT * FROM whatsapp_instancias WHERE id = ? AND empresa_id = ?',
    [instanciaId, empresaId]
  );
  if (linhas.length === 0) throw new ErroHttp(404, 'Instância não encontrada');
  return linhas[0];
}

// ---------------------------------------------------------------------------
// Instâncias
// ---------------------------------------------------------------------------

rotasWhatsapp.get('/instancias', async (req, res, next) => {
  try {
    const [linhas] = await banco.query(
      `SELECT id, instance_name, numero, status_conexao, qrcode_atualizado_em, criado_em
       FROM whatsapp_instancias WHERE empresa_id = ? ORDER BY criado_em DESC`,
      [req.empresaId]
    );
    res.json({ sucesso: true, instancias: linhas });
  } catch (erro) {
    next(erro);
  }
});

const esquemaNovaInstancia = z.object({
  nome: z.string().min(2).max(40).regex(/^[a-zA-Z0-9 _-]+$/, 'use letras, números, espaços, _ ou -'),
});

// "Nova Conexão": cria na Evolution e guarda o token da instância cifrado
rotasWhatsapp.post('/instancias', async (req, res, next) => {
  try {
    const { nome } = esquemaNovaInstancia.parse(req.body);
    const sufixo = nome.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const instanceName = `emp${req.empresaId}_${sufixo}`;

    const [existentes] = await banco.query(
      'SELECT id FROM whatsapp_instancias WHERE instance_name = ?', [instanceName]
    );
    if (existentes.length > 0) throw new ErroHttp(409, 'Já existe uma conexão com esse nome');

    const criada = await criarInstancia(instanceName);
    if (!criada.token) throw new ErroHttp(502, 'Evolution não devolveu o token da instância');

    const [resultado] = await banco.query(
      `INSERT INTO whatsapp_instancias
         (empresa_id, instance_name, instance_id, token_criptografado, qrcode_base64, qrcode_atualizado_em, status_conexao)
       VALUES (?, ?, ?, ?, ?, ?, 'conectando')`,
      [
        req.empresaId, instanceName, criada.instanceId, cifrar(criada.token),
        criada.qrcodeBase64, criada.qrcodeBase64 ? new Date() : null,
      ]
    );

    res.status(201).json({
      sucesso: true,
      instancia: { id: resultado.insertId, instance_name: instanceName, qrcode_base64: criada.qrcodeBase64 },
    });
  } catch (erro) {
    next(erro);
  }
});

// QR code para renderizar no painel (re-polling renova o código expirado)
rotasWhatsapp.get('/instancias/:id/qrcode', async (req, res, next) => {
  try {
    const instancia = await buscarInstancia(req.empresaId, req.params.id);
    const qr = await obterQrCode(instancia.instance_name);

    if (qr.base64) {
      await banco.query(
        'UPDATE whatsapp_instancias SET qrcode_base64 = ?, qrcode_atualizado_em = NOW() WHERE id = ?',
        [qr.base64, instancia.id]
      );
    }
    res.json({ sucesso: true, qrcode: { base64: qr.base64 ?? instancia.qrcode_base64, code: qr.code, pairing_code: qr.pairingCode } });
  } catch (erro) {
    next(erro);
  }
});

// Estado da conexão — sincroniza o espelho local com a Evolution
rotasWhatsapp.get('/instancias/:id/estado', async (req, res, next) => {
  try {
    const instancia = await buscarInstancia(req.empresaId, req.params.id);
    const estado = await obterEstadoConexao(instancia.instance_name);
    const statusLocal = MAPA_ESTADO[estado] ?? 'desconectada';

    await banco.query('UPDATE whatsapp_instancias SET status_conexao = ? WHERE id = ?', [statusLocal, instancia.id]);
    res.json({ sucesso: true, estado: statusLocal });
  } catch (erro) {
    next(erro);
  }
});

// Credenciais para o n8n do cliente: instanceName + token da instância
rotasWhatsapp.get('/instancias/:id/credenciais', async (req, res, next) => {
  try {
    const instancia = await buscarInstancia(req.empresaId, req.params.id);
    res.json({
      sucesso: true,
      credenciais: {
        instance_name: instancia.instance_name,
        token: decifrar(instancia.token_criptografado),
        base_url: env.evolution.baseUrl,
      },
    });
  } catch (erro) {
    next(erro);
  }
});

// Grupos da instância — para escolher o grupo de aviso das automações
rotasWhatsapp.get('/instancias/:id/grupos', async (req, res, next) => {
  try {
    const instancia = await buscarInstancia(req.empresaId, req.params.id);
    res.json({ sucesso: true, grupos: await listarGrupos(instancia.instance_name) });
  } catch (erro) {
    next(erro);
  }
});

rotasWhatsapp.delete('/instancias/:id', async (req, res, next) => {
  try {
    const instancia = await buscarInstancia(req.empresaId, req.params.id);
    await removerInstancia(instancia.instance_name);
    await banco.query('DELETE FROM whatsapp_instancias WHERE id = ?', [instancia.id]);
    res.json({ sucesso: true });
  } catch (erro) {
    next(erro);
  }
});

// ---------------------------------------------------------------------------
// Automações (disparos pós-CRM)
// ---------------------------------------------------------------------------

const esquemaAutomacao = z
  .object({
    instancia_id: z.coerce.number().int().positive(),
    formulario_id: z.coerce.number().int().positive().nullable().optional(),
    tipo_destino: z.enum(['contato_lead', 'grupo']),
    grupo_jid: z.preprocess((v) => v || undefined, z.string().regex(/@g\.us$/, 'JID de grupo deve terminar em @g.us').optional()),
    grupo_nome: z.preprocess((v) => v || undefined, z.string().max(160).optional()),
    mensagem_template: z.string().min(1),
    delay_segundos_min: z.coerce.number().int().min(0).max(600).default(2),
    delay_segundos_max: z.coerce.number().int().min(0).max(600).default(8),
    ativo: z.boolean().default(true),
  })
  .refine((a) => a.tipo_destino !== 'grupo' || a.grupo_jid, {
    message: 'grupo_jid é obrigatório quando o destino é grupo',
    path: ['grupo_jid'],
  })
  .refine((a) => a.delay_segundos_max >= a.delay_segundos_min, {
    message: 'delay máximo deve ser ≥ delay mínimo',
    path: ['delay_segundos_max'],
  });

async function validarVinculos(req, dados) {
  await buscarInstancia(req.empresaId, dados.instancia_id);
  if (dados.formulario_id) {
    const [formularios] = await banco.query(
      'SELECT id FROM formularios WHERE id = ? AND empresa_id = ?',
      [dados.formulario_id, req.empresaId]
    );
    if (formularios.length === 0) throw new ErroHttp(404, 'Formulário não encontrado');
  }
}

rotasWhatsapp.get('/automacoes', async (req, res, next) => {
  try {
    const [linhas] = await banco.query(
      `SELECT a.id, a.instancia_id, i.instance_name, a.formulario_id, f.nome AS formulario_nome,
              a.tipo_destino, a.grupo_jid, a.grupo_nome, a.mensagem_template,
              a.delay_segundos_min, a.delay_segundos_max, a.ativo, a.criado_em
       FROM whatsapp_automacoes a
       JOIN whatsapp_instancias i ON i.id = a.instancia_id
       LEFT JOIN formularios f ON f.id = a.formulario_id
       WHERE a.empresa_id = ? ORDER BY a.ordem, a.criado_em`,
      [req.empresaId]
    );
    res.json({ sucesso: true, automacoes: linhas });
  } catch (erro) {
    next(erro);
  }
});

rotasWhatsapp.post('/automacoes', async (req, res, next) => {
  try {
    const dados = esquemaAutomacao.parse(req.body);
    await validarVinculos(req, dados);

    const [resultado] = await banco.query(
      `INSERT INTO whatsapp_automacoes
         (empresa_id, instancia_id, formulario_id, tipo_destino, grupo_jid, grupo_nome,
          mensagem_template, delay_segundos_min, delay_segundos_max, ativo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.empresaId, dados.instancia_id, dados.formulario_id ?? null, dados.tipo_destino,
        dados.grupo_jid ?? null, dados.grupo_nome ?? null, dados.mensagem_template,
        dados.delay_segundos_min, dados.delay_segundos_max, dados.ativo ? 1 : 0,
      ]
    );
    res.status(201).json({ sucesso: true, automacao_id: resultado.insertId });
  } catch (erro) {
    next(erro);
  }
});

rotasWhatsapp.put('/automacoes/:id', async (req, res, next) => {
  try {
    const dados = esquemaAutomacao.parse(req.body);
    await validarVinculos(req, dados);

    const [resultado] = await banco.query(
      `UPDATE whatsapp_automacoes SET instancia_id = ?, formulario_id = ?, tipo_destino = ?,
              grupo_jid = ?, grupo_nome = ?, mensagem_template = ?,
              delay_segundos_min = ?, delay_segundos_max = ?, ativo = ?
       WHERE id = ? AND empresa_id = ?`,
      [
        dados.instancia_id, dados.formulario_id ?? null, dados.tipo_destino,
        dados.grupo_jid ?? null, dados.grupo_nome ?? null, dados.mensagem_template,
        dados.delay_segundos_min, dados.delay_segundos_max, dados.ativo ? 1 : 0,
        req.params.id, req.empresaId,
      ]
    );
    if (resultado.affectedRows === 0) throw new ErroHttp(404, 'Automação não encontrada');
    res.json({ sucesso: true });
  } catch (erro) {
    next(erro);
  }
});

rotasWhatsapp.delete('/automacoes/:id', async (req, res, next) => {
  try {
    const [resultado] = await banco.query(
      'DELETE FROM whatsapp_automacoes WHERE id = ? AND empresa_id = ?',
      [req.params.id, req.empresaId]
    );
    if (resultado.affectedRows === 0) throw new ErroHttp(404, 'Automação não encontrada');
    res.json({ sucesso: true });
  } catch (erro) {
    next(erro);
  }
});
