import { useState } from 'react';
import { NavLink, Navigate, Outlet, useNavigate } from 'react-router-dom';
import { sessao } from '../lib/api.js';
import { Avisos, BotaoTema } from './ui.jsx';
import ModalConta from './ModalConta.jsx';

const ITENS_EMPRESA = [
  { para: '/painel', texto: 'Visão geral', fim: true },
  { para: '/painel/leads', texto: 'Leads' },
  { para: '/painel/relatorios', texto: 'Relatórios' },
  { para: '/painel/formularios', texto: 'Formulários' },
  { para: '/painel/whatsapp', texto: 'WhatsApp' },
  { para: '/painel/crm', texto: 'CRM' },
  { para: '/painel/dominios', texto: 'Domínios' },
];

const ITENS_ADMIN = [{ para: '/admin', texto: 'Empresas', fim: true }];

function BarraLateral({ itens, perfil, nome, complemento, aoAbrirConta, aoSair }) {
  return (
    <aside className="fixed inset-y-0 left-0 w-56 border-r border-linha bg-grafite-950/70 backdrop-blur-md flex flex-col">
      <div className="px-6 pt-7 pb-9">
        <p className="font-editorial text-xl tracking-wide">
          Lead<span className="text-bronze">Flow</span>
        </p>
        <p className="etiqueta mt-1">{perfil === 'admin' ? 'Super Admin' : 'Painel'}</p>
      </div>

      <nav className="flex-1 px-3 space-y-0.5">
        {itens.map((item) => (
          <NavLink
            key={item.para}
            to={item.para}
            end={item.fim}
            className={({ isActive }) =>
              `block rounded-campo px-3 py-2 text-sm transition-colors duration-200 ${
                isActive
                  ? 'bg-vidro-forte text-osso border-l-2 border-bronze pl-[10px]'
                  : 'text-osso-mudo hover:text-osso-suave hover:bg-vidro'
              }`
            }
          >
            {item.texto}
          </NavLink>
        ))}
      </nav>

      <div className="px-3 py-4 border-t border-linha space-y-1">
        <button
          type="button"
          onClick={aoAbrirConta}
          title="Alterar nome e senha"
          className="block w-full text-left rounded-campo px-3 py-2 transition-colors duration-200 hover:bg-vidro group"
        >
          <span className="block text-sm text-osso-suave group-hover:text-osso truncate">{nome}</span>
          <span className="block text-xs text-osso-mudo truncate">{complemento || 'Minha conta'}</span>
        </button>
        <button onClick={aoSair} className="px-3 text-xs text-osso-suave hover:text-estado-erro transition-colors">
          Encerrar sessão
        </button>
      </div>
    </aside>
  );
}

function Casca({ itens, perfil, nome, complemento, trocaObrigatoria, aoAtualizarConta }) {
  const navegar = useNavigate();
  const [contaAberta, setContaAberta] = useState(false);

  const sair = () => {
    sessao.limpar(perfil);
    navegar(perfil === 'admin' ? '/admin/login' : '/login');
  };

  return (
    <div className="min-h-screen">
      <div className="fixed top-6 right-6 z-10">
        <BotaoTema />
      </div>
      <BarraLateral
        itens={itens}
        perfil={perfil}
        nome={nome}
        complemento={complemento}
        aoAbrirConta={() => setContaAberta(true)}
        aoSair={sair}
      />
      {/* Com senha temporária as telas nem montam: a API recusaria todas as chamadas */}
      <main className="ml-56 px-8 lg:px-12 py-10 max-w-6xl">{!trocaObrigatoria && <Outlet />}</main>
      {(contaAberta || trocaObrigatoria) && (
        <ModalConta
          perfil={perfil}
          nomeAtual={nome}
          obrigatorio={trocaObrigatoria}
          aoFechar={() => setContaAberta(false)}
          aoSair={sair}
          aoSalvar={(resultado) => {
            aoAtualizarConta(resultado);
            setContaAberta(false);
          }}
        />
      )}
      <Avisos />
    </div>
  );
}

/** Sessão em estado (e não lida a cada render) para o nome novo aparecer na hora. */
function useSessao(perfil) {
  const [dados, setDados] = useState(() => sessao.obter(perfil));
  const atualizar = (transformar) =>
    setDados((atual) => {
      const novo = transformar(atual);
      sessao.guardar(perfil, novo);
      return novo;
    });
  return [dados, atualizar];
}

export function LayoutEmpresa() {
  const [dados, atualizar] = useSessao('empresa');
  if (!dados) return <Navigate to="/login" replace />;
  return (
    <Casca
      itens={ITENS_EMPRESA}
      perfil="empresa"
      nome={dados.usuario?.nome}
      complemento={dados.usuario?.empresa}
      trocaObrigatoria={Boolean(dados.usuario?.deve_trocar_senha)}
      aoAtualizarConta={({ nome, senhaAlterada }) =>
        atualizar((atual) => ({
          ...atual,
          usuario: { ...atual.usuario, nome, ...(senhaAlterada && { deve_trocar_senha: false }) },
        }))
      }
    />
  );
}

export function LayoutAdmin() {
  const [dados, atualizar] = useSessao('admin');
  if (!dados) return <Navigate to="/admin/login" replace />;
  return (
    <Casca
      itens={ITENS_ADMIN}
      perfil="admin"
      nome={dados.admin?.nome}
      trocaObrigatoria={false}
      aoAtualizarConta={({ nome }) => atualizar((atual) => ({ ...atual, admin: { ...atual.admin, nome } }))}
    />
  );
}
