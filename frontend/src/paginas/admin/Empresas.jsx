import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import {
  Badge, Botao, CabecalhoPagina, Campo, Carregando, EstadoVazio, Modal, avisar, formatarData,
} from '../../componentes/ui.jsx';
import { useRevelar } from '../../lib/animacoes.js';

const TOM_STATUS = { ativa: 'ok', suspensa: 'aviso', cancelada: 'erro' };

export default function Empresas() {
  const [empresas, setEmpresas] = useState(null);
  const [modalAberto, setModalAberto] = useState(false);
  const [empresaEdicao, setEmpresaEdicao] = useState(null);
  const ref = useRevelar([empresas !== null]);

  async function carregar() {
    const dados = await api('/api/admin/empresas', { perfil: 'admin' });
    setEmpresas(dados.empresas);
  }
  useEffect(() => {
    carregar().catch((erro) => avisar(erro.message, 'erro'));
  }, []);

  async function mudarStatus(empresa, status) {
    try {
      await api(`/api/admin/empresas/${empresa.id}/status`, { metodo: 'PATCH', corpo: { status }, perfil: 'admin' });
      avisar(`${empresa.nome} agora está ${status}.`);
      carregar();
    } catch (erro) {
      avisar(erro.message, 'erro');
    }
  }

  if (!empresas) return <Carregando />;

  return (
    <div ref={ref}>
      <CabecalhoPagina
        etiqueta="Tenants"
        titulo="Empresas"
        descricao="Crie, edite, suspenda e acompanhe as contas que usam a plataforma."
        acoes={<Botao onClick={() => setModalAberto(true)}>Nova empresa</Botao>}
      />

      {empresas.length === 0 ? (
        <EstadoVazio
          titulo="Nenhuma empresa ainda"
          descricao="Crie a primeira conta para liberar o painel do cliente."
          acao={<Botao onClick={() => setModalAberto(true)}>Criar empresa</Botao>}
        />
      ) : (
        <div className="grid gap-3" data-revelar>
          {empresas.map((empresa) => (
            <article key={empresa.id} className="cartao cartao-hover p-5 flex flex-wrap items-center gap-4">
              <div className="flex-1 min-w-48">
                <div className="flex items-center gap-3">
                  <h3 className="font-editorial text-lg">{empresa.nome}</h3>
                  <Badge tom={TOM_STATUS[empresa.status]}>{empresa.status}</Badge>
                </div>
                <p className="text-xs text-osso-mudo mt-1">
                  /{empresa.slug} · desde {formatarData(empresa.criado_em)}
                </p>
                {empresa.email_contato && <p className="text-xs text-osso-mudo mt-1 break-all">{empresa.email_contato}</p>}
              </div>

              <dl className="flex gap-8 text-center">
                {[
                  ['Usuários', empresa.total_usuarios],
                  ['Formulários', empresa.total_formularios],
                  ['Leads', empresa.total_leads],
                ].map(([rotulo, valor]) => (
                  <div key={rotulo}>
                    <dt className="etiqueta">{rotulo}</dt>
                    <dd className="font-editorial text-xl mt-0.5">{valor}</dd>
                  </div>
                ))}
              </dl>

              <div className="flex gap-2">
                <Botao variante="fantasma" onClick={() => setEmpresaEdicao(empresa)}>Editar</Botao>
                {empresa.status === 'ativa' ? (
                  <Botao variante="perigo" onClick={() => mudarStatus(empresa, 'suspensa')}>Suspender</Botao>
                ) : (
                  <Botao variante="fantasma" onClick={() => mudarStatus(empresa, 'ativa')}>Reativar</Botao>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      <ModalNovaEmpresa
        aberto={modalAberto}
        aoFechar={() => setModalAberto(false)}
        aoCriar={() => {
          setModalAberto(false);
          carregar();
        }}
      />
      {empresaEdicao && (
        <ModalEditarEmpresa
          key={empresaEdicao.id}
          empresa={empresaEdicao}
          aoFechar={() => setEmpresaEdicao(null)}
          aoSalvar={async () => {
            await carregar();
            setEmpresaEdicao(null);
          }}
        />
      )}
    </div>
  );
}

function ModalEditarEmpresa({ empresa, aoFechar, aoSalvar }) {
  const [dados, setDados] = useState({ nome: empresa.nome, slug: empresa.slug, email_contato: empresa.email_contato || '' });
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const mudar = (chave) => (evento) => setDados((atual) => ({ ...atual, [chave]: evento.target.value }));
  const fechar = () => { if (!carregando) aoFechar(); };

  async function salvar(evento) {
    evento.preventDefault();
    if (carregando) return;
    setCarregando(true);
    setErro('');
    try {
      await api(`/api/admin/empresas/${empresa.id}`, { metodo: 'PUT', perfil: 'admin', corpo: dados });
      await aoSalvar();
      avisar('Dados da empresa atualizados.');
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setCarregando(false);
    }
  }

  return (
    <Modal aberto titulo="Editar empresa" aoFechar={fechar}>
      <form onSubmit={salvar} className="space-y-4">
        <p className="text-sm text-osso-mudo">Atualize os dados de cadastro. O acesso do proprietário e os dados vinculados à empresa serão preservados.</p>
        <Campo rotulo="Nome da empresa" value={dados.nome} onChange={mudar('nome')} required minLength={2} maxLength={160} disabled={carregando} />
        <Campo rotulo="Slug" value={dados.slug} onChange={mudar('slug')} required minLength={2} maxLength={80} pattern="[a-z0-9-]+" dica="letras minúsculas, números e hífens" disabled={carregando} />
        <Campo rotulo="E-mail de contato" type="email" value={dados.email_contato} onChange={mudar('email_contato')} maxLength={160} disabled={carregando} dica="Opcional. Deixe em branco para remover o contato." />
        {erro && <p role="alert" className="text-sm text-red-400">{erro}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <Botao variante="sutil" type="button" onClick={fechar} disabled={carregando}>Cancelar</Botao>
          <Botao type="submit" carregando={carregando}>Salvar alterações</Botao>
        </div>
      </form>
    </Modal>
  );
}

function ModalNovaEmpresa({ aberto, aoFechar, aoCriar }) {
  const [dados, setDados] = useState({ nome: '', slug: '', email_contato: '', usuario_nome: '', usuario_email: '', usuario_senha: '' });
  const [carregando, setCarregando] = useState(false);
  const mudar = (chave) => (evento) => setDados((atual) => ({ ...atual, [chave]: evento.target.value }));

  async function criar(evento) {
    evento.preventDefault();
    setCarregando(true);
    try {
      await api('/api/admin/empresas', {
        metodo: 'POST',
        perfil: 'admin',
        corpo: {
          nome: dados.nome,
          slug: dados.slug,
          ...(dados.email_contato && { email_contato: dados.email_contato }),
          usuario: { nome: dados.usuario_nome, email: dados.usuario_email, senha: dados.usuario_senha },
        },
      });
      avisar('Empresa criada com acesso de proprietário.');
      setDados({ nome: '', slug: '', email_contato: '', usuario_nome: '', usuario_email: '', usuario_senha: '' });
      aoCriar();
    } catch (erro) {
      avisar(erro.message, 'erro');
    } finally {
      setCarregando(false);
    }
  }

  return (
    <Modal aberto={aberto} titulo="Nova empresa" aoFechar={aoFechar}>
      <form onSubmit={criar} className="space-y-4">
        <Campo rotulo="Nome da empresa" value={dados.nome} onChange={mudar('nome')} required minLength={2} />
        <div className="grid grid-cols-2 gap-4">
          <Campo
            rotulo="Slug" value={dados.slug} onChange={mudar('slug')} required
            pattern="[a-z0-9-]+" dica="letras minúsculas, números e hífens"
          />
          <Campo rotulo="E-mail de contato" type="email" value={dados.email_contato} onChange={mudar('email_contato')} />
        </div>

        <p className="etiqueta pt-2">Primeiro acesso (proprietário)</p>
        <Campo rotulo="Nome" value={dados.usuario_nome} onChange={mudar('usuario_nome')} required minLength={2} />
        <div className="grid grid-cols-2 gap-4">
          <Campo rotulo="E-mail" type="email" value={dados.usuario_email} onChange={mudar('usuario_email')} required />
          <Campo rotulo="Senha" type="password" value={dados.usuario_senha} onChange={mudar('usuario_senha')} required minLength={8} />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Botao variante="sutil" type="button" onClick={aoFechar}>Cancelar</Botao>
          <Botao type="submit" carregando={carregando}>Criar empresa</Botao>
        </div>
      </form>
    </Modal>
  );
}
