import { Router } from 'express';
import { z } from 'zod';
import { banco, emTransacao } from '../config/banco.js';
import { cifrar, decifrarJson } from '../util/criptografia.js';
import { obterAdapterCrm } from '../servicos/crm/index.js';
import { ErroHttp } from '../middlewares/erros.js';

export const rotasCrm = Router();

// ---------------------------------------------------------------------------
// Validação: CRM primário
// ---------------------------------------------------------------------------

const esquemaConfiguracaoPrimaria = z.discriminatedUnion('tipo_crm', [
  z.object({
    tipo_crm: z.literal('pipedrive'),
    nome: z.string().min(1).max(120).default('Pipedrive'),
    credenciais: z.object({ api_token: z.string().min(10) }),
    config: z.object({
      company_domain: z.string().min(2).regex(/^[a-z0-9-]+$/, 'apenas o subdomínio, ex.: minhaempresa'),
      pipeline_id: z.coerce.number().optional(),
      stage_id: z.coerce.number().optional(),
      owner_id: z.coerce.number().optional(),
    }),
  }),
  z.object({
    tipo_crm: z.literal('piperun'),
    nome: z.string().min(1).max(120).default('PipeRun'),
    credenciais: z.object({ token: z.string().min(10) }),
    config: z.object({
      pipeline_id: z.coerce.number().optional(),
      stage_id: z.coerce.number().optional(),
      owner_id: z.coerce.number().optional(),
    }).default({}),
  }),
]);

// ---------------------------------------------------------------------------
// Validação: LeadPass (white-label GHL)
// ---------------------------------------------------------------------------

const esquemaLeadPass = z.object({
  nome: z.string().min(1).max(120).default('LeadPass'),
  credenciais: z.object({
    api_token: z.string().min(10),
    location_id: z.string().min(5),
  }),
  config: z.object({
    pipeline_id: z.string().min(1).optional(),
    stage_id: z.string().min(1).optional(),
    assigned_to: z.string().min(1).optional(),
    // IDs de campos customizados no GHL para gravar UTMs (opcional)
    campos_utm: z.record(z.string()).optional(),
  }).default({}),
});

// ---------------------------------------------------------------------------
// Rotas: CRM primário
// ---------------------------------------------------------------------------

// Devolve o CRM primário ativo (sem credenciais)
rotasCrm.get('/configuracao', async (req, res, next) => {
  try {
    const [linhas] = await banco.query(
      `SELECT id, tipo_crm, nome, config_json, ultimo_teste_em, ultimo_teste_ok, criado_em
       FROM crm_configuracoes
       WHERE empresa_id = ? AND ativo = 1 AND tipo_crm != 'leadpass' LIMIT 1`,
      [req.empresaId]
    );
    res.json({ sucesso: true, configuracao: linhas[0] ?? null });
  } catch (erro) {
    next(erro);
  }
});

// Define/substitui o CRM primário (não afeta o LeadPass)
rotasCrm.put('/configuracao', async (req, res, next) => {
  try {
    const dados = esquemaConfiguracaoPrimaria.parse(req.body);
    const credenciaisCifradas = cifrar(dados.credenciais);

    const configuracaoId = await emTransacao(async (cx) => {
      // Desativa apenas configs de CRM primário — preserva o LeadPass
      await cx.query(
        "UPDATE crm_configuracoes SET ativo = 0 WHERE empresa_id = ? AND tipo_crm != 'leadpass'",
        [req.empresaId]
      );
      const [resultado] = await cx.query(
        `INSERT INTO crm_configuracoes (empresa_id, tipo_crm, nome, credenciais, config_json, ativo)
         VALUES (?, ?, ?, ?, ?, 1)`,
        [req.empresaId, dados.tipo_crm, dados.nome, credenciaisCifradas, JSON.stringify(dados.config)]
      );
      return resultado.insertId;
    });

    res.status(201).json({ sucesso: true, configuracao_id: configuracaoId });
  } catch (erro) {
    next(erro);
  }
});

// Retorna as credenciais decifradas do CRM primário (para pré-preencher o formulário de edição)
rotasCrm.get('/configuracao/credenciais', async (req, res, next) => {
  try {
    const [linhas] = await banco.query(
      "SELECT credenciais FROM crm_configuracoes WHERE empresa_id = ? AND ativo = 1 AND tipo_crm != 'leadpass' LIMIT 1",
      [req.empresaId]
    );
    if (!linhas.length) return res.json({ sucesso: true, credenciais: null });
    res.json({ sucesso: true, credenciais: decifrarJson(linhas[0].credenciais) });
  } catch (erro) {
    next(erro);
  }
});

