import { banco, emTransacao } from '../config/banco.js';
import { env } from '../config/env.js';
import { logger } from '../util/logger.js';
import { obterAdapterCrm } from './crm/index.js';
import { decifrar } from '../util/criptografia.js';
import { validarNumeroWhatsapp, enviarTexto } from './evolution.js';

/**
 * Worker da fila lead_jobs (MySQL, sem Redis).
 * - Reivindica jobs com FOR UPDATE SKIP LOCKED → seguro com múltiplas réplicas.
 * - Retry com backoff exponencial (30s · 2^tentativas) até max_tentativas.
 * - Erros marcados com `permanente = true` não re-tentam (ex.: número sem WhatsApp).
 * - Toda tentativa de entrega (sucesso ou falha) vira linha em logs_entrega.
 */

let executando = false;
let timer = null;

const BACKOFF_BASE_SEGUNDOS = 30;

async function registrarEntrega({ empresaId, leadId, jobId, canal, destino, sucesso, codigoHttp = null, detalhe = null }) {
  await banco.query(
    `INSERT INTO logs_entrega (empresa_id, lead_id, job_id, canal, destino, sucesso, codigo_http, detalhe)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [empresaId, leadId, jobId, canal, destino, sucesso ? 1 : 0, codigoHttp, detalhe?.slice(0, 2000) ?? null]
  );
}

function montarDadosTemplate(lead) {
  const dadosJson = typeof lead.dados_json === 'string' ? JSON.parse(lead.dados_json || '{}') : lead.dados_json || {};
  return {
    ...dadosJson,
    nome: lead.nome ?? '',
    email: lead.email ?? '',
    telefone: lead.telefone ?? '',
    utm_source: lead.utm_source ?? '',
    utm_medium: lead.utm_medium ?? '',
    utm_campaign: lead.utm_campaign ?? '',
    utm_term: lead.utm_term ?? '',
    utm_content: lead.utm_content ?? '',
    pagina: lead.landing_page ?? '',
  };
}

function renderizarTemplate(template, lead) {
  const dados = montarDadosTemplate(lead);
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, chave) => String(dados[chave] ?? ''));
}

const sortearDelayMs = (minS, maxS) => Math.round((minS + Math.random() * Math.max(0, maxS - minS)) * 1000);

async function buscarLead(leadId) {
  const [linhas] = await banco.query('SELECT * FROM leads WHERE id = ?', [leadId]);
  return linhas[0] ?? null;
}

// ---------------------------------------------------------------------------
// Processadores
// ---------------------------------------------------------------------------

async function criarJobsWhatsapp(lead) {
  // Automações do formulário do lead + as gerais da empresa (formulario_id NULL)
  const [automacoes] = await banco.query(
    `SELECT id FROM whatsapp_automacoes
     WHERE empresa_id = ? AND ativo = 1 AND (formulario_id IS NULL OR formulario_id <=> ?)
     ORDER BY ordem`,
    [lead.empresa_id, lead.formulario_id]
  );
  for (const automacao of automacoes) {
    await banco.query(
      "INSERT INTO lead_jobs (empresa_id, lead_id, automacao_id, tipo) VALUES (?, ?, ?, 'enviar_whatsapp')",
      [lead.empresa_id, lead.id, automacao.id]
    );
  }
  return automacoes.length;
}

async function processarRotearCrm(job) {
  const lead = await buscarLead(job.lead_id);
  if (!lead) {
    const erro = new Error('Lead não existe mais');
    erro.permanente = true;
    throw erro;
  }
  await banco.query("UPDATE leads SET status = 'processando' WHERE id = ?", [lead.id]);

  const dadosJson = typeof lead.dados_json === 'string' ? JSON.parse(lead.dados_json || '{}') : lead.dados_json || {};
  const mapeamentos = dadosJson._mapeamentos || {};
  const mapeamentosFixos = dadosJson._mapeamentos_fixos || [];
  const mapeamentosUtm = dadosJson._mapeamentos_utm || [];

  // Busca CRM primário (qualquer tipo exceto leadpass) e LeadPass separadamente
  const [[primarios], [leadpassConfigs]] = await Promise.all([
    banco.query(
      "SELECT * FROM crm_configuracoes WHERE empresa_id = ? AND ativo = 1 AND tipo_crm != 'leadpass' LIMIT 1",
      [job.empresa_id]
    ),
    banco.query(
      "SELECT * FROM crm_configuracoes WHERE empresa_id = ? AND ativo = 1 AND tipo_crm = 'leadpass' LIMIT 1",
      [job.empresa_id]
    ),
  ]);

  // --- CRM primário (obrigatório para o status do job) ---
  if (primarios.length > 0) {
    const configuracao = primarios[0];
    // Herda pessoa_id de outro lead recente com mesmo email (evita duplicata por delay de indexação do PipeRun)
    if (lead.email && !dadosJson._piperun_pessoa_id) {
      const [recentes] = await banco.query(
        `SELECT dados_json FROM leads
         WHERE empresa_id = ? AND email = ? AND id != ? AND dados_json LIKE '%_piperun_pessoa_id%'
         ORDER BY criado_em DESC LIMIT 1`,
        [lead.empresa_id, lead.email, lead.id]
      );
      if (recentes[0]) {
        const djRecente = typeof recentes[0].dados_json === 'string'
          ? JSON.parse(recentes[0].dados_json || '{}')
          : recentes[0].dados_json || {};
        if (djRecente._piperun_pessoa_id) {
          dadosJson._piperun_pessoa_id = djRecente._piperun_pessoa_id;
          logger.info('piperun pessoa herdada de lead com mesmo email', {
            lead_id: lead.id, email: lead.email, pessoa_id: djRecente._piperun_pessoa_id,
          });
        }
      }
    }
    const pessoaCachedId = dadosJson._piperun_pessoa_id ?? null;
    let resultado;
    try {
      resultado = await obterAdapterCrm(configuracao).upsertLead(lead, { mapeamentos, mapeamentosFixos, mapeamentosUtm, pessoaCachedId });
    } catch (erro) {
      // Salva pessoaId mesmo em falha de deal — impede duplicatas no próximo retry
      if (erro.pessoaId && !dadosJson._piperun_pessoa_id) {
        dadosJson._piperun_pessoa_id = erro.pessoaId;
        await banco.query('UPDATE leads SET dados_json = ? WHERE id = ?', [JSON.stringify(dadosJson), lead.id]);
      }
      throw erro;
    }
    const { idExterno } = resultado;
    if (resultado.pessoaId && !dadosJson._piperun_pessoa_id) {
      dadosJson._piperun_pessoa_id = resultado.pessoaId;
      await banco.query('UPDATE leads SET dados_json = ? WHERE id = ?', [JSON.stringify(dadosJson), lead.id]);
    }
    await banco.query("UPDATE leads SET crm_id_externo = ?, status = 'entregue' WHERE id = ?", [idExterno, lead.id]);
    await registrarEntrega({
      empresaId: job.empresa_id, leadId: lead.id, jobId: job.id,
      canal: 'crm', destino: configuracao.tipo_crm, sucesso: true,
      detalhe: `Criado no CRM (id ${idExterno})`,
    });
  } else {
    // Sem CRM primário o lead fica entregue na plataforma; WhatsApp segue normal
    await banco.query("UPDATE leads SET status = 'entregue' WHERE id = ?", [lead.id]);
  }

  // --- LeadPass (backup — falha é logada mas não derruba o job) ---
  if (leadpassConfigs.length > 0) {
    try {
      // Busca tags e campos fixos específicos do formulário para enriquecer o lead no LeadPass
      let leadpassTags = [];
      let leadpassCamposFixos = [];
      if (lead.formulario_id) {
        const [formRows] = await banco.query(
          'SELECT leadpass_tags, leadpass_campos_fixos FROM formularios WHERE id = ?',
          [lead.formulario_id]
        );
        if (formRows[0]) {
          const rawTags = formRows[0].leadpass_tags;
          leadpassTags = Array.isArray(rawTags) ? rawTags : (rawTags ? JSON.parse(rawTags) : []);
          const rawCamposFixos = formRows[0].leadpass_campos_fixos;
          const camposFixos = Array.isArray(rawCamposFixos) ? rawCamposFixos : (rawCamposFixos ? JSON.parse(rawCamposFixos) : []);
          // origem 'pergunta' → troca o campo_origem pela resposta real do lead antes de enviar
          leadpassCamposFixos = camposFixos.map((cf) => (
            cf.origem === 'pergunta'
              ? { tipo: cf.tipo, campo: cf.campo, valor: cf.campo_origem ? dadosJson[cf.campo_origem] ?? null : null }
              : cf
          ));
        }
      }
      const { idExterno: idLeadPass } = await obterAdapterCrm(leadpassConfigs[0]).upsertLead(lead, { leadpassTags, leadpassCamposFixos });
      await registrarEntrega({
        empresaId: job.empresa_id, leadId: lead.id, jobId: job.id,
        canal: 'crm', destino: 'leadpass', sucesso: true,
        detalhe: `Backup LeadPass (id ${idLeadPass})`,
      });
      logger.info('leadpass enviado', { lead_id: lead.id, job_id: job.id });
    } catch (erroLeadPass) {
      await registrarEntrega({
        empresaId: job.empresa_id, leadId: lead.id, jobId: job.id,
        canal: 'crm', destino: 'leadpass', sucesso: false,
        codigoHttp: erroLeadPass.codigoHttp ?? null,
        detalhe: `Erro backup LeadPass: ${erroLeadPass.message}`.slice(0, 2000),
      }).catch(() => {});
      logger.aviso('leadpass falhou (não reprocessa)', { lead_id: lead.id, erro: erroLeadPass.message });
    }
  }

  const totalAutomacoes = await criarJobsWhatsapp(lead);
  logger.info('lead roteado', { lead_id: lead.id, job_id: job.id, automacoes: totalAutomacoes });
}

async function processarEnviarWhatsapp(job) {
  const [automacoes] = await banco.query(
    `SELECT a.*, i.instance_name, i.status_conexao
     FROM whatsapp_automacoes a JOIN whatsapp_instancias i ON i.id = a.instancia_id
     WHERE a.id = ?`,
    [job.automacao_id]
  );
  const automacao = automacoes[0];
  if (!automacao || !automacao.ativo) {
    await banco.query("UPDATE lead_jobs SET status = 'cancelado' WHERE id = ?", [job.id]);
    return;
  }
  const lead = await buscarLead(job.lead_id);
  if (!lead) {
    const erro = new Error('Lead não existe mais');
    erro.permanente = true;
    throw erro;
  }

  let destino;
  let canal;
  let rotuloDestino;
  if (automacao.tipo_destino === 'grupo') {
    destino = automacao.grupo_jid;
    canal = 'whatsapp_grupo';
    rotuloDestino = automacao.grupo_nome || automacao.grupo_jid;
  } else {
    canal = 'whatsapp_contato';
    rotuloDestino = automacao.instance_name;
    if (!lead.telefone) {
      const erro = new Error('Lead sem telefone — não há como enviar WhatsApp');
      erro.permanente = true;
      throw erro;
    }
    // Valida o número uma única vez e guarda o JID no lead para reuso
    if (!lead.whatsapp_jid) {
      const { existe, jid } = await validarNumeroWhatsapp(automacao.instance_name, lead.telefone);
      if (!existe) {
        const erro = new Error(`Número ${lead.telefone} não está no WhatsApp`);
        erro.permanente = true;
        throw erro;
      }
      await banco.query('UPDATE leads SET whatsapp_jid = ? WHERE id = ?', [jid, lead.id]);
      lead.whatsapp_jid = jid;
    }
    destino = lead.whatsapp_jid;
  }

  const mensagem = renderizarTemplate(automacao.mensagem_template, lead);
  const delayMs = sortearDelayMs(automacao.delay_segundos_min, automacao.delay_segundos_max);
  await enviarTexto(automacao.instance_name, destino, mensagem, delayMs);

  await registrarEntrega({
    empresaId: job.empresa_id, leadId: lead.id, jobId: job.id,
    canal, destino: rotuloDestino, sucesso: true, detalhe: `Mensagem enviada (delay ${delayMs}ms)`,
  });
  logger.info('whatsapp enviado', { lead_id: lead.id, job_id: job.id, canal });
}

// ---------------------------------------------------------------------------
// Ciclo do worker
// ---------------------------------------------------------------------------

async function tratarFalha(job, erro) {
  const tentativas = job.tentativas + 1;
  const esgotou = erro.permanente || tentativas >= job.max_tentativas;

  if (esgotou) {
    await banco.query(
      "UPDATE lead_jobs SET status = 'erro', tentativas = ?, ultimo_erro = ? WHERE id = ?",
      [tentativas, erro.message.slice(0, 2000), job.id]
    );
    // Falha definitiva no roteamento de CRM marca o lead para triagem no painel
    if (job.tipo === 'rotear_crm') {
      await banco.query("UPDATE leads SET status = 'erro' WHERE id = ?", [job.lead_id]);
    }
  } else {
    const esperaSegundos = BACKOFF_BASE_SEGUNDOS * 2 ** job.tentativas;
    await banco.query(
      `UPDATE lead_jobs SET status = 'pendente', tentativas = ?, ultimo_erro = ?,
              proxima_tentativa_em = DATE_ADD(NOW(), INTERVAL ? SECOND)
       WHERE id = ?`,
      [tentativas, erro.message.slice(0, 2000), esperaSegundos, job.id]
    );
  }

  await registrarEntrega({
    empresaId: job.empresa_id, leadId: job.lead_id, jobId: job.id,
    canal: job.tipo === 'rotear_crm' ? 'crm' : 'whatsapp_contato',
    destino: job.tipo, sucesso: false, codigoHttp: erro.codigoHttp ?? null,
    detalhe: `${erro.message}${esgotou ? ' (desistiu)' : ` (tentativa ${tentativas}/${job.max_tentativas})`}`,
  }).catch(() => {});

  logger.aviso('job falhou', { job_id: job.id, tipo: job.tipo, tentativas, esgotou, erro: erro.message });
}

async function reivindicarJobs(quantidade) {
  return emTransacao(async (cx) => {
    const [jobs] = await cx.query(
      `SELECT * FROM lead_jobs
       WHERE status = 'pendente' AND proxima_tentativa_em <= NOW()
       ORDER BY proxima_tentativa_em LIMIT ?
       FOR UPDATE SKIP LOCKED`,
      [quantidade]
    );
    if (jobs.length > 0) {
      await cx.query(
        `UPDATE lead_jobs SET status = 'processando' WHERE id IN (${jobs.map(() => '?').join(',')})`,
        jobs.map((j) => j.id)
      );
    }
    return jobs;
  });
}

async function cicloDoWorker() {
  // Resgata jobs presos em 'processando' por crash de réplica
  await banco.query(
    "UPDATE lead_jobs SET status = 'pendente' WHERE status = 'processando' AND atualizado_em < DATE_SUB(NOW(), INTERVAL 10 MINUTE)"
  );

  const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

  const jobs = await reivindicarJobs(env.worker.lote);
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    try {
      if (job.tipo === 'rotear_crm') await processarRotearCrm(job);
      else if (job.tipo === 'enviar_whatsapp') await processarEnviarWhatsapp(job);

      await banco.query(
        "UPDATE lead_jobs SET status = 'sucesso' WHERE id = ? AND status = 'processando'",
        [job.id]
      );
    } catch (erro) {
      await tratarFalha(job, erro);
    }
    // Pausa entre jobs de CRM para evitar rejeição por envios consecutivos rápidos
    if (job.tipo === 'rotear_crm' && i < jobs.length - 1) {
      await pausa(env.worker.delayEntreCrmMs);
    }
  }
  return jobs.length;
}

export function iniciarWorker() {
  if (executando) return;
  executando = true;
  logger.info('worker da fila iniciado', { intervalo_ms: env.worker.intervaloMs, lote: env.worker.lote });

  const agendar = (atraso) => {
    if (!executando) return;
    timer = setTimeout(async () => {
      let processados = 0;
      try {
        processados = await cicloDoWorker();
      } catch (erro) {
        logger.erro('ciclo do worker falhou', { erro: erro.message });
      }
      // Com fila cheia emenda o próximo ciclo; vazia, espera o intervalo
      agendar(processados > 0 ? 50 : env.worker.intervaloMs);
    }, atraso);
  };
  agendar(env.worker.intervaloMs);
}

export function pararWorker() {
  executando = false;
  if (timer) clearTimeout(timer);
}
