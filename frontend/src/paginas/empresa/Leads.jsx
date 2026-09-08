import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import {
  Badge, Botao, CabecalhoPagina, Campo, Carregando, EstadoVazio, Modal, Selecao, avisar, formatarData,
} from '../../componentes/ui.jsx';
import { useRevelar } from '../../lib/animacoes.js';

const TOM_STATUS = { novo: 'info', processando: 'aviso', entregue: 'ok', erro: 'erro' };
const TOM_CANAL = { crm: 'info', whatsapp_contato: 'ok', whatsapp_grupo: 'ok' };
const NOME_CANAL = { crm: 'CRM', whatsapp_contato: 'WhatsApp · contato', whatsapp_grupo: 'WhatsApp · grupo' };

export default function Leads() {
  const [parametros, setParametros] = useSearchParams();
  const [dados, setDados] = useState(null);
  const [filtros, setFiltros] = useState({ status: '', busca: '', de: '', ate: '' });
  const [pagina, setPagina] = useState(1);
  const [leadAberto, setLeadAberto] = useState(null);
  const [selecionados, setSelecionados] = useState(new Set());
  const [excluindo, setExcluindo] = useState(false);
  const [reenviando, setReenviando] = useState(null);
  const [duplicados, setDuplicados] = useState([]);
  const [alertaFechado, setAlertaFechado] = useState(false);
  const ref = useRevelar([dados !== null]);

  async function carregar() {
    const consulta = new URLSearchParams({ pagina, por_pagina: 25 });
    Object.entries(filtros).forEach(([chave, valor]) => valor && consulta.set(chave, valor));
    const resposta = await api(`/api/empresa/leads?${consulta}`);
    setDados(resposta);
    setSelecionados(new Set());
  }

  async function carregarDuplicados() {
    try {
      const resposta = await api('/api/empresa/leads/duplicados-crm');
      setDuplicados(resposta.grupos || []);
    } catch (erro) {
      // silencioso — alerta de duplicados não deve travar a página
    }
  }

  function toggleSelecionado(id) {
    setSelecionados((ant) => {
      const novo = new Set(ant);
      novo.has(id) ? novo.delete(id) : novo.add(id);
      return novo;
    });
  }

  function toggleTodos() {
    if (!dados) return;
    const idsPagina = dados.leads.map((l) => l.id);
    const todosMarcados = idsPagina.every((id) => selecionados.has(id));
    setSelecionados((ant) => {
      const novo = new Set(ant);
      if (todosMarcados) idsPagina.forEach((id) => novo.delete(id));
      else idsPagina.forEach((id) => novo.add(id));
      return novo;
    });
  }

  async function excluirSelecionados() {
    if (selecionados.size === 0) return;
    const confirmado = window.confirm(`Excluir ${selecionados.size} lead${selecionados.size > 1 ? 's' : ''}? Esta ação não pode ser desfeita.`);
    if (!confirmado) return;
    setExcluindo(true);
    try {
      const resultado = await api('/api/empresa/leads', {
        metodo: 'DELETE',
        corpo: { ids: [...selecionados] },
      });
      avisar(`${resultado.excluidos} lead${resultado.excluidos !== 1 ? 's' : ''} excluído${resultado.excluidos !== 1 ? 's' : ''}`, 'ok');
      await carregar();
      await carregarDuplicados();
    } catch (erro) {
      avisar(erro.message, 'erro');
    } finally {
      setExcluindo(false);
    }
  }

  async function salvarCrmId(id, valor) {
    try {
      await api(`/api/empresa/leads/${id}/crm-id`, { metodo: 'PATCH', corpo: { crm_id_externo: valor } });
      avisar('ID do CRM atualizado', 'ok');
      await carregar();
      await carregarDuplicados();
      if (leadAberto?.lead?.id === id) await abrirDetalhe(id);
    } catch (erro) {
      avisar(erro.message, 'erro');
    }
  }

  async function reenviarLead(id) {
    setReenviando(id);
    try {
      await api(`/api/empresa/leads/${id}/replay`, { metodo: 'POST' });
      avisar('Lead reenviado para a fila', 'ok');
      await carregar();
      if (leadAberto?.lead?.id === id) await abrirDetalhe(id);
    } catch (erro) {
      avisar(erro.message, 'erro');
    } finally {
      setReenviando(null);
    }
  }

  useEffect(() => {
    carregar().catch((erro) => avisar(erro.message, 'erro'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagina, filtros.status, filtros.de, filtros.ate]);

  useEffect(() => {
    carregarDuplicados();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deep-link ?abrir=<id> vindo da visão geral
  useEffect(() => {
    const id = parametros.get('abrir');
    if (id) {
      abrirDetalhe(id);
      setParametros({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function abrirDetalhe(id) {
    try {
      const resposta = await api(`/api/empresa/leads/${id}`);
      setLeadAberto(resposta);
    } catch (erro) {
      avisar(erro.message, 'erro');
    }
  }

  const totalPaginas = dados ? Math.max(1, Math.ceil(dados.total / dados.por_pagina)) : 1;

  return (
    <div ref={ref}>
      {duplicados.length > 0 && !alertaFechado && (
        <AlertaDuplicadosCrm
          grupos={duplicados}
          aoFechar={() => setAlertaFechado(true)}
          aoAbrirLead={abrirDetalhe}
          aoSalvarCrmId={salvarCrmId}
        />
      )}

      <CabecalhoPagina
        etiqueta="Captação"
        titulo="Leads"
        descricao="Tudo que seus formulários capturaram, com a trilha de entrega de cada lead."
      />

      {/* Filtros */}
      <div className="cartao p-4 mb-6 grid gap-3 md:grid-cols-[1fr_160px_150px_150px_auto]" data-revelar>
        <Campo
          placeholder="Buscar por nome, e-mail ou telefone…"
          value={filtros.busca}
          onChange={(e) => setFiltros((f) => ({ ...f, busca: e.target.value }))}
          onKeyDown={(e) => e.key === 'Enter' && (setPagina(1), carregar())}
        />
        <Selecao
          value={filtros.status}
          onChange={(e) => (setPagina(1), setFiltros((f) => ({ ...f, status: e.target.value })))}
          opcoes={[
            { valor: '', texto: 'Todos os status' },
            { valor: 'novo', texto: 'Novo' },
            { valor: 'processando', texto: 'Processando' },
            { valor: 'entregue', texto: 'Entregue' },
            { valor: 'erro', texto: 'Erro' },
          ]}
        />
        <Campo type="date" value={filtros.de} onChange={(e) => (setPagina(1), setFiltros((f) => ({ ...f, de: e.target.value })))} />
        <Campo type="date" value={filtros.ate} onChange={(e) => (setPagina(1), setFiltros((f) => ({ ...f, ate: e.target.value })))} />
        <Botao variante="fantasma" onClick={() => (setPagina(1), carregar())}>Filtrar</Botao>
      </div>

      {!dados ? (
        <Carregando />
      ) : dados.leads.length === 0 ? (
        <EstadoVazio titulo="Nenhum lead encontrado" descricao="Ajuste os filtros ou aguarde novas capturas." />
      ) : (
        <>
          {/* Barra de ações de seleção */}
          {selecionados.size > 0 && (
            <div className="flex items-center justify-between mb-3 px-4 py-2.5 rounded-lg bg-vidro border border-linha" data-revelar>
              <span className="text-sm text-osso-suave">
                {selecionados.size} lead{selecionados.size > 1 ? 's' : ''} selecionado{selecionados.size > 1 ? 's' : ''}
              </span>
              <div className="flex items-center gap-2">
                <Botao variante="sutil" onClick={() => setSelecionados(new Set())}>Limpar seleção</Botao>
                <Botao variante="perigo" onClick={excluirSelecionados} disabled={excluindo}>
                  {excluindo ? 'Excluindo…' : 'Excluir selecionados'}
                </Botao>
              </div>
            </div>
          )}

          <div className="cartao overflow-hidden" data-revelar>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-linha text-left">
                  <th className="px-4 py-3 w-10">
                    <input
                      type="checkbox"
                      className="accent-destaque w-3.5 h-3.5 cursor-pointer"
                      checked={dados.leads.length > 0 && dados.leads.every((l) => selecionados.has(l.id))}
                      onChange={toggleTodos}
                    />
                  </th>
                  {['Lead', 'Formulário', 'Origem', 'Status', 'Quando'].map((coluna) => (
                    <th key={coluna} className="etiqueta px-5 py-3 font-medium">{coluna}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[rgba(233,229,220,0.05)]">
                {dados.leads.map((lead) => (
                  <tr
                    key={lead.id}
                    onClick={() => abrirDetalhe(lead.id)}
                    className={`cursor-pointer hover:bg-vidro transition-colors ${selecionados.has(lead.id) ? 'bg-vidro' : ''}`}
                  >
                    <td className="px-4 py-3.5" onClick={(e) => { e.stopPropagation(); toggleSelecionado(lead.id); }}>
                      <input
                        type="checkbox"
                        className="accent-destaque w-3.5 h-3.5 cursor-pointer"
                        checked={selecionados.has(lead.id)}
                        onChange={() => toggleSelecionado(lead.id)}
                      />
                    </td>
                    <td className="px-5 py-3.5">
                      <p className="truncate max-w-52">
                        {lead.crm_id_externo && (
                          <span className="text-xs text-osso-mudo font-mono mr-1.5">#{lead.crm_id_externo}</span>
                        )}
                        {lead.nome || '—'}
                      </p>
                      <p className="text-xs text-osso-mudo truncate max-w-52">{lead.email || lead.telefone || ''}</p>
                    </td>
                    <td className="px-5 py-3.5 text-osso-suave">{lead.formulario_nome || '—'}</td>
                    <td className="px-5 py-3.5 text-osso-suave">
                      {lead.utm_source || '—'}
                      {lead.utm_campaign && <p className="text-xs text-osso-mudo truncate max-w-40">{lead.utm_campaign}</p>}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <Badge tom={TOM_STATUS[lead.status]}>{lead.status}</Badge>
                        {lead.status === 'erro' && (
                          <Botao
                            variante="sutil"
                            className="!px-2 !py-1 text-xs underline underline-offset-2"
                            onClick={(e) => { e.stopPropagation(); reenviarLead(lead.id); }}
                            disabled={reenviando === lead.id}
                          >
                            {reenviando === lead.id ? 'Reenviando…' : 'Reenviar'}
                          </Botao>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-xs text-osso-mudo whitespace-nowrap">{formatarData(lead.criado_em)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between mt-4 text-xs text-osso-mudo" data-revelar>
            <span>{dados.total} lead{dados.total === 1 ? '' : 's'}</span>
            <div className="flex items-center gap-3">
              <Botao variante="sutil" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>← anterior</Botao>
              <span>{pagina} / {totalPaginas}</span>
              <Botao variante="sutil" disabled={pagina >= totalPaginas} onClick={() => setPagina(pagina + 1)}>próxima →</Botao>
            </div>
          </div>
        </>
      )}

      <DetalheLead
        key={leadAberto?.lead?.id}
        dados={leadAberto}
        aoFechar={() => setLeadAberto(null)}
        aoReenviar={reenviarLead}
        reenviando={reenviando}
        aoSalvarCrmId={salvarCrmId}
      />
    </div>
  );
}

function AlertaDuplicadosCrm({ grupos, aoFechar, aoAbrirLead, aoSalvarCrmId }) {
  const totalLeads = grupos.reduce((soma, g) => soma + g.leads.length, 0);
  const [editando, setEditando] = useState(null); // { id, valor }
  const [salvando, setSalvando] = useState(null);

  async function confirmar() {
    if (!editando) return;
    setSalvando(editando.id);
    await aoSalvarCrmId(editando.id, editando.valor);
    setSalvando(null);
    setEditando(null);
  }

  return (
    <div className="fixed top-4 right-4 z-50 w-96 max-w-[calc(100vw-2rem)]">
      <div className="cartao border-estado-erro/40 bg-vidro backdrop-blur-xl shadow-2xl overflow-hidden">
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-linha">
          <div>
            <p className="text-sm font-medium text-osso">Possível mesclagem no CRM</p>
            <p className="text-xs text-osso-mudo mt-0.5">
              {grupos.length} deal{grupos.length > 1 ? 's' : ''} do CRM com {totalLeads} leads vinculados — confira se não houve merge indevido.
            </p>
          </div>
          <button
            onClick={aoFechar}
            className="text-osso-mudo hover:text-osso transition-colors text-lg leading-none shrink-0"
            aria-label="Fechar alerta"
          >
            ×
          </button>
        </div>
        <div className="max-h-96 overflow-y-auto divide-y divide-[rgba(233,229,220,0.05)]">
          {grupos.map((grupo) => (
            <div key={grupo.crm_id_externo} className="px-4 py-3">
              <p className="etiqueta mb-2">CRM #{grupo.crm_id_externo}</p>
              <ul className="space-y-1.5">
                {grupo.leads.map((lead) => (
                  <li key={lead.id}>
                    {editando?.id === lead.id ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          autoFocus
                          value={editando.valor}
                          onChange={(e) => setEditando({ id: lead.id, valor: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') confirmar();
                            if (e.key === 'Escape') setEditando(null);
                          }}
                          className="flex-1 min-w-0 bg-transparent border border-linha rounded px-1.5 py-1 text-xs focus:outline-none focus:border-destaque"
                          placeholder="Novo id do CRM…"
                        />
                        <button
                          onClick={confirmar}
                          disabled={salvando === lead.id}
                          className="text-xs text-estado-ok shrink-0"
                        >
                          {salvando === lead.id ? '…' : 'salvar'}
                        </button>
                        <button onClick={() => setEditando(null)} className="text-xs text-osso-mudo shrink-0">
                          cancelar
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => aoAbrirLead(lead.id)}
                          className="flex-1 min-w-0 flex items-center justify-between gap-2 text-left hover:text-destaque transition-colors"
                        >
                          <span className="text-xs truncate">{lead.nome || `Lead #${lead.id}`}</span>
                          <span className="text-xs text-osso-mudo whitespace-nowrap">{formatarData(lead.criado_em)}</span>
                        </button>
                        <button
                          onClick={() => setEditando({ id: lead.id, valor: lead.crm_id_externo || '' })}
                          className="text-xs text-osso-mudo hover:text-osso shrink-0 underline underline-offset-2"
                        >
                          alterar id
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DetalheLead({ dados, aoFechar, aoReenviar, reenviando, aoSalvarCrmId }) {
  const [editandoCrm, setEditandoCrm] = useState(false);
  const [valorCrm, setValorCrm] = useState('');
  const [salvandoCrm, setSalvandoCrm] = useState(false);

  if (!dados) return null;
  const { lead, entregas } = dados;
  const camposJson = typeof lead.dados_json === 'string' ? JSON.parse(lead.dados_json || '{}') : lead.dados_json || {};
  const utms = [
    ['utm_source', lead.utm_source], ['utm_medium', lead.utm_medium], ['utm_campaign', lead.utm_campaign],
    ['utm_term', lead.utm_term], ['utm_content', lead.utm_content],
    ['página', lead.landing_page], ['referrer', lead.referrer],
  ].filter(([, valor]) => valor);

  function abrirEdicaoCrm() {
    setValorCrm(lead.crm_id_externo || '');
    setEditandoCrm(true);
  }

  async function confirmarCrm() {
    setSalvandoCrm(true);
    await aoSalvarCrmId(lead.id, valorCrm);
    setSalvandoCrm(false);
    setEditandoCrm(false);
  }

  return (
    <Modal aberto titulo={lead.nome || `Lead #${lead.id}`} aoFechar={aoFechar} largura="max-w-2xl">
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tom={TOM_STATUS[lead.status]}>{lead.status}</Badge>

          {editandoCrm ? (
            <div className="flex items-center gap-1.5">
              <input
                autoFocus
                value={valorCrm}
                onChange={(e) => setValorCrm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') confirmarCrm();
                  if (e.key === 'Escape') setEditandoCrm(false);
                }}
                placeholder="Id do deal no CRM…"
                className="bg-transparent border border-linha rounded px-2 py-1 text-xs w-40 focus:outline-none focus:border-destaque"
              />
              <button onClick={confirmarCrm} disabled={salvandoCrm} className="text-xs text-estado-ok">
                {salvandoCrm ? '…' : 'salvar'}
              </button>
              <button onClick={() => setEditandoCrm(false)} className="text-xs text-osso-mudo">
                cancelar
              </button>
            </div>
          ) : (
            <button onClick={abrirEdicaoCrm} className="group">
              <Badge tom={lead.crm_id_externo ? 'info' : undefined}>
                {lead.crm_id_externo ? `CRM #${lead.crm_id_externo}` : 'Vincular CRM'}
                <span className="ml-1.5 text-osso-mudo underline underline-offset-2 group-hover:text-osso">
                  alterar
                </span>
              </Badge>
            </button>
          )}

          {lead.status === 'erro' && (
            <Botao
              variante="fantasma"
              className="!px-3 !py-1.5 text-xs"
              onClick={() => aoReenviar(lead.id)}
              disabled={reenviando === lead.id}
            >
              {reenviando === lead.id ? 'Reenviando…' : 'Reenviar'}
            </Botao>
          )}
          <span className="text-xs text-osso-mudo ml-auto">{formatarData(lead.criado_em)}</span>
        </div>

        <section className="grid grid-cols-2 gap-x-6 gap-y-3">
          {Object.entries(camposJson).map(([chave, valor]) => (
            <div key={chave}>
              <p className="etiqueta">{chave}</p>
              <p className="text-sm mt-0.5 break-words">{String(valor)}</p>
            </div>
          ))}
        </section>

        {utms.length > 0 && (
          <section>
            <p className="etiqueta mb-2">Rastreamento</p>
            <div className="cartao p-4 grid grid-cols-2 gap-x-6 gap-y-2">
              {utms.map(([chave, valor]) => (
                <p key={chave} className="text-xs text-osso-suave break-all">
                  <span className="text-osso-mudo">{chave}:</span> {valor}
                </p>
              ))}
            </div>
          </section>
        )}

        <section>
          <p className="etiqueta mb-2">Trilha de entrega</p>
          {entregas.length === 0 ? (
            <p className="text-sm text-osso-mudo">Nenhuma tentativa registrada ainda.</p>
          ) : (
            <ol className="space-y-2">
              {entregas.map((entrega, indice) => (
                <li key={indice} className="cartao p-3.5 flex items-start gap-3">
                  <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${entrega.sucesso ? 'bg-estado-ok' : 'bg-estado-erro'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge tom={entrega.sucesso ? TOM_CANAL[entrega.canal] : 'erro'}>{NOME_CANAL[entrega.canal]}</Badge>
                      <span className="text-xs text-osso-suave">{entrega.destino}</span>
                      <span className="text-xs text-osso-mudo ml-auto">{formatarData(entrega.criado_em)}</span>
                    </div>
                    {entrega.detalhe && <p className="text-xs text-osso-mudo mt-1.5 break-words">{entrega.detalhe}</p>}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </Modal>
  );
}