// Retorna as credenciais decifradas do LeadPass (para pré-preencher o formulário de edição)
rotasCrm.get('/leadpass/credenciais', async (req, res, next) => {
  try {
    const [linhas] = await banco.query(
      "SELECT credenciais FROM crm_configuracoes WHERE empresa_id = ? AND ativo = 1 AND tipo_crm = 'leadpass' LIMIT 1",
      [req.empresaId]
    );
    if (!linhas.length) return res.json({ sucesso: true, credenciais: null });
    res.json({ sucesso: true, credenciais: decifrarJson(linhas[0].credenciais) });
  } catch (erro) {
    next(erro);
  }
});

// Lista campos do CRM primário — usado pelo editor de formulários
rotasCrm.get('/campos', async (req, res, next) => {
  try {
    const [linhas] = await banco.query(
      "SELECT * FROM crm_configuracoes WHERE empresa_id = ? AND ativo = 1 AND tipo_crm != 'leadpass' LIMIT 1",
      [req.empresaId]
    );
    if (linhas.length === 0) return res.json({ sucesso: true, campos: null });

    let campos;
    let erroCampos = null;
    try {
      campos = await obterAdapterCrm(linhas[0]).listarCampos();
    } catch (err) {
      campos = null;
      erroCampos = err.message;
    }
    res.json({ sucesso: true, campos, erroCampos });
  } catch (erro) {
    next(erro);
  }
});

// Testa a conexão com o CRM primário
rotasCrm.post('/configuracao/testar', async (req, res, next) => {
  try {
    const [linhas] = await banco.query(
      "SELECT * FROM crm_configuracoes WHERE empresa_id = ? AND ativo = 1 AND tipo_crm != 'leadpass' LIMIT 1",
      [req.empresaId]
    );
    if (linhas.length === 0) throw new ErroHttp(404, 'Nenhum CRM configurado');

    let resultado;
    try {
      resultado = await obterAdapterCrm(linhas[0]).testarConexao();
    } catch (erro) {
      resultado = { ok: false, detalhe: erro.message };
    }

    await banco.query(
      'UPDATE crm_configuracoes SET ultimo_teste_em = NOW(), ultimo_teste_ok = ? WHERE id = ?',
      [resultado.ok ? 1 : 0, linhas[0].id]
    );
    res.json({ sucesso: true, teste: resultado });
  } catch (erro) {
    next(erro);
  }
});

// ---------------------------------------------------------------------------
// Rotas: LeadPass (backup universal — todo tenant pode ter 1 config LeadPass)
// ---------------------------------------------------------------------------

// Retorna a configuração LeadPass ativa (sem credenciais)
rotasCrm.get('/leadpass', async (req, res, next) => {
  try {
    const [linhas] = await banco.query(
      `SELECT id, tipo_crm, nome, config_json, ultimo_teste_em, ultimo_teste_ok, criado_em
       FROM crm_configuracoes
       WHERE empresa_id = ? AND ativo = 1 AND tipo_crm = 'leadpass' LIMIT 1`,
      [req.empresaId]
    );
    res.json({ sucesso: true, configuracao: linhas[0] ?? null });
  } catch (erro) {
    next(erro);
  }
});

// Define/substitui a configuração LeadPass (não afeta o CRM primário)
rotasCrm.put('/leadpass', async (req, res, next) => {
  try {
    const dados = esquemaLeadPass.parse(req.body);
    const credenciaisCifradas = cifrar(dados.credenciais);

    const configuracaoId = await emTransacao(async (cx) => {
      await cx.query(
        "UPDATE crm_configuracoes SET ativo = 0 WHERE empresa_id = ? AND tipo_crm = 'leadpass'",
        [req.empresaId]
      );
      const [resultado] = await cx.query(
        `INSERT INTO crm_configuracoes (empresa_id, tipo_crm, nome, credenciais, config_json, ativo)
         VALUES (?, 'leadpass', ?, ?, ?, 1)`,
        [req.empresaId, dados.nome, credenciaisCifradas, JSON.stringify(dados.config)]
      );
      return resultado.insertId;
    });

    res.status(201).json({ sucesso: true, configuracao_id: configuracaoId });
  } catch (erro) {
    next(erro);
  }
});

