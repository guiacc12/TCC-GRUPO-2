import { requisicaoComRetry } from '../../util/http.js';
import { logger } from '../../util/logger.js';

/**
 * Adapter LeadPass — white-label do GoHighLevel (GHL API v2).
 * Usa POST /contacts/upsert para evitar duplicados por e-mail/telefone.
 * Se pipeline_id + stage_id estiverem em config, cria também uma oportunidade
 * com UTMs nos custom fields configurados (não em tags).
 *
 * credenciais (decifradas): { api_token, location_id }
 * config (opcional): {
 *   pipeline_id,   // ID do pipeline no GHL
 *   stage_id,      // ID da etapa no pipeline
 *   assigned_to,   // ID do usuário responsável (assignedTo no GHL)
 *   campos_utm: {  // IDs dos custom fields da oportunidade para cada UTM
 *     utm_source:   "FIELD_ID",
 *     utm_medium:   "FIELD_ID",
 *     utm_campaign: "FIELD_ID",
 *     utm_term:     "FIELD_ID",
 *     utm_content:  "FIELD_ID",
 *   }
 * }
 *
 * upsertLead(lead, { leadpassTags, leadpassCamposFixos }):
 *   leadpassCamposFixos — lista de campos do formulário (formularios.leadpass_campos_fixos),
 *   já resolvidos pelo worker (fila.js) para o valor final a enviar:
 *   [{ tipo: 'contact'|'contact_cf'|'opp_cf', campo, valor }]
 *   'contact'    → campo padrão do contato (ex.: source, companyName, website)
 *   'contact_cf' → custom field do contato (id do campo no GHL)
 *   'opp_cf'     → custom field da oportunidade (id do campo no GHL)
 */

const BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

