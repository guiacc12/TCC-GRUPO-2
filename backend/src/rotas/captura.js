import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { banco, emTransacao } from '../config/banco.js';
import { env } from '../config/env.js';
import { normalizarTelefone } from '../util/telefone.js';
import { logger } from '../util/logger.js';

/**
 * Endpoint PÚBLICO de captura — a rota mais exposta do sistema; tratada como hostil.
 * Defesas: form_key como credencial, CORS restrito aos domínios do tenant,
 * rate limit por IP, honeypot, whitelist de campos e limite de tamanho.
 *
 * Contrato do payload (usado pelos embeds da fase 4):
 *   chaves normais  → valores dos campos do formulário (whitelist em formulario_campos)
 *   _utm            → { utm_source, utm_medium, utm_campaign, utm_term, utm_content }
 *   _referrer       → document.referrer
 *   _pagina         → URL da página de captura
 *   _gotcha         → honeypot: humano deixa vazio; bot preenche e é descartado
 */
export const rotasCaptura = Router();

// Idempotência em memória — TTL 10 min (suficiente para Railway single-instance).
// Impede que a mesma sessão de formulário crie leads duplicados mesmo que o
// evento de submit dispare mais de uma vez (ex.: Elementor + script de interceptação).
const _idemProcessados = new Map();
setInterval(() => {
  const corte = Date.now() - 10 * 60 * 1000;
  for (const [k, t] of _idemProcessados) {
    if (t < corte) _idemProcessados.delete(k);
  }
}, 5 * 60 * 1000).unref?.();

const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

rotasCaptura.use(
  rateLimit({
    windowMs: env.captura.janelaMs,
    limit: env.captura.maxPorJanela,
    standardHeaders: true,
    legacyHeaders: false,
    message: { sucesso: false, erro: 'Muitas requisições — tente novamente em instantes' },
  })
);

const TAMANHO_MAXIMO_VALOR = 1000;

// Carrega formulário + domínios e aplica o CORS dinâmico do tenant.
// Roda antes de tudo (inclusive do preflight) para que até respostas de erro
// sejam legíveis pelo script de embed.
async function carregarContexto(req, res, next) {
  try {
    const [formularios] = await banco.query(
      `SELECT f.id, f.empresa_id, f.mensagem_sucesso, f.redirect_url, f.origem, f.tags, f.mapeamentos_fixos_crm, f.mapeamentos_utm_crm
       FROM formularios f JOIN empresas e ON e.id = f.empresa_id
       WHERE f.form_key = ? AND f.ativo = 1 AND e.status = 'ativa'`,
      [req.params.formKey]
    );
    if (formularios.length === 0) {
      return res.status(404).json({ sucesso: false, erro: 'Formulário não encontrado ou inativo' });
    }
    req.formulario = formularios[0];

    const origin = req.headers.origin;
    if (origin) {
      const [dominios] = await banco.query(
        'SELECT 1 FROM dominios_autorizados WHERE empresa_id = ? AND dominio = ?',
        [req.formulario.empresa_id, origin]
      );
      if (dominios.length === 0) {
        return res.status(403).json({ sucesso: false, erro: 'Domínio não autorizado para este formulário' });
      }
      res.set({
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
      });
    }
    next();
  } catch (erro) {
    next(erro);
  }
}

rotasCaptura.options('/:formKey', carregarContexto, (req, res) => res.sendStatus(204));