// Remove a integração LeadPass
rotasCrm.delete('/leadpass', async (req, res, next) => {
  try {
    await banco.query(
      "UPDATE crm_configuracoes SET ativo = 0 WHERE empresa_id = ? AND tipo_crm = 'leadpass'",
      [req.empresaId]
    );
    res.json({ sucesso: true });
  } catch (erro) {
    next(erro);
  }
});

// ---------------------------------------------------------------------------
// Rotas: busca prévia de dados nos CRMs (para preencher seletores no frontend)
// ---------------------------------------------------------------------------

// Pipedrive: retorna pipelines, stages e usuários usando credenciais fornecidas
rotasCrm.post('/pipedrive/dados', async (req, res, next) => {
  try {
    const { api_token, company_domain } = z.object({
      api_token: z.string().min(10),
      company_domain: z.string().min(2),
    }).parse(req.body);

    const base = `https://${company_domain}.pipedrive.com`;
    const headers = { 'x-api-token': api_token };

    async function buscar(caminho) {
      const resp = await fetch(`${base}${caminho}`, { headers });
      const corpo = await resp.json().catch(() => ({}));
      if (!resp.ok || corpo.success !== true) {
        throw new ErroHttp(resp.status === 401 ? 401 : 502, corpo.error || `Pipedrive HTTP ${resp.status}`);
      }
      return corpo.data || [];
    }

    const [pipelines, stages, users] = await Promise.all([
      buscar('/v1/pipelines'),
      buscar('/v1/stages'),
      buscar('/v1/users?limit=500'),
    ]);

    res.json({
      sucesso: true,
      pipelines: pipelines.map((p) => ({ id: p.id, nome: p.name })),
      stages: stages.map((s) => ({ id: s.id, nome: s.name, pipeline_id: s.pipeline_id })),
      usuarios: users.map((u) => ({ id: u.id, nome: u.name })),
    });
  } catch (erro) {
    next(erro);
  }
});

// PipeRun: retorna pipelines, stages e usuários usando credenciais fornecidas
rotasCrm.post('/piperun/dados', async (req, res, next) => {
  try {
    const { token } = z.object({ token: z.string().min(10) }).parse(req.body);

    const headers = { token, 'Content-Type': 'application/json' };

    async function buscar(caminho) {
      const resp = await fetch(`https://api.pipe.run/v1${caminho}`, { headers });
      const corpo = await resp.json().catch(() => ({}));
      if (!resp.ok || corpo.success === false) {
        throw new ErroHttp(resp.status === 401 ? 401 : 502, corpo.message || `PipeRun HTTP ${resp.status}`);
      }
      return corpo.data || [];
    }

    const [pipelines, stages, users] = await Promise.all([
      buscar('/pipelines?show=200'),
      buscar('/stages?show=200'),
      buscar('/users?show=200'),
    ]);

    res.json({
      sucesso: true,
      pipelines: pipelines.map((p) => ({ id: p.id, nome: p.name || p.title || String(p.id) })),
      stages: stages.map((s) => ({ id: s.id, nome: s.name || s.title || String(s.id), pipeline_id: s.pipeline_id })),
      usuarios: users.map((u) => ({ id: u.id, nome: u.name || u.email || String(u.id) })),
    });
  } catch (erro) {
    next(erro);
  }
});

