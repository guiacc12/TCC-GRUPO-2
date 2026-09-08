import { criarPipedriveAdapter } from './pipedrive.js';
import { criarPipeRunAdapter } from './piperun.js';
import { criarLeadPassAdapter } from './leadpass.js';
import { decifrarJson } from '../../util/criptografia.js';

/**
 * Factory do padrão Adapter: interface única
 *   { upsertLead(lead) → { idExterno }, testarConexao() → { ok, detalhe } }
 * a partir de uma linha de crm_configuracoes (credenciais decifradas aqui,
 * nunca fora deste módulo).
 */
export function obterAdapterCrm(configuracao) {
  const credenciais = decifrarJson(configuracao.credenciais);
  const config = typeof configuracao.config_json === 'string'
    ? JSON.parse(configuracao.config_json)
    : configuracao.config_json || {};

  switch (configuracao.tipo_crm) {
    case 'pipedrive':
      return criarPipedriveAdapter({ credenciais, config });
    case 'piperun':
      return criarPipeRunAdapter({ credenciais, config });
    case 'leadpass':
      return criarLeadPassAdapter({ credenciais, config });
    default:
      throw new Error(`Tipo de CRM desconhecido: ${configuracao.tipo_crm}`);
  }
}
