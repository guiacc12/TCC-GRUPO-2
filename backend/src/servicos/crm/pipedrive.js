import { requisicaoComRetry } from '../../util/http.js';
import { logger } from '../../util/logger.js';

/**
 * Adapter Pipedrive.
 * Auth: header `x-api-token` + domínio da empresa ({dominio}.pipedrive.com).
 * Sempre validar o envelope { success } além do status HTTP.
 *
 * credenciais (decifradas): { api_token }
 * config: { company_domain, pipeline_id?, stage_id?, owner_id? }
 *   - com pipeline_id + stage_id → cria Deal (API v2)
 *   - sem eles → cria Lead (API v1; leads só existem na v1)
 */
export function criarPipedriveAdapter({ credenciais, config }) {
  if (!config?.company_domain) throw new Error('Pipedrive: company_domain ausente em config_json');
  const base = `https://${config.company_domain}.pipedrive.com`;
  const headers = { 'x-api-token': credenciais.api_token, 'Content-Type': 'application/json' };

  async function chamar(caminho, opcoes = {}) {
    const resposta = await requisicaoComRetry(`${base}${caminho}`, { headers, ...opcoes });
    const corpo = await resposta.json().catch(() => ({}));
    if (!resposta.ok || corpo.success !== true) {
      const detalhe = corpo.error || `HTTP ${resposta.status}`;
      const erro = new Error(`Pipedrive: ${detalhe}`);
      erro.codigoHttp = resposta.status;
      throw erro;
    }
    return corpo;
  }

  // Hashes de 40 chars são campos customizados — v2 exige { custom_fields: { hash: val } }
  const REGEX_HASH_CUSTOM = /^[0-9a-f]{40}$/i;

  function separarCamposCustom(obj) {
    const normais = {};
    const custom_fields = {};
    for (const [k, v] of Object.entries(obj)) {
      if (REGEX_HASH_CUSTOM.test(k)) custom_fields[k] = v;
      else normais[k] = v;
    }
    return { normais, custom_fields };
  }

  // Cache de definições de campos (carregado uma vez por instância do adapter)
  // Mapeia hash → { field_type, options: Map<labelLower, id> }
  let _cacheCampos = null;
  async function obterCacheCampos() {
    if (_cacheCampos) return _cacheCampos;
    const [pessoaResp, dealResp] = await Promise.all([
      chamar('/v1/personFields?limit=500&start=0'),
      chamar('/v1/dealFields?limit=500&start=0'),
    ]);
    _cacheCampos = new Map();
    for (const campo of [...(pessoaResp.data || []), ...(dealResp.data || [])]) {
      if (!REGEX_HASH_CUSTOM.test(campo.key)) continue;
      const opcoesMap = new Map();
      if (['enum', 'set'].includes(campo.field_type) && Array.isArray(campo.options)) {
        for (const opt of campo.options) {
          opcoesMap.set(String(opt.label).toLowerCase(), Number(opt.id));
          opcoesMap.set(String(opt.id), Number(opt.id)); // aceita ID direto também
        }
      }
      _cacheCampos.set(campo.key, { tipo: campo.field_type, opcoes: opcoesMap });
    }
    return _cacheCampos;
  }

  // Converte valores de custom_fields para os tipos corretos exigidos pela v2:
  //   enum → number (ID da opção)
  //   set  → number[] (IDs das opções)
  //   double/monetary → number
  async function normalizarValoresCustom(custom_fields) {
    if (!custom_fields || Object.keys(custom_fields).length === 0) return custom_fields;
    const cache = await obterCacheCampos();
    const resultado = {};
    for (const [hash, valor] of Object.entries(custom_fields)) {
      const def = cache.get(hash);
      if (!def) { resultado[hash] = valor; continue; }

      if (def.tipo === 'enum') {
        if (valor === null || valor === undefined || valor === '') {
          resultado[hash] = null;
        } else if (typeof valor === 'number') {
          resultado[hash] = valor;
        } else {
          const id = def.opcoes.get(String(valor).toLowerCase()) ?? def.opcoes.get(String(valor));
          resultado[hash] = id ?? null;
          if (id === undefined) console.warn(`Pipedrive enum: opção "${valor}" não encontrada para campo ${hash}`);
        }
      } else if (def.tipo === 'set') {
        const valores = Array.isArray(valor) ? valor : String(valor).split(',').map((v) => v.trim());
        resultado[hash] = valores
          .map((v) => (typeof v === 'number' ? v : (def.opcoes.get(String(v).toLowerCase()) ?? def.opcoes.get(String(v)))))
          .filter((v) => v !== undefined && v !== null);
      } else if (['double', 'monetary'].includes(def.tipo)) {
        resultado[hash] = valor !== null && valor !== '' ? Number(valor) : null;
      } else {
        resultado[hash] = valor;
      }
    }
    return resultado;
  }

  // Campos do sistema que não fazem sentido para mapeamento de formulário
  const EXCLUIR_SISTEMA = new Set([
    'add_time', 'update_time', 'last_activity_date', 'last_activity_id',
    'next_activity_date', 'next_activity_time', 'next_activity_id',
    'next_activity_subject', 'next_activity_type', 'next_activity_duration',
    'activities_count', 'done_activities_count',
    'open_deals_count', 'closed_deals_count', 'won_deals_count', 'lost_deals_count',
    'email_messages_count', 'first_name', 'last_name',
    'participants_open_deals_count', 'participants_closed_deals_count',
    'cc_email', 'picture_id', 'im', 'visible_to',
    'stage_order_nr', 'stage_change_time', 'won_time', 'lost_time', 'close_time',
    'weighted_value', 'rotten_time', 'renewal_type',
    'org_hidden', 'person_hidden', 'formatted_value', 'formatted_weighted_value',
    'status',
    // v1 → v2: renomeados ou removidos na API v2
    'label',        // v2 usa label_ids (array de inteiros)
    'active_flag',  // somente leitura na v2
  ]);

  function normalizarCampos(lista, entidade) {
    return (lista || [])
      .filter((c) => !EXCLUIR_SISTEMA.has(c.key))
      .map((c) => ({
        chave: `${entidade}:${c.key}`,
        nome: c.name,
        tipo: c.field_type,
        opcoes: ['enum', 'set'].includes(c.field_type) && c.options?.length
          ? c.options.map((o) => ({ id: String(o.id), rotulo: o.label }))
          : undefined,
      }));
  }

  async function localizarOuCriarPessoa(lead, camposCustom = {}) {
    // Reaproveita pessoa existente pelo e-mail (busca exata, v2)
    if (lead.email) {
      const busca = await chamar(
        `/api/v2/persons/search?term=${encodeURIComponent(lead.email)}&fields=email&exact_match=true&limit=1`
      );
      const encontrada = busca.data?.items?.[0]?.item;
      if (encontrada) {
        // Atualiza campos customizados na person existente via v1 (hashes no nível raiz)
        const PADRAO_PUT = new Set(['name', 'email', 'phone', 'owner_id', 'org_id']);
        const camposExtraPut = Object.fromEntries(Object.entries(camposCustom).filter(([k]) => !PADRAO_PUT.has(k)));
        const { normais: normaisPut, custom_fields: cfPut } = separarCamposCustom(camposExtraPut);
        const cfPutNorm = await normalizarValoresCustom(cfPut);
        const temAtualizacao = Object.keys(normaisPut).length > 0 || Object.keys(cfPutNorm).length > 0;
        if (temAtualizacao) {
          // v1: campos customizados no nível raiz, sem wrapper custom_fields
          const putBody = { ...normaisPut, ...cfPutNorm };
          logger.info('pipedrive put person', { person_id: encontrada.id, custom_fields: cfPutNorm });
          await chamar(`/v1/persons/${encontrada.id}`, {
            method: 'PUT',
            body: JSON.stringify(putBody),
          }).catch((e) => logger.aviso('pipedrive put person falhou', { person_id: encontrada.id, erro: e.message }));
        }
        return encontrada.id;
      }
    }

    // Criação via v1: campos customizados no nível raiz (hash: valor) — v2 ignora custom_fields silenciosamente
    const PADRAO_PESSOA = new Set(['name', 'email', 'phone', 'owner_id', 'org_id']);
    const camposExtra = Object.fromEntries(Object.entries(camposCustom).filter(([k]) => !PADRAO_PESSOA.has(k)));

    const { normais: camposExtraNormais, custom_fields: cfPessoa } = separarCamposCustom(camposExtra);
    const cfPessoaNorm = await normalizarValoresCustom(cfPessoa);
    const pessoa = {
      name: lead.nome || lead.email || lead.telefone || 'Lead sem nome',
      // v1 usa "email" (singular) com array de objetos
      ...(lead.email && { email: [{ value: lead.email, primary: true, label: 'work' }] }),
      ...(lead.telefone && { phone: [{ value: lead.telefone, primary: true, label: 'mobile' }] }),
      ...(config.owner_id && { owner_id: Number(config.owner_id) }),
      ...camposExtraNormais,
      // v1: hashes dos campos customizados direto no nível raiz
      ...cfPessoaNorm,
    };
    logger.info('pipedrive criar person v1', { custom_fields: cfPessoaNorm });
    const criada = await chamar('/v1/persons', { method: 'POST', body: JSON.stringify(pessoa) });
    return criada.data.id;
  }

  function montarNotaUtm(lead) {
    const tags = Array.isArray(lead.tags) ? lead.tags : (typeof lead.tags === 'string' ? JSON.parse(lead.tags || '[]') : []);
    const linhas = [
      lead.origem && `<b>Origem:</b> ${lead.origem}`,
      tags.length > 0 && `<b>Tags:</b> ${tags.join(', ')}`,
      lead.utm_source && `<b>Origem (utm_source):</b> ${lead.utm_source}`,
      lead.utm_medium && `<b>Mídia (utm_medium):</b> ${lead.utm_medium}`,
      lead.utm_campaign && `<b>Campanha (utm_campaign):</b> ${lead.utm_campaign}`,
      lead.utm_term && `<b>Termo (utm_term):</b> ${lead.utm_term}`,
      lead.utm_content && `<b>Conteúdo (utm_content):</b> ${lead.utm_content}`,
      lead.landing_page && `<b>Página de captura:</b> ${lead.landing_page}`,
      lead.referrer && `<b>Referrer:</b> ${lead.referrer}`,
    ].filter(Boolean);
    return linhas.length > 0 ? linhas.join('<br>') : null;
  }

  function normalizarInstagram(nomeCampo, valor) {
    if (!valor || typeof valor !== 'string') return valor;
    if (!nomeCampo.toLowerCase().includes('instagram')) return valor;
    const handle = valor.trim().replace(/^@+/, '');
    return handle ? `https://www.instagram.com/${handle}` : valor;
  }

  return {
    async upsertLead(lead, { mapeamentos = {}, mapeamentosFixos = [], mapeamentosUtm = [] } = {}) {
      const dadosJson = typeof lead.dados_json === 'string' ? JSON.parse(lead.dados_json || '{}') : lead.dados_json || {};

      // Campos dinâmicos: um campo do form pode mapear para múltiplos destinos (array)
      const camposPessoa = {};
      const camposDeal = {};
      for (const [nomeCampo, valor] of Object.entries(dadosJson)) {
        if (nomeCampo.startsWith('_') || !valor) continue;
        const destinos = mapeamentos[nomeCampo];
        if (!destinos) continue;
        const valorNormalizado = normalizarInstagram(nomeCampo, valor);
        for (const mapeamento of Array.isArray(destinos) ? destinos : [destinos]) {
          const sepIdx = mapeamento.indexOf(':');
          if (sepIdx === -1) continue;
          const entidade = mapeamento.slice(0, sepIdx);
          const chave = mapeamento.slice(sepIdx + 1);
          if (entidade === 'person') camposPessoa[chave] = valorNormalizado;
          else if (entidade === 'deal') camposDeal[chave] = valorNormalizado;
        }
      }

      // Campos fixos do formulário: valores estáticos independentes do form
      for (const { campo, valor } of mapeamentosFixos) {
        if (!campo || valor == null) continue;
        const sepIdx = campo.indexOf(':');
        if (sepIdx === -1) continue;
        const entidade = campo.slice(0, sepIdx);
        const chave = campo.slice(sepIdx + 1);
        if (entidade === 'person') camposPessoa[chave] = valor;
        else if (entidade === 'deal') camposDeal[chave] = valor;
      }

      // Mapeamentos UTM: utm_source/medium/etc. → campos do CRM
      const UTM_VALIDOS = new Set(['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']);
      for (const { utm_param, campo } of mapeamentosUtm) {
        if (!campo || !UTM_VALIDOS.has(utm_param)) continue;
        const valor = lead[utm_param];
        if (!valor) continue;
        const sepIdx = campo.indexOf(':');
        if (sepIdx === -1) continue;
        const entidade = campo.slice(0, sepIdx);
        const chave = campo.slice(sepIdx + 1);
        if (entidade === 'person') camposPessoa[chave] = valor;
        else if (entidade === 'deal') camposDeal[chave] = valor;
      }

      logger.info('pipedrive upsert campos', { lead_id: lead.id, camposPessoa, mapeamentos_recebidos: Object.keys(mapeamentos) });
      const pessoaId = await localizarOuCriarPessoa(lead, camposPessoa);
      const titulo = `Lead: ${lead.nome || lead.email || lead.telefone}`;

      // Campos padrão tratados explicitamente + campos v1 incompatíveis com POST /api/v2/deals
      const PADRAO_DEAL = new Set([
        'title', 'person_id', 'pipeline_id', 'stage_id', 'owner_id', 'value', 'currency',
        'label', 'active_flag', 'status',
      ]);
      const camposDealExtraRaw = Object.fromEntries(Object.entries(camposDeal).filter(([k]) => !PADRAO_DEAL.has(k)));
      const { normais: camposDealExtra, custom_fields: cfDeal } = separarCamposCustom(camposDealExtraRaw);
      const cfDealNorm = await normalizarValoresCustom(cfDeal);

      let idExterno;
      let vinculoNota;
      if (config.pipeline_id && config.stage_id) {
        const deal = await chamar('/api/v2/deals', {
          method: 'POST',
          body: JSON.stringify({
            title: camposDeal.title || titulo,
            person_id: pessoaId,
            pipeline_id: Number(config.pipeline_id),
            stage_id: Number(config.stage_id),
            ...(config.owner_id && { owner_id: Number(config.owner_id) }),
            ...(camposDeal.value && { value: camposDeal.value }),
            ...camposDealExtra,
            ...(Object.keys(cfDealNorm).length > 0 && { custom_fields: cfDealNorm }),
          }),
        });
        idExterno = String(deal.data.id);
        vinculoNota = { deal_id: deal.data.id };
      } else {
        const novoLead = await chamar('/v1/leads', {
          method: 'POST',
          body: JSON.stringify({
            title: titulo,
            person_id: pessoaId,
            ...(config.owner_id && { owner_id: Number(config.owner_id) }),
          }),
        });
        idExterno = String(novoLead.data.id);
        vinculoNota = { lead_id: novoLead.data.id };
      }

      // Nota com origem, tags e UTMs — falha aqui não derruba a entrega
      const nota = montarNotaUtm(lead);
      if (nota) {
        await chamar('/v1/notes', { method: 'POST', body: JSON.stringify({ content: nota, ...vinculoNota }) }).catch(() => {});
      }

      return { idExterno };
    },

    async listarCampos() {
      const [pessoaResp, dealResp] = await Promise.all([
        chamar('/v1/personFields?limit=500&start=0'),
        chamar('/v1/dealFields?limit=500&start=0'),
      ]);
      return {
        pessoa: normalizarCampos(pessoaResp.data, 'person'),
        deal: normalizarCampos(dealResp.data, 'deal'),
      };
    },

    async testarConexao() {
      const corpo = await chamar('/v1/users/me');
      return { ok: true, detalhe: `Conectado como ${corpo.data?.name || corpo.data?.email || 'usuário Pipedrive'}` };
    },
  };
}
