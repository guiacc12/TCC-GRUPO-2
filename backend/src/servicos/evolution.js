import { env } from '../config/env.js';
import { requisicaoComRetry } from '../util/http.js';

/**
 * Orquestrador da Evolution API v2.
 * A apikey GLOBAL vive só aqui (env) — o tenant nunca a vê; ele recebe o token
 * próprio da instância (hash.apikey da criação) para plugar no n8n dele.
 * Payloads conforme a spec oficial (skill evolution-api, references/).
 */
async function chamarEvolution(caminho, { metodo = 'GET', corpo } = {}) {
  if (!env.evolution.baseUrl || !env.evolution.apiKey) {
    const erro = new Error('Evolution API não configurada (EVOLUTION_BASE_URL / EVOLUTION_API_KEY)');
    erro.permanente = true;
    throw erro;
  }
  const resposta = await requisicaoComRetry(`${env.evolution.baseUrl}${caminho}`, {
    method: metodo,
    headers: { apikey: env.evolution.apiKey, 'Content-Type': 'application/json' },
    ...(corpo && { body: JSON.stringify(corpo) }),
  });
  const corpoResposta = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    const mensagem = Array.isArray(corpoResposta.response?.message)
      ? corpoResposta.response.message.join('; ')
      : corpoResposta.error || `HTTP ${resposta.status}`;
    const erro = new Error(`Evolution: ${mensagem}`);
    erro.codigoHttp = resposta.status;
    throw erro;
  }
  return corpoResposta;
}

/** POST /instance/create — devolve o token da instância (hash.apikey) e o instanceId. */
export async function criarInstancia(instanceName) {
  const corpo = await chamarEvolution('/instance/create', {
    metodo: 'POST',
    corpo: { instanceName, qrcode: true, integration: 'WHATSAPP-BAILEYS' },
  });
  return {
    instanceId: corpo.instance?.instanceId ?? null,
    token: corpo.hash?.apikey ?? corpo.hash ?? null,
    qrcodeBase64: corpo.qrcode?.base64 ?? null,
  };
}

/** GET /instance/connect — gera/renova o QR code (base64 quando disponível). */
export async function obterQrCode(instanceName) {
  const corpo = await chamarEvolution(`/instance/connect/${encodeURIComponent(instanceName)}`);
  return {
    base64: corpo.base64 ?? corpo.qrcode?.base64 ?? null,
    code: corpo.code ?? null,
    pairingCode: corpo.pairingCode ?? null,
  };
}

/** GET /instance/connectionState — open | connecting | close. */
export async function obterEstadoConexao(instanceName) {
  const corpo = await chamarEvolution(`/instance/connectionState/${encodeURIComponent(instanceName)}`);
  return corpo.instance?.state ?? 'close';
}

/** Logout (ignora falha — pode já estar desconectada) + DELETE da instância. */
export async function removerInstancia(instanceName) {
  await chamarEvolution(`/instance/logout/${encodeURIComponent(instanceName)}`, { metodo: 'DELETE' }).catch(() => {});
  // Ignora 404/500 da Evolution — instância pode não existir mais (ex: banco trocado)
  await chamarEvolution(`/instance/delete/${encodeURIComponent(instanceName)}`, { metodo: 'DELETE' }).catch(() => {});
}

/** GET /group/fetchAllGroups — para o painel escolher o grupo de aviso (JID @g.us). */
export async function listarGrupos(instanceName) {
  const grupos = await chamarEvolution(
    `/group/fetchAllGroups/${encodeURIComponent(instanceName)}?getParticipants=false`
  );
  return (Array.isArray(grupos) ? grupos : []).map((g) => ({
    jid: g.id,
    nome: g.subject,
    participantes: g.size,
  }));
}

/** POST /chat/whatsappNumbers — valida se o número existe e devolve o JID correto. */
export async function validarNumeroWhatsapp(instanceName, numero) {
  const corpo = await chamarEvolution(`/chat/whatsappNumbers/${encodeURIComponent(instanceName)}`, {
    metodo: 'POST',
    corpo: { numbers: [numero] },
  });
  const item = Array.isArray(corpo) ? corpo[0] : null;
  return { existe: Boolean(item?.exists), jid: item?.jid ?? null };
}

/** POST /message/sendText — `delay` em ms simula presença antes do envio (anti-ban). */
export async function enviarTexto(instanceName, destino, texto, delayMs = 0) {
  return chamarEvolution(`/message/sendText/${encodeURIComponent(instanceName)}`, {
    metodo: 'POST',
    corpo: { number: destino, text: texto, ...(delayMs > 0 && { delay: delayMs }) },
  });
}
