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

/** Chama a API; em 401 derruba a sessão e manda para o login do perfil. */
export async function api(caminho, { metodo = 'GET', corpo, perfil = 'empresa' } = {}) {
  const token = sessao.obter(perfil)?.token;
  const resposta = await fetch(`${BASE}${caminho}`, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    ...(corpo !== undefined && { body: JSON.stringify(corpo) }),
  });
  const dados = await resposta.json().catch(() => ({}));

  if (resposta.status === 401 && token) {
    sessao.limpar(perfil);
    window.location.href = perfil === 'admin' ? '/admin/login' : '/login';
    throw new ErroApi(401, 'Sessão expirada');
  }
  if (!resposta.ok || dados.sucesso === false) {
    const detalhe = dados.detalhes?.map((d) => `${d.campo}: ${d.mensagem}`).join('; ');
    throw new ErroApi(resposta.status, detalhe || dados.erro || `Erro ${resposta.status}`, dados.detalhes);
  }
  return dados;
}

/** URL pública da API — usada nos snippets de embed (precisa ser absoluta em produção). */
export function urlPublicaDaApi() {
  return BASE || `${window.location.origin}`;
}