export function criarLeadPassAdapter({ credenciais, config = {} }) {
  if (!credenciais.api_token) throw new Error('LeadPass: api_token ausente nas credenciais');
  if (!credenciais.location_id) throw new Error('LeadPass: location_id ausente nas credenciais');

  const locationId = credenciais.location_id;
  const headers = {
    Authorization: `Bearer ${credenciais.api_token}`,
    Version: GHL_VERSION,
    'Content-Type': 'application/json',
  };

  async function chamar(caminho, opcoes = {}) {
    const resposta = await requisicaoComRetry(`${BASE}${caminho}`, { headers, ...opcoes });
    const corpo = await resposta.json().catch(() => ({}));
    if (!resposta.ok) {
      const detalhe = corpo.message || corpo.error || JSON.stringify(corpo).slice(0, 300);
      const erro = new Error(`LeadPass: ${detalhe} (HTTP ${resposta.status} ${caminho})`);
      erro.codigoHttp = resposta.status;
      throw erro;
    }
    return corpo;
  }

  function parsearNome(nomeCompleto) {
    const partes = (nomeCompleto || '').trim().split(/\s+/);
    return {
      firstName: partes[0] || '',
      lastName: partes.slice(1).join(' ') || '',
    };
  }

  function montarCustomFieldsUtm(lead) {
    if (!config.campos_utm) return [];
    const mapaUtm = {
      utm_source: lead.utm_source,
      utm_medium: lead.utm_medium,
      utm_campaign: lead.utm_campaign,
      utm_term: lead.utm_term,
      utm_content: lead.utm_content,
    };
    return Object.entries(mapaUtm)
      .filter(([chave, valor]) => valor && config.campos_utm[chave])
      .map(([chave, valor]) => ({ id: config.campos_utm[chave], field_value: valor }));
  }

  return {
    async upsertLead(lead, { leadpassTags = [], leadpassCamposFixos = [] } = {}) {
      const { firstName, lastName } = parsearNome(lead.nome);

      // Tags: GHL aceita nomes (não IDs) no campo tags do contato
      const tagsLead = Array.isArray(lead.tags)
        ? lead.tags
        : typeof lead.tags === 'string'
          ? JSON.parse(lead.tags || '[]')
          : [];
      const tags = [...new Set([...tagsLead, ...leadpassTags])];

      // Campos fixos do formulário: cada um pode ser campo padrão do contato,
      // custom field de contato ou custom field de oportunidade. O valor já
      // vem resolvido (fixo ou resposta de pergunta) por quem chamou o adapter.
      const contactFieldsPadrao = {};
      const contactCustomFieldsExtra = [];
      const oppCustomFieldsExtraFixos = [];
      for (const cf of leadpassCamposFixos) {
        if (!cf?.campo) continue;
        const fieldValue = Array.isArray(cf.valor) ? cf.valor : cf.valor || null;
        if (!fieldValue || (Array.isArray(fieldValue) && fieldValue.length === 0)) continue;
        if (cf.tipo === 'contact') contactFieldsPadrao[cf.campo] = fieldValue;
        else if (cf.tipo === 'contact_cf') contactCustomFieldsExtra.push({ id: cf.campo, field_value: fieldValue });
        else if (cf.tipo === 'opp_cf') oppCustomFieldsExtraFixos.push({ id: cf.campo, field_value: fieldValue });
      }

      // 1. Upsert do contato
      const resposta = await chamar('/contacts/upsert', {
        method: 'POST',
        body: JSON.stringify({
          locationId,
          ...(firstName && { firstName }),
          ...(lastName && { lastName }),
          ...(lead.email && { email: lead.email }),
          ...(lead.telefone && { phone: lead.telefone }),
          ...(lead.landing_page && { website: lead.landing_page }),
          ...(tags.length > 0 && { tags }),
          // campos fixos do formulário sobrescrevem os derivados do lead
          ...contactFieldsPadrao,
          ...(contactCustomFieldsExtra.length > 0 && { customFields: contactCustomFieldsExtra }),
        }),
      });

      const contato = resposta.contact || resposta;
      const contatoId = contato.id || contato.contactId;

      // 2. Cria oportunidade com UTMs + campos fixos de oportunidade nos custom fields
      // Verifica se já existe oportunidade aberta para este contato neste pipeline — evita duplicata
      if (config.pipeline_id && config.stage_id && contatoId) {
        try {
          const busca = await chamar(
            `/opportunities/search?location_id=${locationId}&contact_id=${contatoId}&pipeline_id=${encodeURIComponent(config.pipeline_id)}&status=open&limit=1`
          );
          const oportunidades = busca.opportunities || busca.data || [];
          if (oportunidades.length > 0) {
            logger.info('leadpass oportunidade já existe, pulando criação', { contato_id: contatoId, pipeline_id: config.pipeline_id });
            return { idExterno: contatoId };
          }
        } catch {
          // Se a busca falhar, tenta criar mesmo assim
        }
      }

      if (config.pipeline_id && config.stage_id && contatoId) {
        const customFields = [...montarCustomFieldsUtm(lead), ...oppCustomFieldsExtraFixos];

        const payloadOportunidade = {
          pipelineId: String(config.pipeline_id),
          locationId,
          name: `${lead.nome || lead.email || lead.telefone || 'sem nome'}`,
          pipelineStageId: String(config.stage_id),
          status: 'open',
          contactId: contatoId,
          ...(config.assigned_to && { assignedTo: String(config.assigned_to) }),
          ...(customFields.length > 0 && { customFields }),
        };

        logger.info('leadpass oportunidade payload', payloadOportunidade);

        await chamar('/opportunities/', {
          method: 'POST',
          body: JSON.stringify(payloadOportunidade),
        }).catch((erro) => {
          throw new Error(`LeadPass contato criado (${contatoId}), mas oportunidade falhou: ${erro.message}`);
        });
      }

      return { idExterno: contatoId || 'leadpass' };
    },

    async testarConexao() {
      const corpo = await chamar(`/locations/${locationId}`);
      const nome = corpo.location?.name || corpo.name || locationId;
      return { ok: true, detalhe: `Conectado ao LeadPass (location: ${nome})` };
    },
  };
}
