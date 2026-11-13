// Cliente HTTP dos painéis. Sessões separadas por perfil (empresa × admin).
const BASE = import.meta.env.VITE_API_URL || '';

const CHAVES = { empresa: 'sessao_empresa', admin: 'sessao_admin' };

export const sessao = {
  obter: (perfil) => {
    try {
      return JSON.parse(localStorage.getItem(CHAVES[perfil])) || null;
    } catch {
      return null;
    }
  },
  guardar: (perfil, dados) => localStorage.setItem(CHAVES[perfil], JSON.stringify(dados)),
  limpar: (perfil) => localStorage.removeItem(CHAVES[perfil]),
};

export class ErroApi extends Error {
  constructor(status, mensagem, detalhes) {
    super(mensagem);
    this.status = status;
    this.detalhes = detalhes;
  }
}

// Usadas quando a resposta não traz a mensagem da API (ex.: página de erro do proxy)
const MENSAGENS_POR_STATUS = {
  404: 'Recurso não encontrado',
  413: 'Dados grandes demais',
  429: 'Muitas tentativas. Aguarde um instante e tente de novo.',
  500: 'Erro no servidor. Tente novamente.',
  502: 'Servidor indisponível no momento. Tente novamente em instantes.',
  503: 'Servidor indisponível no momento. Tente novamente em instantes.',
  504: 'Servidor indisponível no momento. Tente novamente em instantes.',
};

/** fetch autenticado; falha de rede vira mensagem em português e 401 derruba a sessão. */
async function requisitar(caminho, perfil, opcoes = {}) {
  const token = sessao.obter(perfil)?.token;
  let resposta;
  try {
    resposta = await fetch(`${BASE}${caminho}`, {
      ...opcoes,
      headers: { ...opcoes.headers, ...(token && { Authorization: `Bearer ${token}` }) },
    });
  } catch {
    throw new ErroApi(0, 'Sem conexão com o servidor. Verifique sua internet e tente de novo.');
  }
  if (resposta.status === 401 && token) {
    sessao.limpar(perfil);
    window.location.href = perfil === 'admin' ? '/admin/login' : '/login';
    throw new ErroApi(401, 'Sessão expirada');
  }
  return resposta;
}

/** "credenciais.api_token" → "api token": o usuário não precisa ver o caminho técnico do campo. */
const rotuloDoCampo = (campo) => campo.split('.').pop().replaceAll('_', ' ');

function erroDaResposta(status, dados) {
  const detalhe = dados.detalhes
    ?.map((d) => (d.campo ? `${rotuloDoCampo(d.campo)}: ${d.mensagem}` : d.mensagem))
    .join('; ');
  const mensagem = detalhe || dados.erro || MENSAGENS_POR_STATUS[status] || `Não foi possível concluir (erro ${status})`;
  return new ErroApi(status, mensagem, dados.detalhes);
}

/** Chama a API; em 401 derruba a sessão e manda para o login do perfil. */
export async function api(caminho, { metodo = 'GET', corpo, perfil = 'empresa' } = {}) {
  const resposta = await requisitar(caminho, perfil, {
    method: metodo,
    headers: { 'Content-Type': 'application/json' },
    ...(corpo !== undefined && { body: JSON.stringify(corpo) }),
  });
  const dados = await resposta.json().catch(() => ({}));
  if (dados.codigo === 'TROCA_SENHA_OBRIGATORIA') marcarTrocaObrigatoria(perfil);
  if (!resposta.ok || dados.sucesso === false) throw erroDaResposta(resposta.status, dados);
  return dados;
}

/** Senha redefinida pelo admin com o painel já aberto: recarrega para o layout exibir a troca obrigatória. */
function marcarTrocaObrigatoria(perfil) {
  const atual = sessao.obter(perfil);
  if (!atual?.usuario || atual.usuario.deve_trocar_senha) return;
  sessao.guardar(perfil, { ...atual, usuario: { ...atual.usuario, deve_trocar_senha: true } });
  window.location.reload();
}

/**
 * Baixa um arquivo de rota autenticada (ex.: CSV). Um <a href> comum não envia o
 * Bearer token, então buscamos com fetch e disparamos o download a partir do Blob.
 */
export async function baixarArquivo(caminho, nomePadrao, { perfil = 'empresa' } = {}) {
  const resposta = await requisitar(caminho, perfil);
  if (!resposta.ok) throw erroDaResposta(resposta.status, await resposta.json().catch(() => ({})));

  const nome = /filename="([^"]+)"/.exec(resposta.headers.get('Content-Disposition') || '')?.[1] || nomePadrao;
  const url = URL.createObjectURL(await resposta.blob());
  const link = Object.assign(document.createElement('a'), { href: url, download: nome });
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** URL pública da API — usada nos snippets de embed (precisa ser absoluta em produção). */
export function urlPublicaDaApi() {
  return BASE || `${window.location.origin}`;
}