// LeadPass (GHL): retorna pipelines, stages e usuários para o seletor
rotasCrm.post('/leadpass/dados', async (req, res, next) => {
  try {
    const { api_token, location_id } = z.object({
      api_token: z.string().min(10),
      location_id: z.string().min(5),
    }).parse(req.body);

    const headers = {
      Authorization: `Bearer ${api_token}`,
      Version: '2021-07-28',
      'Content-Type': 'application/json',
    };

    async function buscar(caminho) {
      const resp = await fetch(`https://services.leadconnectorhq.com${caminho}`, { headers });
      const corpo = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const msg = corpo.message || corpo.error || JSON.stringify(corpo).slice(0, 200);
        throw new ErroHttp(resp.status === 401 ? 401 : 502, `LeadPass HTTP ${resp.status} ${caminho}: ${msg}`);
      }
      return corpo;
    }

    const [resppipelines, respUsuarios, respCampos] = await Promise.all([
      buscar(`/opportunities/pipelines?locationId=${location_id}`),
      buscar(`/users/?locationId=${location_id}`).catch(() => buscar(`/locations/${location_id}/users`).catch(() => ({}))),
      // GHL: campos de oportunidade exigem model=opportunities na query
      buscar(`/locations/${location_id}/customFields?model=opportunities`)
        .catch(() => buscar(`/locations/${location_id}/customFields?model=opportunity`)
          .catch(() => buscar(`/locations/${location_id}/customFields`)
            .catch(() => ({})))),
    ]);

    // GHL retorna stages embutidas dentro de cada pipeline
    const pipelinesRaw = resppipelines.pipelines || [];
    const pipelines = pipelinesRaw.map((p) => ({ id: p.id, nome: p.name }));
    const stages = pipelinesRaw.flatMap((p) =>
      (p.stages || []).map((s) => ({ id: s.id, nome: s.name, pipeline_id: p.id }))
    );
    const usuariosRaw = respUsuarios.users || [];
    const usuarios = usuariosRaw.map((u) => ({
      id: u.id,
      nome: u.name || `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email || u.id,
    }));

    // GHL: /locations/{id}/customFields retorna campos de contato e possivelmente oportunidade.
    // Mostramos todos sem filtrar — o usuário seleciona qual campo de oportunidade recebe cada UTM.
    const todosCampos = respCampos.customFields || [];
    const camposCustom = todosCampos.map((c) => ({
      id: c.id,
      nome: c.name || c.fieldKey || c.id,
    }));

    res.json({ sucesso: true, pipelines, stages, usuarios, camposCustom });
  } catch (erro) {
    next(erro);
  }
});

// LeadPass (GHL): retorna grupos de campos (padrão + custom contato + custom oportunidade)
// Usado pelo editor de formulários para montar o select "Campo fixo"
rotasCrm.get('/leadpass/campos-formulario', async (req, res, next) => {
  try {
    const [linhas] = await banco.query(
      "SELECT credenciais FROM crm_configuracoes WHERE empresa_id = ? AND ativo = 1 AND tipo_crm = 'leadpass' LIMIT 1",
      [req.empresaId]
    );
    if (!linhas.length) return res.json({ sucesso: true, grupos: [] });

    const creds = decifrarJson(linhas[0].credenciais);
    const { api_token, location_id } = creds;
    if (!api_token || !location_id) return res.json({ sucesso: true, grupos: [] });

    const headers = { Authorization: `Bearer ${api_token}`, Version: '2021-07-28', 'Content-Type': 'application/json' };

    async function buscarCampos(model) {
      const url = model
        ? `https://services.leadconnectorhq.com/locations/${location_id}/customFields?model=${model}`
        : `https://services.leadconnectorhq.com/locations/${location_id}/customFields`;
      const resp = await fetch(url, { headers });
      const corpo = await resp.json().catch(() => ({}));
      return corpo.customFields || [];
    }

    // Busca todos os campos sem filtro (contém atributo model em cada campo)
    // + tenta também os endpoints específicos como fallback
    const [todosCampos, contatoCampos, oppCamposV1, oppCamposV2] = await Promise.all([
      buscarCampos('').catch(() => []),
      buscarCampos('contact').catch(() => []),
      buscarCampos('opportunity').catch(() => []),
      buscarCampos('opportunities').catch(() => []),
    ]);

    // Prioriza o endpoint específico; usa o campo model do retorno geral como fallback
    const contactCfsRaw = contatoCampos.length > 0
      ? contatoCampos
      : todosCampos.filter((c) => !c.model || c.model === 'contact');

    const oppCfsRaw = oppCamposV1.length > 0
      ? oppCamposV1
      : oppCamposV2.length > 0
        ? oppCamposV2
        : todosCampos.filter((c) => c.model === 'opportunity' || c.model === 'opportunities');

    // Mapeia dataType do GHL para tipo_campo simplificado e extrai opções
    function mapearCampoGhl(c, tipo) {
      const dataType = (c.dataType || '').toUpperCase();
      const isSelect = ['DROPDOWN', 'RADIO'].includes(dataType);
      const isCheckbox = ['CHECKBOX', 'MULTIPLE_OPTIONS', 'CHECKBOXES'].includes(dataType);
      const tipo_campo = isSelect ? 'select' : isCheckbox ? 'checkbox' : 'text';

      // GHL retorna opções em picklistOptions (array de strings) ou options (array de objetos)
      let opcoes = [];
      if (isSelect || isCheckbox) {
        const raw = c.picklistOptions || c.options || [];
        opcoes = raw.map((o) =>
          typeof o === 'string'
            ? { valor: o, rotulo: o }
            : { valor: o.id || o.value || String(o), rotulo: o.name || o.label || String(o) }
        );
      }

      return {
        campo: c.id,
        nome: c.name || c.fieldKey || c.id,
        tipo,
        tipo_campo,
        opcoes,
      };
    }

    const camposContatoPadrao = [
      { campo: 'source', nome: 'Source (Origem)', tipo: 'contact', tipo_campo: 'text', opcoes: [] },
      { campo: 'companyName', nome: 'Nome da empresa', tipo: 'contact', tipo_campo: 'text', opcoes: [] },
      { campo: 'website', nome: 'Website', tipo: 'contact', tipo_campo: 'text', opcoes: [] },
      { campo: 'address1', nome: 'Endereço', tipo: 'contact', tipo_campo: 'text', opcoes: [] },
      { campo: 'city', nome: 'Cidade', tipo: 'contact', tipo_campo: 'text', opcoes: [] },
      { campo: 'state', nome: 'Estado', tipo: 'contact', tipo_campo: 'text', opcoes: [] },
      { campo: 'country', nome: 'País', tipo: 'contact', tipo_campo: 'text', opcoes: [] },
      { campo: 'postalCode', nome: 'CEP', tipo: 'contact', tipo_campo: 'text', opcoes: [] },
    ];

    const contactCfs = contactCfsRaw.map((c) => mapearCampoGhl(c, 'contact_cf'));
    const oppCfs = oppCfsRaw.map((c) => mapearCampoGhl(c, 'opp_cf'));

    const grupos = [
      { rotulo: 'Contato — campos padrão', campos: camposContatoPadrao },
      ...(contactCfs.length > 0 ? [{ rotulo: 'Contato — campos customizados', campos: contactCfs }] : []),
      ...(oppCfs.length > 0 ? [{ rotulo: 'Oportunidade — campos customizados', campos: oppCfs }] : []),
    ];

    res.json({ sucesso: true, grupos });
  } catch (erro) {
    next(erro);
  }
});

// LeadPass (GHL): retorna as tags da conta para seleção no formulário
rotasCrm.get('/leadpass/tags', async (req, res, next) => {
  try {
    const [linhas] = await banco.query(
      "SELECT credenciais FROM crm_configuracoes WHERE empresa_id = ? AND ativo = 1 AND tipo_crm = 'leadpass' LIMIT 1",
      [req.empresaId]
    );
    if (!linhas.length) return res.json({ sucesso: true, tags: [] });

    const creds = decifrarJson(linhas[0].credenciais);
    const { api_token, location_id } = creds;
    if (!api_token || !location_id) return res.json({ sucesso: true, tags: [] });

    const headers = {
      Authorization: `Bearer ${api_token}`,
      Version: '2021-07-28',
      'Content-Type': 'application/json',
    };

    // GHL: GET /locations/{id}/tags
    const resp = await fetch(`https://services.leadconnectorhq.com/locations/${location_id}/tags`, { headers });
    const corpo = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      return res.json({ sucesso: true, tags: [] });
    }

    const tagsRaw = corpo.tags || [];
    const tags = tagsRaw.map((t) => ({ id: t.id || t.name, nome: t.name || t.id }));
    res.json({ sucesso: true, tags });
  } catch (erro) {
    next(erro);
  }
});

// Testa a conexão com o LeadPass
rotasCrm.post('/leadpass/testar', async (req, res, next) => {
  try {
    const [linhas] = await banco.query(
      "SELECT * FROM crm_configuracoes WHERE empresa_id = ? AND ativo = 1 AND tipo_crm = 'leadpass' LIMIT 1",
      [req.empresaId]
    );
    if (linhas.length === 0) throw new ErroHttp(404, 'LeadPass não configurado');

    let resultado;
    try {
      resultado = await obterAdapterCrm(linhas[0]).testarConexao();
    } catch (erro) {
      resultado = { ok: false, detalhe: erro.message };
    }

    await banco.query(
      'UPDATE crm_configuracoes SET ultimo_teste_em = NOW(), ultimo_teste_ok = ? WHERE id = ?',
      [resultado.ok ? 1 : 0, linhas[0].id]
    );
    res.json({ sucesso: true, teste: resultado });
  } catch (erro) {
    next(erro);
  }
});
