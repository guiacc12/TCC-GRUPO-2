import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import {
  Badge, BlocoCodigo, Botao, CabecalhoPagina, Campo, Carregando, EstadoVazio, Modal, avisar, formatarData,
} from '../../componentes/ui.jsx';
import { useRevelar } from '../../lib/animacoes.js';

const TOM_STATUS = { ativa: 'ok', suspensa: 'aviso', cancelada: 'erro' };

export default function Empresas() {
  const [empresas, setEmpresas] = useState(null);
  const [modalAberto, setModalAberto] = useState(false);
  const [empresaEdicao, setEmpresaEdicao] = useState(null);
  const [empresaSenha, setEmpresaSenha] = useState(null);
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
                <Botao variante="fantasma" onClick={() => setEmpresaSenha(empresa)}>Recuperar senha</Botao>
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
      {empresaSenha && (
        <ModalRecuperarSenha key={empresaSenha.id} empresa={empresaSenha} aoFechar={() => setEmpresaSenha(null)} />
      )}
    </div>
  );
}

function ModalRecuperarSenha({ empresa, aoFechar }) {
  const [usuarios, setUsuarios] = useState(null);
  const [gerandoId, setGerandoId] = useState(null);
  const [gerada, setGerada] = useState(null);

  useEffect(() => {
    api(`/api/admin/empresas/${empresa.id}/usuarios`, { perfil: 'admin' })
      .then((dados) => setUsuarios(dados.usuarios))
      .catch((erro) => {
        avisar(erro.message, 'erro');
        aoFechar();
      });
  }, [empresa.id]);

  async function gerar(usuario) {
    if (!window.confirm(`Gerar uma senha temporária para ${usuario.nome}? A senha atual deixa de funcionar na hora.`)) return;
    setGerandoId(usuario.id);
    try {
      const dados = await api(`/api/admin/usuarios/${usuario.id}/redefinir-senha`, { metodo: 'POST', perfil: 'admin' });
      setGerada({ usuario, senha: dados.senha_temporaria });
    } catch (erro) {
      avisar(erro.message, 'erro');
    } finally {
      setGerandoId(null);
    }
  }

  const fechar = () => { if (gerandoId === null) aoFechar(); };

  return (
    <Modal aberto titulo="Recuperar senha" aoFechar={fechar}>
      {gerada ? (
        <div className="space-y-4">
          <p className="text-sm text-osso-suave">
            Envie esta senha para <span className="text-osso">{gerada.usuario.nome}</span>{' '}
            (<span className="break-all">{gerada.usuario.email}</span>). No próximo acesso, será obrigatório definir uma senha nova.
          </p>
          <BlocoCodigo rotulo="Senha temporária" codigo={gerada.senha} />
          <p className="text-xs text-estado-aviso">Ela não será exibida de novo. Copie antes de fechar.</p>
          <div className="flex justify-end pt-2">
            <Botao onClick={aoFechar}>Concluir</Botao>
          </div>
        </div>
      ) : !usuarios ? (
        <Carregando />
      ) : usuarios.length === 0 ? (
        <p className="text-sm text-osso-mudo">{empresa.nome} não tem usuários cadastrados.</p>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-osso-mudo">
            Escolha a conta de <span className="text-osso-suave">{empresa.nome}</span>. Será gerada uma senha aleatória para você repassar ao dono.
          </p>
          <ul className="space-y-2">
            {usuarios.map((usuario) => (
              <li key={usuario.id} className="cartao p-4 flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-40">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-osso">{usuario.nome}</span>
                    <Badge tom={usuario.papel === 'proprietario' ? 'info' : 'neutro'}>{usuario.papel}</Badge>
                    {Boolean(usuario.deve_trocar_senha) && <Badge tom="aviso">aguardando troca</Badge>}
                    {!usuario.ativo && <Badge tom="erro">inativo</Badge>}
                  </div>
                  <p className="text-xs text-osso-mudo mt-1 break-all">{usuario.email}</p>
                  <p className="text-xs text-osso-mudo">Último acesso: {formatarData(usuario.ultimo_login_em)}</p>
                </div>
                <Botao
                  variante="fantasma"
                  onClick={() => gerar(usuario)}
                  carregando={gerandoId === usuario.id}
                  disabled={gerandoId !== null}
                >
                  Gerar senha temporária
                </Botao>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
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
