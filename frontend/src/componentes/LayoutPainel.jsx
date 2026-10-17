import { NavLink, Navigate, Outlet, useNavigate } from 'react-router-dom';
import { sessao } from '../lib/api.js';
import { Avisos } from './ui.jsx';

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

function BarraLateral({ itens, perfil, rotuloSessao }) {
  const navegar = useNavigate();
  const sair = () => {
    sessao.limpar(perfil);
    navegar(perfil === 'admin' ? '/admin/login' : '/login');
  };

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

      <div className="px-6 py-5 border-t border-linha space-y-2">
        <p className="text-xs text-osso-mudo truncate">{rotuloSessao}</p>
        <button onClick={sair} className="text-xs text-osso-suave hover:text-estado-erro transition-colors">
          Encerrar sessão
        </button>
      </div>
    </aside>
  );
}

function Casca({ itens, perfil, rotuloSessao }) {
  return (
    <div className="min-h-screen">
      <BarraLateral itens={itens} perfil={perfil} rotuloSessao={rotuloSessao} />
      <main className="ml-56 px-8 lg:px-12 py-10 max-w-6xl">
        <Outlet />
      </main>
      <Avisos />
    </div>
  );
}

export function LayoutEmpresa() {
  const dados = sessao.obter('empresa');
  if (!dados) return <Navigate to="/login" replace />;
  return <Casca itens={ITENS_EMPRESA} perfil="empresa" rotuloSessao={`${dados.usuario?.nome} · ${dados.usuario?.empresa}`} />;
}

export function LayoutAdmin() {
  const dados = sessao.obter('admin');
  if (!dados) return <Navigate to="/admin/login" replace />;
  return <Casca itens={ITENS_ADMIN} perfil="admin" rotuloSessao={dados.admin?.nome} />;
}
