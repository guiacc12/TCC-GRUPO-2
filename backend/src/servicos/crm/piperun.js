import { requisicaoComRetry } from '../../util/http.js';
import { logger } from '../../util/logger.js';

/**
 * Adapter PipeRun.
 * Auth: header `token` em toda requisição. Base fixa https://api.pipe.run/v1.
 * Rate limit 120 req/30s — o retry respeita o Retry-After (tratado em util/http).
 * Sempre validar o envelope { success } além do status HTTP.
 *
 * credenciais (decifradas): { token }
 * config: { pipeline_id, stage_id, owner_id? } — stage_id é necessário para
 * criar a oportunidade; sem ele, apenas a pessoa é criada.
 */
const BASE = 'https://api.pipe.run/v1';

// Cache do mapa id→hash dos custom fields (a doc oficial exige `hash` além do `id`
// em todo item de custom_fields; sem ele o PipeRun às vezes rejeita a validação
// com "campos customizados não encontrados", de forma intermitente).
const cacheHashesPorToken = new Map();
const TTL_CACHE_HASHES_MS = 10 * 60 * 1000;

export function criarPipeRunAdapter({ credenciais, config = {} }) {
  const headers = { token: credenciais.token, 'Content-Type': 'application/json' };

  async function chamar(caminho, opcoes = {}) {
    const resposta = await requisicaoComRetry(`${BASE}${caminho}`, { headers, ...opcoes });
    const corpo = await resposta.json().catch(() => ({}));
    if (!resposta.ok || corpo.success === false) {
      const detalhe = JSON.stringify(corpo).slice(0, 800);
      const erro = new Error(`PipeRun: ${detalhe} (HTTP ${resposta.status} ${caminho})`);
      erro.codigoHttp = resposta.status;
      throw erro;
    }
    return corpo;
  }

  async function buscarMapaHashes() {
    const cache = cacheHashesPorToken.get(credenciais.token);
    if (cache && cache.expiraEm > Date.now()) return cache.mapa;
    const mapa = new Map();
    try {
      let cursor = '';
      do {
        const resp = await chamar(`/customFields?show=200&cursor=${cursor}`);
        for (const c of resp.data || []) mapa.set(c.id, c.hash);
        cursor = resp.meta?.cursor?.next ?? null;
      } while (cursor);
      cacheHashesPorToken.set(credenciais.token, { mapa, expiraEm: Date.now() + TTL_CACHE_HASHES_MS });
    } catch (e) {
      logger.aviso('piperun falha ao buscar hashes de custom fields', { erro: e.message });
    }
    return mapa;
  }

  async function buscarOuCriarPessoa(emailPessoa, payloadPessoa, cachedId = null) {
    // ID salvo em retry anterior — evita criar duplicata quando a busca ainda não indexou
    if (cachedId) {
      logger.info('piperun pessoa reutilizada (cache retry)', { pessoa_id: cachedId });
      return cachedId;
    }
    if (emailPessoa) {
      try {
        const busca = await chamar(`/persons?show=5&search=${encodeURIComponent(emailPessoa)}`);
        const lista = Array.isArray(busca.data) ? busca.data : [];
        const encontrada = lista.find((p) =>
          p.contactEmails?.some((e) => e.email?.toLowerCase() === emailPessoa.toLowerCase())
        );
        if (encontrada) {
          logger.info('piperun pessoa reutilizada por email', { pessoa_id: encontrada.id, email: emailPessoa });
          return encontrada.id;
        }
      } catch (e) {
        logger.aviso('piperun busca de pessoa falhou, tentando criar', { erro: e.message });
      }
    }
    const pessoa = await chamar('/persons', { method: 'POST', body: JSON.stringify(payloadPessoa) });
    logger.info('piperun pessoa criada', { pessoa_id: pessoa.data?.id });
    return pessoa.data?.id;
  }

  const CAMPOS_PESSOA_PADRAO = [
    { chave: 'person:name', nome: 'Nome', tipo: 'text' },
    { chave: 'person:email', nome: 'E-mail', tipo: 'email' },
    { chave: 'person:phone', nome: 'Telefone', tipo: 'phone' },
    { chave: 'person:custom_681249', nome: 'Instagram', tipo: 'text' },
  ];

  const CAMPOS_DEAL_PADRAO = [
    { chave: 'deal:title', nome: 'Título', tipo: 'text' },
    { chave: 'deal:value', nome: 'Valor', tipo: 'monetary' },
    { chave: 'deal:observation', nome: 'Observação', tipo: 'textarea' },
  ];

  return {
    async upsertLead(lead, { mapeamentos = {}, mapeamentosFixos = [], mapeamentosUtm = [], pessoaCachedId = null } = {}) {
      const dadosJson = typeof lead.dados_json === 'string' ? JSON.parse(lead.dados_json || '{}') : lead.dados_json || {};
      const tags = Array.isArray(lead.tags) ? lead.tags : (typeof lead.tags === 'string' ? JSON.parse(lead.tags || '[]') : []);

      // Campos dinâmicos: um campo do form pode mapear para múltiplos destinos (array)
      const camposPessoa = {};
      const camposDeal = {};
      for (const [nomeCampo, valor] of Object.entries(dadosJson)) {
        if (nomeCampo.startsWith('_') || !valor) continue;
        const destinos = mapeamentos[nomeCampo];
        if (!destinos) continue;
        for (const mapeamento of Array.isArray(destinos) ? destinos : [destinos]) {
          const sepIdx = mapeamento.indexOf(':');
          if (sepIdx === -1) continue;
          const entidade = mapeamento.slice(0, sepIdx);
          const chave = mapeamento.slice(sepIdx + 1);
          if (entidade === 'person') camposPessoa[chave] = valor;
          else if (entidade === 'deal') camposDeal[chave] = valor;
        }
      }

      // Campos fixos do formulário: valores estáticos independentes do form
      for (const { campo, valor } of mapeamentosFixos) {
        if (!campo || valor == null || valor === '') continue;
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

      const PADRAO_PESSOA = new Set(['name', 'email', 'phone']);
      const camposExtraPessoa = Object.fromEntries(Object.entries(camposPessoa).filter(([k]) => !PADRAO_PESSOA.has(k)));

      const mapaHashes = await buscarMapaHashes();

      // custom_* da pessoa → customFields array (formato oficial: id + hash + value)
      const customFieldsPessoa = Object.entries(camposExtraPessoa)
        .filter(([k, v]) => k.startsWith('custom_') && !isNaN(k.slice(7)) && k.slice(7) !== '' && v !== '' && v != null)
        .map(([k, v]) => {
          const id = Number(k.slice(7));
          return { id, value: String(v), ...(mapaHashes.get(id) && { hash: mapaHashes.get(id) }) };
        });
      const outrosCamposPessoa = Object.fromEntries(
        Object.entries(camposExtraPessoa).filter(([k]) => !k.startsWith('custom_'))
      );

      const emailPessoa = camposPessoa.email || lead.email;
      const phonePessoa = camposPessoa.phone || lead.telefone;
      const payloadPessoa = {
        name: camposPessoa.name || lead.nome || lead.email || lead.telefone || 'Lead sem nome',
        ...(emailPessoa && { contactEmails: [{ email: emailPessoa }] }),
        ...(phonePessoa && { contactPhones: [{ phone: phonePessoa }] }),
        ...(config.owner_id && { owner_id: Number(config.owner_id) }),
        ...(customFieldsPessoa.length > 0 && { customFields: customFieldsPessoa }),
        ...outrosCamposPessoa,
      };
      const pessoaId = await buscarOuCriarPessoa(emailPessoa, payloadPessoa, pessoaCachedId);

      if (!config.stage_id) return { idExterno: `person:${pessoaId}`, pessoaId };

      // origin_id e outros campos nativos que o PipeRun espera como número inteiro
      const CAMPOS_NATIVOS_NUMERO = new Set(['origin_id']);
      const PADRAO_DEAL = new Set(['title', 'value', 'stage_id', 'pipeline_id', 'observation', 'tags', 'origin_id']);
      const camposExtraDeal = Object.fromEntries(Object.entries(camposDeal).filter(([k]) => !PADRAO_DEAL.has(k)));

      // custom_* → custom_fields array (formato oficial: id + hash + value)
      const customFieldsDeal = Object.entries(camposExtraDeal)
        .filter(([k, v]) => k.startsWith('custom_') && !isNaN(k.slice(7)) && k.slice(7) !== '' && v !== '' && v != null)
        .map(([k, v]) => {
          const id = Number(k.slice(7));
          return { id, value: String(v), ...(mapaHashes.get(id) && { hash: mapaHashes.get(id) }) };
        });
      const outrosCamposDeal = Object.fromEntries(
        Object.entries(camposExtraDeal)
          .filter(([k]) => !k.startsWith('custom_'))
          // campos nativos numéricos: converter para Number para não chegar como string
          .map(([k, v]) => [k, CAMPOS_NATIVOS_NUMERO.has(k) ? Number(v) : v])
      );

      // tags → [{ id }] (o valor pode vir como string única ou array de IDs)
      const tagsRaw = camposDeal.tags;
      const tagsDeal = tagsRaw
        ? (Array.isArray(tagsRaw) ? tagsRaw : [tagsRaw]).map((id) => ({ id: Number(id) })).filter((t) => t.id)
        : [];

      // Observation usa apenas o que foi explicitamente mapeado — sem injeção automática de UTMs/origem
      const observacoesPartes = [camposDeal.observation].filter(Boolean);

      const tituloBase = camposDeal.title || `Lead: ${lead.nome || lead.email || lead.telefone}`;
      const payloadDeal = {
        title: tituloBase,
        stage_id: Number(config.stage_id),
        ...(config.pipeline_id && { pipeline_id: Number(config.pipeline_id) }),
        ...(pessoaId && { person_id: pessoaId }),
        ...(config.owner_id && { owner_id: Number(config.owner_id) }),
        ...(camposDeal.value && { value: camposDeal.value }),
        ...(camposDeal.origin_id && { origin_id: Number(camposDeal.origin_id) }),
        ...(observacoesPartes.length > 0 && { observation: observacoesPartes.join(' | ') }),
        ...(customFieldsDeal.length > 0 && { custom_fields: customFieldsDeal }),
        ...(tagsDeal.length > 0 && { tags: tagsDeal }),
        ...outrosCamposDeal,
      };
      logger.info('piperun payload /deals', { lead_id: lead.id, payload: payloadDeal });

      try {
        const oportunidade = await chamar('/deals', { method: 'POST', body: JSON.stringify(payloadDeal) });
        return { idExterno: String(oportunidade.data?.id), pessoaId };
      } catch (erro) {
        // Transporta pessoaId no erro para o worker salvar no cache mesmo em falha de deal
        erro.pessoaId = pessoaId;
        throw erro;
      }
    },

    async listarCampos() {
      let camposCustomPessoa = [];
      let camposCustomDeal = [];
      try {
        // Busca todos os custom fields com paginação cursor (máx 200/página)
        let todos = [];
        let cursor = '';
        do {
          const resp = await chamar(`/customFields?show=200&cursor=${cursor}`);
          todos = todos.concat(resp.data || []);
          cursor = resp.meta?.cursor?.next ?? null;
        } while (cursor);

        const ENTITY_PESSOA = new Set(['persons', 'person', 'people', 'contact', 'contacts']);
        const ENTITY_DEAL = new Set(['deals', 'deal', 'opportunities', 'opportunity', 'oportunidade', 'oportunidades']);

        // Loga estrutura completa dos campos para diagnóstico (primeiros 3 + campos com nomes duplicados)
        const entityTypesUnicos = [...new Set(todos.map((c) => c.entity_type).filter(Boolean))];
        logger.info('piperun custom fields entity_types', { total: todos.length, entity_types: entityTypesUnicos });
        const nomeCount = todos.reduce((m, c) => { m[c.name] = (m[c.name] || 0) + 1; return m; }, {});
        const duplicados = todos.filter((c) => nomeCount[c.name] > 1);
        if (duplicados.length > 0) logger.info('piperun custom fields duplicados', duplicados.map((c) => ({ id: c.id, name: c.name, entity_type: c.entity_type, type: c.type, model: c.model, scope: c.scope, belongs_to: c.belongs_to, section: c.section })));

        // Rótulo legível do entity_type para exibição no dropdown
        const ENTITY_ROTULO = {
          persons: 'Pessoa', person: 'Pessoa', people: 'Pessoa', contact: 'Pessoa', contacts: 'Pessoa',
          deals: 'Deal', deal: 'Deal', opportunities: 'Deal', opportunity: 'Deal',
        };

        const mapearCampo = (entidade) => (c) => {
          const rotuloEntidade = ENTITY_ROTULO[c.entity_type] ?? c.entity_type ?? entidade;
          return {
            chave: `${entidade}:custom_${c.id}`,
            nome: `${c.name} [${rotuloEntidade} #${c.id}]`,
            tipo: c.type || 'text',
            customizado: true,
            opcoes: ['select', 'multiselect'].includes(c.type) && c.options?.length
              ? c.options.map((o) => ({ id: String(o.id ?? o.value), rotulo: o.label ?? o.name }))
              : undefined,
          };
        };

        camposCustomPessoa = todos.filter((c) => ENTITY_PESSOA.has(c.entity_type)).map(mapearCampo('person'));
        const dealExplicit = todos.filter((c) => ENTITY_DEAL.has(c.entity_type));
        // Fallback: se nenhum campo bateu os entity_types conhecidos de deal,
        // trata todos os não-pessoa como deal (cobre entity_types não documentados do PipeRun)
        const candidatosDeal = dealExplicit.length > 0
          ? dealExplicit
          : todos.filter((c) => !ENTITY_PESSOA.has(c.entity_type));
        camposCustomDeal = candidatosDeal.map(mapearCampo('deal'));
      } catch { /* retorna apenas padrões */ }

      // Busca campos nativos com opções: origens e tags
      const camposNativosDeal = [];
      try {
        let allOrigins = [];
        let cursor = '';
        do {
          const resp = await chamar(`/origins?show=200&cursor=${cursor}`);
          allOrigins = allOrigins.concat(resp.data || []);
          cursor = resp.meta?.cursor?.next ?? null;
        } while (cursor);
        if (allOrigins.length > 0) {
          camposNativosDeal.push({
            chave: 'deal:origin_id',
            nome: 'Origem',
            tipo: 'select',
            opcoes: allOrigins.map((o) => ({ id: String(o.id), rotulo: o.name || o.title || String(o.id) })),
          });
        }
      } catch { /* endpoint pode não existir — ignora */ }

      try {
        let allTags = [];
        let cursor = '';
        do {
          const resp = await chamar(`/tags?show=200&cursor=${cursor}`);
          allTags = allTags.concat(resp.data || []);
          cursor = resp.meta?.cursor?.next ?? null;
        } while (cursor);
        if (allTags.length > 0) {
          camposNativosDeal.push({
            chave: 'deal:tags',
            nome: 'Tags',
            tipo: 'multiselect',
            opcoes: allTags.map((t) => ({ id: String(t.id), rotulo: t.name || t.title || String(t.id) })),
          });
        }
      } catch { /* endpoint pode não existir — ignora */ }

      const camposOcultos = new Set(config.campos_ocultos || []);
      return {
        pessoa: [...CAMPOS_PESSOA_PADRAO, ...camposCustomPessoa].filter((c) => !camposOcultos.has(c.chave)),
        deal: [...CAMPOS_DEAL_PADRAO, ...camposNativosDeal, ...camposCustomDeal].filter((c) => !camposOcultos.has(c.chave)),
      };
    },

    async testarConexao() {
      const corpo = await chamar('');
      return { ok: true, detalhe: `Token válido (conta ${corpo.data?.account_id ?? corpo.account_id ?? '—'})` };
    },
  };
}
