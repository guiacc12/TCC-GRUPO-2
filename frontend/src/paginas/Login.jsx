import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, sessao } from '../lib/api.js';
import { Botao, Campo } from '../componentes/ui.jsx';
import { useRevelar } from '../lib/animacoes.js';

/** Tela de login compartilhada — split editorial: manifesto à esquerda, acesso à direita. */
export default function Login({ perfil = 'empresa' }) {
  const navegar = useNavigate();
  const ref = useRevelar();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);

  const ehAdmin = perfil === 'admin';

  async function entrar(evento) {
    evento.preventDefault();
    setErro('');
    setCarregando(true);
    try {
      const caminho = ehAdmin ? '/api/auth/admin/login' : '/api/auth/login';
      const dados = await api(caminho, { metodo: 'POST', corpo: { email, senha }, perfil });
      sessao.guardar(perfil, dados);
      navegar(ehAdmin ? '/admin' : '/painel');
    } catch (excecao) {
      setErro(excecao.message);
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div ref={ref} className="min-h-screen grid lg:grid-cols-[1.2fr_1fr]">
      {/* Manifesto editorial */}
      <section className="hidden lg:flex flex-col justify-between p-14 border-r border-linha">
        <p className="font-editorial text-2xl tracking-wide" data-revelar>
          Lead<span className="text-bronze">Flow</span>
        </p>
        <div className="space-y-6 max-w-md">
          <p className="etiqueta" data-revelar>
            Captura · Roteamento · Automação
          </p>
          <h1 className="titulo-editorial text-5xl leading-[1.1]" data-revelar>
            Cada lead no lugar certo, <em className="text-bronze not-italic">em segundos</em>.
          </h1>
          <p className="text-osso-suave text-sm leading-relaxed" data-revelar>
            Formulários nativos sem iframe, rastreamento UTM automático, roteamento direto
            para o seu CRM e avisos imediatos no WhatsApp.
          </p>
        </div>
        <p className="text-xs text-osso-mudo" data-revelar>
          © {new Date().getFullYear()} LeadFlow
        </p>
      </section>

      {/* Acesso */}
      <section className="flex items-center justify-center p-8">
        <form onSubmit={entrar} className="w-full max-w-sm space-y-5" data-revelar>
          <div className="space-y-1 mb-8">
            <p className="etiqueta">{ehAdmin ? 'Acesso restrito' : 'Bem-vindo de volta'}</p>
            <h2 className="titulo-editorial text-3xl">{ehAdmin ? 'Super Admin' : 'Entrar no painel'}</h2>
          </div>

          <Campo
            rotulo="E-mail"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="voce@empresa.com.br"
            required
            autoFocus
          />
          <Campo
            rotulo="Senha"
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            placeholder="••••••••"
            required
          />

          {erro && <p className="text-sm text-estado-erro">{erro}</p>}

          <Botao type="submit" carregando={carregando} className="w-full">
            Entrar
          </Botao>

          <p className="text-xs text-osso-mudo text-center pt-2">
            {ehAdmin ? (
              <a href="/login" className="hover:text-osso-suave">← acesso de empresas</a>
            ) : (
              'Sua conta é criada pelo administrador da plataforma.'
            )}
          </p>
        </form>
      </section>
    </div>
  );
}
