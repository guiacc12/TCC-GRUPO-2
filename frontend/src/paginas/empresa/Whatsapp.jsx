import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import {
  Alternador, AreaTexto, Badge, BlocoCodigo, Botao, CabecalhoPagina, Campo, Carregando,
  EstadoVazio, Modal, Selecao, avisar,
} from '../../componentes/ui.jsx';
import { useRevelar } from '../../lib/animacoes.js';

const TOM_CONEXAO = { conectada: 'ok', conectando: 'aviso', desconectada: 'erro' };

export default function Whatsapp() {
  const [instancias, setInstancias] = useState(null);
  const [automacoes, setAutomacoes] = useState(null);
  const [formularios, setFormularios] = useState([]);
  const [modal, setModal] = useState(null); // {tipo:'nova'|'qr'|'credenciais'|'automacao', ...}
  const ref = useRevelar([instancias !== null]);

  async function carregar() {
    const [resInstancias, resAutomacoes, resFormularios] = await Promise.all([
      api('/api/empresa/whatsapp/instancias'),
      api('/api/empresa/whatsapp/automacoes'),
      api('/api/empresa/formularios'),
    ]);
    setInstancias(resInstancias.instancias);
    setAutomacoes(resAutomacoes.automacoes);
    setFormularios(resFormularios.formularios);
  }
  useEffect(() => {
    carregar().catch((erro) => avisar(erro.message, 'erro'));
  }, []);

  async function atualizarEstado(instancia) {
    try {
      const { estado } = await api(`/api/empresa/whatsapp/instancias/${instancia.id}/estado`);
      setInstancias((atuais) => atuais.map((i) => (i.id === instancia.id ? { ...i, status_conexao: estado } : i)));
      avisar(`Estado: ${estado}.`, estado === 'conectada' ? 'ok' : 'erro');
    } catch (erro) {
      avisar(erro.message, 'erro');
    }
  }

  async function removerInstancia(instancia) {
    if (!window.confirm(`Remover a conexão "${instancia.instance_name}"? As automações ligadas a ela serão removidas.`)) return;
    try {
      await api(`/api/empresa/whatsapp/instancias/${instancia.id}`, { metodo: 'DELETE' });
      avisar('Conexão removida.');
      carregar();
    } catch (erro) {
      avisar(erro.message, 'erro');
    }
  }

  async function excluirAutomacao(automacao) {
    if (!window.confirm('Excluir esta automação?')) return;
    try {
      await api(`/api/empresa/whatsapp/automacoes/${automacao.id}`, { metodo: 'DELETE' });
      avisar('Automação excluída.');
      carregar();
    } catch (erro) {
      avisar(erro.message, 'erro');
    }
  }

  if (!instancias || !automacoes) return <Carregando />;

  return (
    <div ref={ref}>
      <CabecalhoPagina
        etiqueta="Automação"
        titulo="WhatsApp"
        descricao="Conecte números via Evolution API e dispare mensagens assim que o lead entrar no CRM."
        acoes={<Botao onClick={() => setModal({ tipo: 'nova' })}>Nova conexão</Botao>}
      />

      {/* Instâncias */}
      {instancias.length === 0 ? (
        <EstadoVazio
          titulo="Nenhum número conectado"
          descricao="Crie uma conexão e escaneie o QR code com o WhatsApp do número que fará os disparos."
          acao={<Botao onClick={() => setModal({ tipo: 'nova' })}>Conectar número</Botao>}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 mb-12" data-revelar>
          {instancias.map((instancia) => (
            <article key={instancia.id} className="cartao cartao-hover p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-editorial text-lg break-all">{instancia.instance_name}</h3>
                  {instancia.numero && <p className="text-xs text-osso-mudo mt-0.5">+{instancia.numero}</p>}
                </div>
                <Badge tom={TOM_CONEXAO[instancia.status_conexao]}>{instancia.status_conexao}</Badge>
              </div>
              <div className="flex flex-wrap gap-2">
                {instancia.status_conexao !== 'conectada' && (
                  <Botao onClick={() => setModal({ tipo: 'qr', instancia })}>Escanear QR</Botao>
                )}
                <Botao variante="fantasma" onClick={() => atualizarEstado(instancia)}>Ver estado</Botao>
                <Botao variante="fantasma" onClick={() => setModal({ tipo: 'credenciais', instancia })}>Usar no n8n</Botao>
                <Botao variante="perigo" onClick={() => removerInstancia(instancia)}>Remover</Botao>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Automações */}
      <section data-revelar>
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="etiqueta">Disparos pós-CRM</p>
            <h2 className="titulo-editorial text-2xl mt-1">Automações</h2>
          </div>
          <Botao
            variante="fantasma"
            disabled={instancias.length === 0}
            onClick={() => setModal({ tipo: 'automacao', automacao: null })}
          >
            Nova automação
          </Botao>
        </div>

        {automacoes.length === 0 ? (
          <div className="cartao p-8 text-center text-sm text-osso-mudo">
            Nenhuma automação ainda. Ex.: enviar “Olá {'{{nome}}'}, recebemos seu contato!” para cada lead novo.
          </div>
        ) : (
          <div className="grid gap-3">
            {automacoes.map((automacao) => (
              <article key={automacao.id} className="cartao cartao-hover p-5 flex flex-wrap items-center gap-4">
                <div className="flex-1 min-w-56 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tom={automacao.tipo_destino === 'grupo' ? 'info' : 'ok'}>
                      {automacao.tipo_destino === 'grupo' ? `grupo · ${automacao.grupo_nome || 'aviso'}` : 'contato do lead'}
                    </Badge>
                    <Badge tom="neutro">{automacao.formulario_nome || 'todos os formulários'}</Badge>
                    {!automacao.ativo && <Badge tom="aviso">pausada</Badge>}
                  </div>
                  <p className="text-sm text-osso-suave line-clamp-2">{automacao.mensagem_template}</p>
                  <p className="text-xs text-osso-mudo">
                    via {automacao.instance_name} · delay {automacao.delay_segundos_min}–{automacao.delay_segundos_max}s
                  </p>
                </div>
                <div className="flex gap-2">
                  <Botao variante="fantasma" onClick={() => setModal({ tipo: 'automacao', automacao })}>Editar</Botao>
                  <Botao variante="perigo" onClick={() => excluirAutomacao(automacao)}>Excluir</Botao>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {modal?.tipo === 'nova' && (
        <ModalNovaConexao
          aoFechar={() => setModal(null)}
          aoCriar={(instancia) => {
            carregar();
            setModal({ tipo: 'qr', instancia });
          }}
        />
      )}
      {modal?.tipo === 'qr' && (
        <ModalQrCode
          instancia={modal.instancia}
          aoFechar={() => {
            setModal(null);
            carregar();
          }}
        />
      )}
      {modal?.tipo === 'credenciais' && <ModalCredenciais instancia={modal.instancia} aoFechar={() => setModal(null)} />}
      {modal?.tipo === 'automacao' && (
        <ModalAutomacao
          automacao={modal.automacao}
          instancias={instancias}
          formularios={formularios}
          aoFechar={() => setModal(null)}
          aoSalvar={() => {
            setModal(null);
            carregar();
          }}
        />
      )}
    </div>
  );
}

function ModalNovaConexao({ aoFechar, aoCriar }) {
  const [nome, setNome] = useState('');
  const [carregando, setCarregando] = useState(false);

  async function criar(evento) {
    evento.preventDefault();
    setCarregando(true);
    try {
      const { instancia } = await api('/api/empresa/whatsapp/instancias', { metodo: 'POST', corpo: { nome } });
      avisar('Conexão criada — escaneie o QR code.');
      aoCriar(instancia);
    } catch (erro) {
      avisar(erro.message, 'erro');
      setCarregando(false);
    }
  }

  return (
    <Modal aberto titulo="Nova conexão de WhatsApp" aoFechar={aoFechar}>
      <form onSubmit={criar} className="space-y-4">
        <Campo
          rotulo="Nome da conexão" value={nome} onChange={(e) => setNome(e.target.value)}
          placeholder="Comercial" required minLength={2}
          dica="Identifica este número no painel e no n8n."
        />
        <div className="flex justify-end gap-3">
          <Botao variante="sutil" type="button" onClick={aoFechar}>Cancelar</Botao>
          <Botao type="submit" carregando={carregando}>Criar e gerar QR</Botao>
        </div>
      </form>
    </Modal>
  );
}

function ModalQrCode({ instancia, aoFechar }) {
  const [qr, setQr] = useState(instancia.qrcode_base64 || null);
  const [estado, setEstado] = useState('conectando');
  const timers = useRef([]);

  useEffect(() => {
    let ativo = true;

    async function renovarQr() {
      try {
        const { qrcode } = await api(`/api/empresa/whatsapp/instancias/${instancia.id}/qrcode?_t=${Date.now()}`);
        if (ativo && qrcode.base64) setQr(qrcode.base64);
      } catch {
        /* QR pode falhar enquanto a Evolution prepara a instância — o polling re-tenta */
      }
    }
    async function checarEstado() {
      try {
        const resposta = await api(`/api/empresa/whatsapp/instancias/${instancia.id}/estado`);
        if (ativo) setEstado(resposta.estado);
      } catch {
        /* idem */
      }
    }

    renovarQr(); // primeira busca imediata
    checarEstado();
    timers.current = [
      setInterval(renovarQr, 20_000), // QR da Evolution expira — renova periodicamente
      setInterval(checarEstado, 3_000),
    ];
    return () => {
      ativo = false;
      timers.current.forEach(clearInterval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instancia.id]);

  const conectada = estado === 'conectada';
  useEffect(() => {
    if (conectada) timers.current.forEach(clearInterval);
  }, [conectada]);

  return (
    <Modal aberto titulo={conectada ? 'Conectado!' : 'Escaneie com o WhatsApp'} aoFechar={aoFechar} largura="max-w-sm">
      <div className="text-center space-y-4">
        {conectada ? (
          <div className="py-10 space-y-3">
            <p className="text-5xl">✓</p>
            <p className="text-estado-ok">Número conectado com sucesso.</p>
          </div>
        ) : qr ? (
          <>
            <div className="bg-white rounded-cartao p-4 inline-block">
              <img src={qr} alt="QR code de conexão" className="w-56 h-56" />
            </div>
            <p className="text-xs text-osso-mudo">
              WhatsApp → Configurações → Aparelhos conectados → Conectar aparelho.
              <br />O código renova sozinho a cada 25s.
            </p>
          </>
        ) : (
          <div className="py-12">
            <span className="inline-block h-6 w-6 rounded-full border-2 border-bronze border-t-transparent animate-spin" />
            <p className="text-xs text-osso-mudo mt-3">Gerando QR code…</p>
          </div>
        )}
        <Botao variante="fantasma" onClick={aoFechar} className="w-full">
          {conectada ? 'Concluir' : 'Fechar'}
        </Botao>
      </div>
    </Modal>
  );
}

function ModalCredenciais({ instancia, aoFechar }) {
  const [credenciais, setCredenciais] = useState(null);

  useEffect(() => {
    api(`/api/empresa/whatsapp/instancias/${instancia.id}/credenciais`)
      .then((dados) => setCredenciais(dados.credenciais))
      .catch((erro) => avisar(erro.message, 'erro'));
  }, [instancia.id]);

  return (
    <Modal aberto titulo="Credenciais para o n8n" aoFechar={aoFechar} largura="max-w-xl">
      {!credenciais ? (
        <Carregando />
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-osso-suave">
            Use esta mesma instância nos seus fluxos do n8n (nó Evolution API ou requisições HTTP com o header{' '}
            <code className="text-bronze-claro">apikey</code>):
          </p>
          <BlocoCodigo rotulo="Servidor (base URL)" codigo={credenciais.base_url || 'configure EVOLUTION_BASE_URL no backend'} />
          <BlocoCodigo rotulo="Instance name" codigo={credenciais.instance_name} />
          <BlocoCodigo rotulo="Token da instância (apikey)" codigo={credenciais.token} />
          <p className="text-xs text-estado-aviso">
            ⚠️ Este token dá acesso total a este número. Não compartilhe nem exponha em sites públicos.
          </p>
        </div>
      )}
    </Modal>
  );
}

function ModalAutomacao({ automacao, instancias, formularios, aoFechar, aoSalvar }) {
  const [dados, setDados] = useState(
    automacao
      ? {
          instancia_id: String(automacao.instancia_id),
          formulario_id: automacao.formulario_id ? String(automacao.formulario_id) : '',
          tipo_destino: automacao.tipo_destino,
          grupo_jid: automacao.grupo_jid || '',
          grupo_nome: automacao.grupo_nome || '',
          mensagem_template: automacao.mensagem_template,
          delay_segundos_min: automacao.delay_segundos_min,
          delay_segundos_max: automacao.delay_segundos_max,
          ativo: Boolean(automacao.ativo),
        }
      : {
          instancia_id: String(instancias[0]?.id || ''),
          formulario_id: '',
          tipo_destino: 'contato_lead',
          grupo_jid: '',
          grupo_nome: '',
          mensagem_template: 'Olá {{nome}}! Recebemos seu contato e já vamos te atender. 😊',
          delay_segundos_min: 2,
          delay_segundos_max: 8,
          ativo: true,
        }
  );
  const [grupos, setGrupos] = useState(null);
  const [carregando, setCarregando] = useState(false);

  // Carrega os grupos da instância quando o destino é grupo
  useEffect(() => {
    if (dados.tipo_destino !== 'grupo' || !dados.instancia_id) return;
    setGrupos(null);
    api(`/api/empresa/whatsapp/instancias/${dados.instancia_id}/grupos`)
      .then((resposta) => setGrupos(resposta.grupos))
      .catch((erro) => {
        setGrupos([]);
        avisar(`Não foi possível listar os grupos: ${erro.message}`, 'erro');
      });
  }, [dados.tipo_destino, dados.instancia_id]);

  async function salvar(evento) {
    evento.preventDefault();
    setCarregando(true);
    try {
      const corpo = {
        instancia_id: Number(dados.instancia_id),
        formulario_id: dados.formulario_id ? Number(dados.formulario_id) : null,
        tipo_destino: dados.tipo_destino,
        ...(dados.tipo_destino === 'grupo' && { grupo_jid: dados.grupo_jid, grupo_nome: dados.grupo_nome }),
        mensagem_template: dados.mensagem_template,
        delay_segundos_min: Number(dados.delay_segundos_min),
        delay_segundos_max: Number(dados.delay_segundos_max),
        ativo: dados.ativo,
      };
      if (automacao) {
        await api(`/api/empresa/whatsapp/automacoes/${automacao.id}`, { metodo: 'PUT', corpo });
        avisar('Automação atualizada.');
      } else {
        await api('/api/empresa/whatsapp/automacoes', { metodo: 'POST', corpo });
        avisar('Automação criada.');
      }
      aoSalvar();
    } catch (erro) {
      avisar(erro.message, 'erro');
    } finally {
      setCarregando(false);
    }
  }

  return (
    <Modal aberto titulo={automacao ? 'Editar automação' : 'Nova automação'} aoFechar={aoFechar} largura="max-w-2xl">
      <form onSubmit={salvar} className="space-y-4">
        <div className="grid md:grid-cols-2 gap-4">
          <Selecao
            rotulo="Número (instância)" value={dados.instancia_id}
            onChange={(e) => setDados({ ...dados, instancia_id: e.target.value, grupo_jid: '' })}
            opcoes={instancias.map((i) => ({ valor: String(i.id), texto: i.instance_name }))}
          />
          <Selecao
            rotulo="Disparar para leads de" value={dados.formulario_id}
            onChange={(e) => setDados({ ...dados, formulario_id: e.target.value })}
            opcoes={[
              { valor: '', texto: 'Todos os formulários' },
              ...formularios.map((f) => ({ valor: String(f.id), texto: f.nome })),
            ]}
          />
        </div>

        <Selecao
          rotulo="Destino da mensagem" value={dados.tipo_destino}
          onChange={(e) => setDados({ ...dados, tipo_destino: e.target.value })}
          opcoes={[
            { valor: 'contato_lead', texto: 'WhatsApp do próprio lead' },
            { valor: 'grupo', texto: 'Grupo de aviso (equipe)' },
          ]}
        />

        {dados.tipo_destino === 'grupo' && (
          grupos === null ? (
            <p className="text-xs text-osso-mudo">Carregando grupos do número…</p>
          ) : (
            <Selecao
              rotulo="Grupo" value={dados.grupo_jid} required
              onChange={(e) => {
                const grupo = grupos.find((g) => g.jid === e.target.value);
                setDados({ ...dados, grupo_jid: e.target.value, grupo_nome: grupo?.nome || '' });
              }}
              opcoes={[
                { valor: '', texto: grupos.length ? 'Selecione o grupo…' : 'Nenhum grupo encontrado (instância conectada?)' },
                ...grupos.map((g) => ({ valor: g.jid, texto: `${g.nome} (${g.participantes})` })),
              ]}
            />
          )
        )}

        <AreaTexto
          rotulo="Mensagem" value={dados.mensagem_template} required
          onChange={(e) => setDados({ ...dados, mensagem_template: e.target.value })}
          dica="Variáveis: {{nome}}, {{email}}, {{telefone}}, {{utm_source}}, {{utm_campaign}}, {{pagina}} e qualquer campo do formulário."
        />

        <div className="grid grid-cols-2 md:grid-cols-[140px_140px_1fr] gap-4 items-end">
          <Campo
            rotulo="Delay mín. (s)" type="number" min={0} max={600} value={dados.delay_segundos_min}
            onChange={(e) => setDados({ ...dados, delay_segundos_min: e.target.value })}
          />
          <Campo
            rotulo="Delay máx. (s)" type="number" min={0} max={600} value={dados.delay_segundos_max}
            onChange={(e) => setDados({ ...dados, delay_segundos_max: e.target.value })}
          />
          <div className="pb-1">
            <Alternador rotulo="Automação ativa" ativo={dados.ativo} aoMudar={(valor) => setDados({ ...dados, ativo: valor })} />
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-1">
          <Botao variante="sutil" type="button" onClick={aoFechar}>Cancelar</Botao>
          <Botao type="submit" carregando={carregando}>{automacao ? 'Salvar' : 'Criar automação'}</Botao>
        </div>
      </form>
    </Modal>
  );
}