rotasCaptura.post('/:formKey', carregarContexto, async (req, res, next) => {
  try {
    const corpo = req.body && typeof req.body === 'object' ? req.body : {};

    // Honeypot: responde sucesso falso para não ensinar o bot
    if (corpo._gotcha) {
      logger.aviso('captura descartada por honeypot', { formulario_id: req.formulario.id, ip: req.ip });
      return res.status(201).json({ sucesso: true });
    }

    // Idempotência: mesmo _idem já processado → retorna 201 sem criar novo lead
    const idemKey = corpo._idem ? String(corpo._idem).slice(0, 64) : null;
    if (idemKey && _idemProcessados.has(idemKey)) {
      return res.status(201).json({
        sucesso: true,
        mensagem: req.formulario.mensagem_sucesso ?? 'Recebemos seus dados. Obrigado!',
        redirect_url: req.formulario.redirect_url ?? null,
      });
    }

    const [campos] = await banco.query(
      'SELECT nome_campo, rotulo, papel, obrigatorio, mapeamento_crm FROM formulario_campos WHERE formulario_id = ?',
      [req.formulario.id]
    );

    // Whitelist: só entram valores de campos definidos no formulário
    const dados = {};
    const promovidos = { nome: null, email: null, telefone: null };
    const faltantes = [];
    for (const campo of campos) {
      const valorBruto = corpo[campo.nome_campo];
      const valor = valorBruto == null ? '' : String(valorBruto).trim().slice(0, TAMANHO_MAXIMO_VALOR);
      if (campo.obrigatorio && !valor) {
        faltantes.push(campo.rotulo);
        continue;
      }
      if (valor) {
        // Valida formato de e-mail para campos com papel 'email'
        if (campo.papel === 'email' && !REGEX_EMAIL.test(valor)) {
          return res.status(422).json({ sucesso: false, erro: `E-mail inválido: ${campo.rotulo}` });
        }
        dados[campo.nome_campo] = valor;
        if (campo.papel !== 'personalizado') promovidos[campo.papel] = valor;
      }
    }
    if (faltantes.length > 0) {
      return res.status(422).json({ sucesso: false, erro: `Preencha: ${faltantes.join(', ')}` });
    }

    // Armazena mapeamentos CRM junto com os dados (recuperado pelo worker ao rotear)
    // mapeamento_crm é VARCHAR armazenando JSON — precisa de parse explícito
    const mapeamentos = {};
    for (const campo of campos) {
      if (!campo.mapeamento_crm) continue;
      const crms = typeof campo.mapeamento_crm === 'string'
        ? JSON.parse(campo.mapeamento_crm)
        : campo.mapeamento_crm;
      if (Array.isArray(crms) && crms.length > 0) mapeamentos[campo.nome_campo] = crms;
    }
    if (Object.keys(mapeamentos).length > 0) dados._mapeamentos = mapeamentos;

    // Valores fixos do formulário para o CRM (ex.: origem = tráfego pago)
    const mapeamentosFixos = req.formulario.mapeamentos_fixos_crm
      ? (Array.isArray(req.formulario.mapeamentos_fixos_crm)
          ? req.formulario.mapeamentos_fixos_crm
          : JSON.parse(req.formulario.mapeamentos_fixos_crm))
      : [];
    if (mapeamentosFixos.length > 0) dados._mapeamentos_fixos = mapeamentosFixos;

    // Mapeamentos UTM → CRM (ex: utm_source → deal:custom_123)
    const mapeamentosUtm = req.formulario.mapeamentos_utm_crm
      ? (Array.isArray(req.formulario.mapeamentos_utm_crm)
          ? req.formulario.mapeamentos_utm_crm
          : JSON.parse(req.formulario.mapeamentos_utm_crm))
      : [];
    if (mapeamentosUtm.length > 0) dados._mapeamentos_utm = mapeamentosUtm;

    const telefone = promovidos.telefone ? normalizarTelefone(promovidos.telefone) : null;
    const utm = corpo._utm && typeof corpo._utm === 'object' ? corpo._utm : {};
    const limparTexto = (valor, max = 255) => (valor ? String(valor).slice(0, max) : null);

    // Normaliza tags do formulário para string JSON (mysql2 pode devolver objeto já parseado)
    const tagsFormulario = req.formulario.tags
      ? (typeof req.formulario.tags === 'string' ? req.formulario.tags : JSON.stringify(req.formulario.tags))
      : null;

    const leadId = await emTransacao(async (cx) => {
      const [resLead] = await cx.query(
        `INSERT INTO leads
           (empresa_id, formulario_id, origem, tags, nome, email, telefone, dados_json,
            utm_source, utm_medium, utm_campaign, utm_term, utm_content,
            referrer, landing_page, ip_origem, user_agent, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'novo')`,
        [
          req.formulario.empresa_id, req.formulario.id,
          req.formulario.origem ?? null, tagsFormulario,
          limparTexto(promovidos.nome, 160), limparTexto(promovidos.email, 160), telefone,
          JSON.stringify(dados),
          limparTexto(utm.utm_source), limparTexto(utm.utm_medium), limparTexto(utm.utm_campaign),
          limparTexto(utm.utm_term), limparTexto(utm.utm_content),
          limparTexto(corpo._referrer, 500), limparTexto(corpo._pagina, 500),
          req.ip, limparTexto(req.headers['user-agent']),
        ]
      );
      // Lead salvo PRIMEIRO; CRM e WhatsApp seguem assíncronos pela fila
      await cx.query(
        "INSERT INTO lead_jobs (empresa_id, lead_id, tipo) VALUES (?, ?, 'rotear_crm')",
        [req.formulario.empresa_id, resLead.insertId]
      );
      return resLead.insertId;
    });

    // Registra _idem para bloquear re-submissões idênticas
    if (idemKey) _idemProcessados.set(idemKey, Date.now());

    logger.info('lead capturado', { lead_id: leadId, formulario_id: req.formulario.id });
    res.status(201).json({
      sucesso: true,
      mensagem: req.formulario.mensagem_sucesso ?? 'Recebemos seus dados. Obrigado!',
      redirect_url: req.formulario.redirect_url ?? null,
    });
  } catch (erro) {
    next(erro);
  }
});
