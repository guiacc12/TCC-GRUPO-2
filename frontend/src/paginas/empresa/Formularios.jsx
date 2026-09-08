import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import {
  Alternador, Badge, Botao, CabecalhoPagina, Campo, Carregando, EstadoVazio, Modal, Selecao, avisar, formatarData,
} from '../../componentes/ui.jsx';
import { useRevelar } from '../../lib/animacoes.js';

const TIPOS = [
  { valor: 'texto', texto: 'Texto' }, { valor: 'email', texto: 'E-mail' }, { valor: 'telefone', texto: 'Telefone' },
  { valor: 'textarea', texto: 'Texto longo' }, { valor: 'select', texto: 'Seleção' }, { valor: 'checkbox', texto: 'Checkbox' },
  { valor: 'numero', texto: 'Número' }, { valor: 'data', texto: 'Data' }, { valor: 'oculto', texto: 'Oculto' },
];
const PAPEIS = [
  { valor: 'personalizado', texto: 'Campo comum' }, { valor: 'nome', texto: 'Nome do lead' },
  { valor: 'email', texto: 'E-mail do lead' }, { valor: 'telefone', texto: 'Telefone/WhatsApp do lead' },
];

const CAMPO_NOVO = {
  nome_campo: '', rotulo: '', tipo: 'texto', papel: 'personalizado',
  obrigatorio: false, placeholder: '', opcoes: '',
  mapeamento_pessoa: '', mapeamento_deal: '',
};
const UTM_PARAMS = [
  { valor: 'utm_source', texto: 'utm_source — Fonte de tráfego' },
  { valor: 'utm_medium', texto: 'utm_medium — Mídia' },
  { valor: 'utm_campaign', texto: 'utm_campaign — Campanha' },
  { valor: 'utm_term', texto: 'utm_term — Palavra-chave' },
  { valor: 'utm_content', texto: 'utm_content — Conteúdo do anúncio' },
];

const MODELO_INICIAL = {
  nome: '', mensagem_sucesso: '', redirect_url: '', ativo: true,
  origem: '', tags: '', mapeamentos_fixos_crm: [], mapeamentos_utm_crm: [],
  leadpass_tags: [], leadpass_campos_fixos: [],
  campos: [
    { ...CAMPO_NOVO, nome_campo: 'nome', rotulo: 'Nome', papel: 'nome', obrigatorio: true },
    { ...CAMPO_NOVO, nome_campo: 'email', rotulo: 'E-mail', tipo: 'email', papel: 'email', obrigatorio: true },
    { ...CAMPO_NOVO, nome_campo: 'whatsapp', rotulo: 'WhatsApp', tipo: 'telefone', papel: 'telefone', obrigatorio: true },
  ],
};

export default function Formularios() {
  const [formularios, setFormularios] = useState(null);
  const [editor, setEditor] = useState(null);
  const ref = useRevelar([formularios !== null]);

  async function carregar() {
    const dados = await api('/api/empresa/formularios');
    setFormularios(dados.formularios);
  }
  useEffect(() => {
    carregar().catch((erro) => avisar(erro.message, 'erro'));
  }, []);

  async function abrirEdicao(id) {
    try {
      const { formulario } = await api(`/api/empresa/formularios/${id}`);
      const tagsArray = Array.isArray(formulario.tags) ? formulario.tags : (formulario.tags ? JSON.parse(formulario.tags) : []);
      const fixos = Array.isArray(formulario.mapeamentos_fixos_crm)
        ? formulario.mapeamentos_fixos_crm
        : (formulario.mapeamentos_fixos_crm ? JSON.parse(formulario.mapeamentos_fixos_crm) : []);
      const utms = Array.isArray(formulario.mapeamentos_utm_crm)
        ? formulario.mapeamentos_utm_crm
        : (formulario.mapeamentos_utm_crm ? JSON.parse(formulario.mapeamentos_utm_crm) : []);
      const lpTags = Array.isArray(formulario.leadpass_tags)
        ? formulario.leadpass_tags
        : (formulario.leadpass_tags ? JSON.parse(formulario.leadpass_tags) : []);
      let lpCamposFixos = [];
      if (formulario.leadpass_campos_fixos) {
        try {
          const parsed = Array.isArray(formulario.leadpass_campos_fixos)
            ? formulario.leadpass_campos_fixos
            : JSON.parse(formulario.leadpass_campos_fixos);
          lpCamposFixos = parsed.map((cf) => ({
            tipo: cf.tipo || 'contact',
            campo: cf.campo || '',
            origem: cf.origem || 'fixo',
            valor: cf.valor ?? '',
            campo_origem: cf.campo_origem || '',
          }));
        } catch {
          lpCamposFixos = [];
        }
      }
      setEditor({
        id,
        nome: formulario.nome,
        mensagem_sucesso: formulario.mensagem_sucesso || '',
        redirect_url: formulario.redirect_url || '',
        ativo: Boolean(formulario.ativo),
        origem: formulario.origem || '',
        tags: tagsArray.join(', '),
        mapeamentos_fixos_crm: fixos,
        mapeamentos_utm_crm: utms,
        leadpass_tags: lpTags,
        leadpass_campos_fixos: lpCamposFixos,
        campos: formulario.campos.map((campo) => {
          const crms = Array.isArray(campo.mapeamento_crm)
            ? campo.mapeamento_crm
            : (campo.mapeamento_crm ? JSON.parse(campo.mapeamento_crm) : []);
          return {
            nome_campo: campo.nome_campo,
            rotulo: campo.rotulo,
            tipo: campo.tipo,
            papel: campo.papel,
            obrigatorio: Boolean(campo.obrigatorio),
            placeholder: campo.placeholder || '',
            opcoes: (Array.isArray(campo.opcoes_json) ? campo.opcoes_json : JSON.parse(campo.opcoes_json || '[]')).join(', '),
            mapeamento_pessoa: crms.find((c) => c.startsWith('person:')) || '',
            mapeamento_deal: crms.find((c) => c.startsWith('deal:')) || '',
          };
        }),
      });
    } catch (erro) {
      avisar(erro.message, 'erro');
    }
  }

  async function excluir(formulario) {
    if (!window.confirm(`Excluir o formulário "${formulario.nome}"? Os leads capturados são preservados.`)) return;
    try {
      await api(`/api/empresa/formularios/${formulario.id}`, { metodo: 'DELETE' });
      avisar('Formulário excluído. Leads preservados.');
      carregar();
    } catch (erro) {
      avisar(erro.message, 'erro');
    }
  }

  if (!formularios) return <Carregando />;

  return (
    <div ref={ref}>
      <CabecalhoPagina
        etiqueta="Captura"
        titulo="Formulários"
        descricao="Monte os campos, gere o código e publique sem iframe — com UTM automático."
        acoes={<Botao onClick={() => setEditor({ ...MODELO_INICIAL })}>Novo formulário</Botao>}
      />

      {formularios.length === 0 ? (
        <EstadoVazio
          titulo="Nenhum formulário ainda"
          descricao="Crie o primeiro formulário e implemente no seu site em minutos."
          acao={<Botao onClick={() => setEditor({ ...MODELO_INICIAL })}>Criar formulário</Botao>}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2" data-revelar>
          {formularios.map((formulario) => (
            <article key={formulario.id} className="cartao cartao-hover p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-editorial text-lg">{formulario.nome}</h3>
                  <p className="text-xs text-osso-mudo mt-0.5">criado em {formatarData(formulario.criado_em)}</p>
                  {formulario.origem && (
                    <p className="text-xs text-bronze-claro mt-1">{formulario.origem}</p>
                  )}
                </div>
                <Badge tom={formulario.ativo ? 'ok' : 'neutro'}>{formulario.ativo ? 'ativo' : 'pausado'}</Badge>
              </div>

              <p className="font-editorial text-3xl text-bronze-claro">
                {formulario.total_leads}
                <span className="text-sm text-osso-mudo font-corpo ml-2">leads</span>
              </p>

              <div className="flex flex-wrap gap-2 pt-1">
                <Link to={`/painel/formularios/${formulario.id}/implementar`}>
                  <Botao>Implementar</Botao>
                </Link>
                <Botao variante="fantasma" onClick={() => abrirEdicao(formulario.id)}>Editar</Botao>
                <Botao variante="perigo" onClick={() => excluir(formulario)}>Excluir</Botao>
              </div>
            </article>
          ))}
        </div>
      )}

      {editor && (
        <EditorFormulario
          inicial={editor}
          aoFechar={() => setEditor(null)}
          aoSalvar={() => {
            setEditor(null);
            carregar();
          }}
        />
      )}
    </div>
  );
}

function EditorFormulario({ inicial, aoFechar, aoSalvar }) {
  const [dados, setDados] = useState(inicial);
  const [carregando, setCarregando] = useState(false);
  const [crmCampos, setCrmCampos] = useState(undefined); // undefined=carregando, null=sem CRM, objeto=carregado
  const [novoFixo, setNovoFixo] = useState({ campo: '', valor: '' });
  const [novoUtm, setNovoUtm] = useState({ utm_param: '', campo: '' });
  const [novoFixoLeadPass, setNovoFixoLeadPass] = useState({ tipo: 'contact', campo: '', origem: 'fixo', valor: '', campo_origem: '' });
  const [tagsLeadPass, setTagsLeadPass] = useState(null); // null=sem LP configurado, []+=carregado
  const [camposLeadPass, setCamposLeadPass] = useState(null); // null=carregando, []+=carregado

  useEffect(() => {
    api('/api/empresa/crm/campos')
      .then((res) => {
        console.log('[CRM campos]', res);
        setCrmCampos(res.campos);
      })
      .catch((err) => {
        console.error('[CRM campos erro]', err);
        setCrmCampos(null);
      });

    api('/api/empresa/crm/leadpass/tags')
      .then((res) => {
        const tags = res.tags || [];
        setTagsLeadPass(tags);
        // Reconcilia leadpass_tags: converte IDs antigos para nomes e remove itens inválidos
        if (tags.length > 0) {
          setDados((d) => {
            const atuais = d.leadpass_tags || [];
            const reconciliadas = atuais
              .map((item) => {
                if (tags.some((t) => t.nome === item)) return item; // já é nome
                const porId = tags.find((t) => t.id === item);
                return porId ? porId.nome : null; // converte ID antigo → nome
              })
              .filter(Boolean);
            return { ...d, leadpass_tags: reconciliadas };
          });
        }
      })
      .catch(() => setTagsLeadPass([]));

    api('/api/empresa/crm/leadpass/campos-formulario')
      .then((res) => setCamposLeadPass(res.grupos || []))
      .catch(() => setCamposLeadPass([]));
  }, []);

  // Opções separadas por entidade para os dois selects por campo
  const opcoesMapeamentoPessoa = crmCampos
    ? [{ valor: '', texto: '— não mapear —' }, ...(crmCampos.pessoa || []).map((c) => ({ valor: c.chave, texto: c.nome }))]
    : null;
  const opcoesMapeamentoDeal = crmCampos
    ? [{ valor: '', texto: '— não mapear —' }, ...(crmCampos.deal || []).map((c) => ({ valor: c.chave, texto: c.nome }))]
    : null;

  // Todos os campos do CRM (para "Valores fixos" e "Mapeamento de UTMs")
  const todosCamposCrm = crmCampos
    ? [
        ...(crmCampos.pessoa || []).map((c) => ({ ...c, prefixo: '[Pessoa]' })),
        ...(crmCampos.deal || []).map((c) => ({ ...c, prefixo: '[Deal]' })),
      ]
    : [];

  const campoFixoSelecionado = novoFixo.campo
    ? todosCamposCrm.find((c) => c.chave === novoFixo.campo)
    : null;

  const isMultiselect = campoFixoSelecionado?.tipo === 'multiselect';

  function toggleTagFixa(id) {
    setNovoFixo((n) => {
      const atual = Array.isArray(n.valor) ? n.valor : [];
      return { ...n, valor: atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id] };
    });
  }

  function adicionarFixo() {
    const valorVazio = Array.isArray(novoFixo.valor) ? novoFixo.valor.length === 0 : !novoFixo.valor;
    if (!novoFixo.campo || valorVazio) return;
    const campoObj = todosCamposCrm.find((c) => c.chave === novoFixo.campo);
    const rotulo = Array.isArray(novoFixo.valor)
      ? novoFixo.valor.map((id) => campoObj?.opcoes?.find((o) => o.id === id)?.rotulo || id).join(', ')
      : (campoObj?.opcoes?.find((o) => o.id === novoFixo.valor)?.rotulo || novoFixo.valor);
    setDados((d) => ({
      ...d,
      mapeamentos_fixos_crm: [
        ...d.mapeamentos_fixos_crm.filter((m) => m.campo !== novoFixo.campo),
        { campo: novoFixo.campo, valor: novoFixo.valor, rotulo },
      ],
    }));
    setNovoFixo({ campo: '', valor: '' });
  }

  function removerFixo(campo) {
    setDados((d) => ({ ...d, mapeamentos_fixos_crm: d.mapeamentos_fixos_crm.filter((m) => m.campo !== campo) }));
  }

  function adicionarUtm() {
    if (!novoUtm.utm_param || !novoUtm.campo) return;
    setDados((d) => ({
      ...d,
      mapeamentos_utm_crm: [
        ...(d.mapeamentos_utm_crm || []).filter((m) => m.utm_param !== novoUtm.utm_param),
        { utm_param: novoUtm.utm_param, campo: novoUtm.campo },
      ],
    }));
    setNovoUtm({ utm_param: '', campo: '' });
  }

  function removerUtm(utm_param) {
    setDados((d) => ({ ...d, mapeamentos_utm_crm: (d.mapeamentos_utm_crm || []).filter((m) => m.utm_param !== utm_param) }));
  }

  function adicionarFixoLeadPass() {
    if (!novoFixoLeadPass.campo) return;
    if (novoFixoLeadPass.origem === 'pergunta') {
      if (!novoFixoLeadPass.campo_origem) return;
    } else {
      const valorVazio = Array.isArray(novoFixoLeadPass.valor) ? novoFixoLeadPass.valor.length === 0 : !novoFixoLeadPass.valor;
      if (valorVazio) return;
    }
    setDados((d) => ({
      ...d,
      leadpass_campos_fixos: [
        ...(d.leadpass_campos_fixos || []).filter((cf) => !(cf.tipo === novoFixoLeadPass.tipo && cf.campo === novoFixoLeadPass.campo)),
        { ...novoFixoLeadPass },
      ],
    }));
    setNovoFixoLeadPass({ tipo: 'contact', campo: '', origem: 'fixo', valor: '', campo_origem: '' });
  }

  function removerFixoLeadPass(tipo, campo) {
    setDados((d) => ({
      ...d,
      leadpass_campos_fixos: (d.leadpass_campos_fixos || []).filter((cf) => !(cf.tipo === tipo && cf.campo === campo)),
    }));
  }

  const mudarCampo = (indice, chave, valor) =>
    setDados((atual) => ({
      ...atual,
      campos: atual.campos.map((campo, i) => (i === indice ? { ...campo, [chave]: valor } : campo)),
    }));

  const moverCampo = (indice, direcao) =>
    setDados((atual) => {
      const campos = [...atual.campos];
      const destino = indice + direcao;
      if (destino < 0 || destino >= campos.length) return atual;
      [campos[indice], campos[destino]] = [campos[destino], campos[indice]];
      return { ...atual, campos };
    });

  async function salvar(evento) {
    evento.preventDefault();
    setCarregando(true);
    try {
      const corpo = {
        nome: dados.nome,
        ...(dados.mensagem_sucesso && { mensagem_sucesso: dados.mensagem_sucesso }),
        ...(dados.redirect_url && { redirect_url: dados.redirect_url }),
        ativo: dados.ativo,
        origem: dados.origem || null,
        tags: dados.tags ? dados.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
        mapeamentos_fixos_crm: dados.mapeamentos_fixos_crm || [],
        mapeamentos_utm_crm: dados.mapeamentos_utm_crm || [],
        leadpass_tags: dados.leadpass_tags || [],
        leadpass_campos_fixos: dados.leadpass_campos_fixos || [],
        campos: dados.campos.map((campo) => {
          const mapeamentoCrm = [campo.mapeamento_pessoa, campo.mapeamento_deal].filter(Boolean);
          return {
            nome_campo: campo.nome_campo,
            rotulo: campo.rotulo,
            tipo: campo.tipo,
            papel: campo.papel,
            obrigatorio: campo.obrigatorio,
            ...(campo.placeholder && { placeholder: campo.placeholder }),
            ...(campo.tipo === 'select' && campo.opcoes && {
              opcoes: campo.opcoes.split(',').map((opcao) => opcao.trim()).filter(Boolean),
            }),
            ...(mapeamentoCrm.length > 0 && { mapeamento_crm: mapeamentoCrm }),
          };
        }),
      };
      if (dados.id) {
        await api(`/api/empresa/formularios/${dados.id}`, { metodo: 'PUT', corpo });
        avisar('Formulário atualizado.');
      } else {
        await api('/api/empresa/formularios', { metodo: 'POST', corpo });
        avisar('Formulário criado — agora é só implementar.');
      }
      aoSalvar();
    } catch (erro) {
      avisar(erro.message, 'erro');
    } finally {
      setCarregando(false);
    }
  }

  return (
    <Modal aberto titulo={dados.id ? 'Editar formulário' : 'Novo formulário'} aoFechar={aoFechar} largura="max-w-3xl">
      <form onSubmit={salvar} className="space-y-5">
        <div className="grid md:grid-cols-2 gap-4">
          <Campo rotulo="Nome interno" value={dados.nome} onChange={(e) => setDados({ ...dados, nome: e.target.value })} required minLength={2} />
          <Campo
            rotulo="Mensagem de sucesso" value={dados.mensagem_sucesso}
            onChange={(e) => setDados({ ...dados, mensagem_sucesso: e.target.value })}
            placeholder="Recebemos seus dados. Obrigado!"
          />
        </div>

        <div className="grid md:grid-cols-[1fr_auto] gap-4 items-end">
          <Campo
            rotulo="Redirecionar após envio (opcional)" type="url" value={dados.redirect_url}
            onChange={(e) => setDados({ ...dados, redirect_url: e.target.value })}
            placeholder="https://seusite.com.br/obrigado"
          />
          <Alternador rotulo="Formulário ativo" ativo={dados.ativo} aoMudar={(valor) => setDados({ ...dados, ativo: valor })} />
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="etiqueta">Campos</p>
            <Botao type="button" variante="fantasma" onClick={() => setDados({ ...dados, campos: [...dados.campos, { ...CAMPO_NOVO }] })}>
              + campo
            </Botao>
          </div>

          {dados.campos.map((campo, indice) => (
            <div key={indice} className="cartao p-4 space-y-3">
              <div className="grid md:grid-cols-[1fr_1fr_140px_180px] gap-3">
                <Campo
                  rotulo="Nome técnico" value={campo.nome_campo} required pattern="[a-zA-Z][a-zA-Z0-9_]*"
                  onChange={(e) => mudarCampo(indice, 'nome_campo', e.target.value)} placeholder="whatsapp"
                />
                <Campo
                  rotulo="Rótulo visível" value={campo.rotulo} required
                  onChange={(e) => mudarCampo(indice, 'rotulo', e.target.value)} placeholder="Seu WhatsApp"
                />
                <Selecao rotulo="Tipo" value={campo.tipo} opcoes={TIPOS} onChange={(e) => mudarCampo(indice, 'tipo', e.target.value)} />
                <Selecao rotulo="Papel" value={campo.papel} opcoes={PAPEIS} onChange={(e) => mudarCampo(indice, 'papel', e.target.value)} />
              </div>
              <div className="grid md:grid-cols-[1fr_1fr_auto] gap-3 items-end">
                <Campo
                  rotulo="Placeholder" value={campo.placeholder}
                  onChange={(e) => mudarCampo(indice, 'placeholder', e.target.value)}
                />
                {campo.tipo === 'select' ? (
                  <Campo
                    rotulo="Opções (separadas por vírgula)" value={campo.opcoes}
                    onChange={(e) => mudarCampo(indice, 'opcoes', e.target.value)} placeholder="Opção A, Opção B"
                  />
                ) : (
                  <div />
                )}
                <div className="flex items-center gap-4 pb-1">
                  <Alternador rotulo="Obrigatório" ativo={campo.obrigatorio} aoMudar={(valor) => mudarCampo(indice, 'obrigatorio', valor)} />
                  <button type="button" onClick={() => moverCampo(indice, -1)} className="text-osso-mudo hover:text-osso">↑</button>
                  <button type="button" onClick={() => moverCampo(indice, 1)} className="text-osso-mudo hover:text-osso">↓</button>
                  <button
                    type="button"
                    onClick={() => setDados({ ...dados, campos: dados.campos.filter((_, i) => i !== indice) })}
                    className="text-estado-erro/70 hover:text-estado-erro"
                  >
                    remover
                  </button>
                </div>
              </div>

              {/* Dois selects: Pessoa e Deal — só quando CRM configurado e campo não é oculto */}
              {opcoesMapeamentoPessoa && campo.tipo !== 'oculto' && (
                <div className="border-t border-linha/40 pt-3 grid md:grid-cols-2 gap-3">
                  <Selecao
                    rotulo="Mapear para Pessoa"
                    value={campo.mapeamento_pessoa}
                    opcoes={opcoesMapeamentoPessoa}
                    onChange={(e) => mudarCampo(indice, 'mapeamento_pessoa', e.target.value)}
                  />
                  <Selecao
                    rotulo="Mapear para Deal / Oportunidade"
                    value={campo.mapeamento_deal}
                    opcoes={opcoesMapeamentoDeal}
                    onChange={(e) => mudarCampo(indice, 'mapeamento_deal', e.target.value)}
                  />
                </div>
              )}
            </div>
          ))}

          {crmCampos === null && (
            <p className="text-xs text-osso-mudo">
              Configure um CRM em <Link to="/painel/crm" className="text-bronze hover:text-bronze-claro">Integrações → CRM</Link> para mapear campos diretamente.
            </p>
          )}
        </div>

        {/* Valores fixos no CRM — qualquer campo aplicado a todos os leads deste formulário */}
        {todosCamposCrm.length > 0 && (
          <div className="space-y-3">
            <div>
              <p className="etiqueta mb-0.5">Valores fixos no CRM</p>
              <p className="text-xs text-osso-mudo">
                Campos do CRM preenchidos automaticamente em todos os leads deste formulário — ex.: Origem = Facebook Ads, Responsável, etapa inicial.
              </p>
            </div>

            {dados.mapeamentos_fixos_crm.length > 0 && (
              <div className="space-y-2">
                {dados.mapeamentos_fixos_crm.map((fixo) => {
                  const campoObj = todosCamposCrm.find((c) => c.chave === fixo.campo);
                  return (
                    <div key={fixo.campo} className="cartao p-3 flex items-center justify-between gap-3">
                      <div>
                        <span className="text-xs text-osso-mudo">{campoObj?.prefixo} {campoObj?.nome || fixo.campo}</span>
                        <span className="mx-2 text-osso-mudo/40">→</span>
                        <span className="text-sm font-medium">{fixo.rotulo || fixo.valor}</span>
                      </div>
                      <button type="button" onClick={() => removerFixo(fixo.campo)} className="text-estado-erro/70 hover:text-estado-erro text-xs">remover</button>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="cartao p-4 grid md:grid-cols-[1fr_1fr_auto] gap-3 items-end">
              <Selecao
                rotulo="Campo do CRM"
                value={novoFixo.campo}
                opcoes={[
                  { valor: '', texto: '— selecione o campo —' },
                  ...todosCamposCrm.map((c) => ({ valor: c.chave, texto: `${c.prefixo} ${c.nome}` })),
                ]}
                onChange={(e) => {
                  const novoC = todosCamposCrm.find((c) => c.chave === e.target.value);
                  setNovoFixo({ campo: e.target.value, valor: novoC?.tipo === 'multiselect' ? [] : '' });
                }}
              />
              {isMultiselect ? (
                <div>
                  <p className="etiqueta mb-1.5">Tags</p>
                  <div className="cartao p-3 space-y-1.5 max-h-40 overflow-y-auto">
                    {campoFixoSelecionado.opcoes.map((o) => {
                      const selecionado = Array.isArray(novoFixo.valor) && novoFixo.valor.includes(o.id);
                      return (
                        <label key={o.id} className="flex items-center gap-2 cursor-pointer text-sm">
                          <input
                            type="checkbox"
                            checked={selecionado}
                            onChange={() => toggleTagFixa(o.id)}
                            className="accent-bronze"
                          />
                          {o.rotulo}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : campoFixoSelecionado?.opcoes?.length ? (
                <Selecao
                  rotulo="Valor"
                  value={novoFixo.valor}
                  opcoes={[
                    { valor: '', texto: '— selecione o valor —' },
                    ...campoFixoSelecionado.opcoes.map((o) => ({ valor: o.id, texto: o.rotulo })),
                  ]}
                  onChange={(e) => setNovoFixo((n) => ({ ...n, valor: e.target.value }))}
                  disabled={!novoFixo.campo}
                />
              ) : (
                <Campo
                  rotulo="Valor"
                  value={novoFixo.valor}
                  onChange={(e) => setNovoFixo((n) => ({ ...n, valor: e.target.value }))}
                  placeholder={novoFixo.campo ? 'Digite o valor' : '— escolha o campo primeiro —'}
                  disabled={!novoFixo.campo}
                />
              )}
              <Botao type="button" variante="sutil" onClick={adicionarFixo} disabled={!novoFixo.campo || (Array.isArray(novoFixo.valor) ? novoFixo.valor.length === 0 : !novoFixo.valor)}>
                + Adicionar
              </Botao>
            </div>
          </div>
        )}

        {/* Mapeamento de UTMs → campos do CRM */}
        {todosCamposCrm.length > 0 && (
          <div className="space-y-3">
            <div>
              <p className="etiqueta mb-0.5">Mapeamento de UTMs → CRM</p>
              <p className="text-xs text-osso-mudo">
                Salva os parâmetros UTM da URL de captura diretamente em campos do CRM — ex.: utm_source → custom field "Fonte do Lead".
              </p>
            </div>

            {(dados.mapeamentos_utm_crm || []).length > 0 && (
              <div className="space-y-2">
                {(dados.mapeamentos_utm_crm || []).map((utm) => {
                  const campoObj = todosCamposCrm.find((c) => c.chave === utm.campo);
                  return (
                    <div key={utm.utm_param} className="cartao p-3 flex items-center justify-between gap-3">
                      <div>
                        <span className="text-xs font-mono text-bronze-claro">{utm.utm_param}</span>
                        <span className="mx-2 text-osso-mudo/40">→</span>
                        <span className="text-xs text-osso-mudo">{campoObj?.prefixo} </span>
                        <span className="text-sm font-medium">{campoObj?.nome || utm.campo}</span>
                      </div>
                      <button type="button" onClick={() => removerUtm(utm.utm_param)} className="text-estado-erro/70 hover:text-estado-erro text-xs">remover</button>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="cartao p-4 grid md:grid-cols-[1fr_1fr_auto] gap-3 items-end">
              <Selecao
                rotulo="Parâmetro UTM"
                value={novoUtm.utm_param}
                opcoes={[{ valor: '', texto: '— selecione o parâmetro —' }, ...UTM_PARAMS]}
                onChange={(e) => setNovoUtm({ utm_param: e.target.value, campo: '' })}
              />
              <Selecao
                rotulo="Campo do CRM"
                value={novoUtm.campo}
                opcoes={[
                  { valor: '', texto: novoUtm.utm_param ? '— selecione o campo —' : '— escolha o UTM primeiro —' },
                  ...todosCamposCrm.map((c) => ({ valor: c.chave, texto: `${c.prefixo} ${c.nome}` })),
                ]}
                onChange={(e) => setNovoUtm((n) => ({ ...n, campo: e.target.value }))}
                disabled={!novoUtm.utm_param}
              />
              <Botao type="button" variante="sutil" onClick={adicionarUtm} disabled={!novoUtm.utm_param || !novoUtm.campo}>
                + Adicionar
              </Botao>
            </div>
          </div>
        )}

        {/* Mapeamento LeadPass — campos fixos e tags por formulário */}
        {tagsLeadPass !== null && (
          <div className="space-y-4">
            <div>
              <p className="etiqueta mb-0.5">LeadPass — mapeamento por formulário</p>
              <p className="text-xs text-osso-mudo">
                Campos e tags aplicados automaticamente em todos os leads deste formulário ao serem enviados ao LeadPass (backup universal).
                Cada campo pode receber um valor fixo ou a resposta de uma pergunta do formulário.
              </p>
            </div>

            {/* Campos fixos: lista de mapeamentos já adicionados + formulário para adicionar um novo */}
            {(() => {
              const todosOsCampos = (camposLeadPass || []).flatMap((g) => g.campos);
              const camposPersonalizados = dados.campos.filter((c) => c.papel === 'personalizado' && c.nome_campo);

              const campoSelecionado = todosOsCampos.find(
                (c) => c.tipo === novoFixoLeadPass.tipo && c.campo === novoFixoLeadPass.campo
              );
              const tipoCampo = campoSelecionado?.tipo_campo || 'text';
              const valorAtual = novoFixoLeadPass.valor || '';
              const valoresCheckbox = Array.isArray(valorAtual) ? valorAtual : [];

              function atualizarValor(novoValor) {
                setNovoFixoLeadPass((n) => ({ ...n, valor: novoValor }));
              }

              return (
                <div className="space-y-3">
                  {/* Mapeamentos já adicionados */}
                  {(dados.leadpass_campos_fixos || []).length > 0 && (
                    <div className="space-y-2">
                      {dados.leadpass_campos_fixos.map((cf) => {
                        const campoObj = todosOsCampos.find((c) => c.tipo === cf.tipo && c.campo === cf.campo);
                        const perguntaObj = cf.origem === 'pergunta'
                          ? dados.campos.find((c) => c.nome_campo === cf.campo_origem)
                          : null;
                        return (
                          <div key={`${cf.tipo}::${cf.campo}`} className="cartao p-3 flex items-center gap-2">
                            <span className="text-xs text-osso-mudo">{campoObj?.nome || cf.campo}</span>
                            <span className="text-xs text-osso-mudo/40">→</span>
                            {cf.origem === 'pergunta' ? (
                              <span className="text-xs font-medium text-bronze-claro">
                                resposta de "{perguntaObj?.rotulo || cf.campo_origem}"
                              </span>
                            ) : (
                              <span className="text-xs font-medium text-bronze-claro">
                                {Array.isArray(cf.valor) ? cf.valor.join(', ') : cf.valor}
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => removerFixoLeadPass(cf.tipo, cf.campo)}
                              className="text-estado-erro/70 hover:text-estado-erro text-xs ml-auto"
                            >
                              remover
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Formulário para adicionar um novo campo fixo */}
                  <div className="cartao p-4 space-y-3">
                    <p className="etiqueta mb-0">Adicionar campo no LeadPass</p>
                    <div className="grid md:grid-cols-[1fr_1fr] gap-3">
                      {/* Select do campo */}
                      <label className="block space-y-1.5">
                        <span className="etiqueta">Campo</span>
                        <select
                          className="campo appearance-none cursor-pointer"
                          value={`${novoFixoLeadPass.tipo}::${novoFixoLeadPass.campo}`}
                          onChange={(e) => {
                            const [tipo, campo] = e.target.value.split('::');
                            setNovoFixoLeadPass((n) => ({ ...n, tipo, campo, valor: '' }));
                          }}
                        >
                          <option value="contact::" className="bg-grafite-900">— selecione o campo —</option>
                          {camposLeadPass === null ? (
                            <option disabled className="bg-grafite-900">Carregando campos...</option>
                          ) : camposLeadPass.length === 0 ? (
                            <option disabled className="bg-grafite-900">Nenhum campo disponível</option>
                          ) : (
                            camposLeadPass.map((grupo) => (
                              <optgroup key={grupo.rotulo} label={grupo.rotulo} className="bg-grafite-900">
                                {grupo.campos.map((c) => (
                                  <option key={`${c.tipo}::${c.campo}`} value={`${c.tipo}::${c.campo}`} className="bg-grafite-900">
                                    {c.nome}
                                  </option>
                                ))}
                              </optgroup>
                            ))
                          )}
                        </select>
                      </label>

                      {/* Origem do valor: fixo ou resposta de pergunta */}
                      <label className="block space-y-1.5">
                        <span className="etiqueta">Origem do valor</span>
                        <select
                          className="campo appearance-none cursor-pointer"
                          value={novoFixoLeadPass.origem}
                          onChange={(e) => setNovoFixoLeadPass((n) => ({ ...n, origem: e.target.value, valor: '', campo_origem: '' }))}
                        >
                          <option value="fixo" className="bg-grafite-900">Valor fixo</option>
                          <option value="pergunta" className="bg-grafite-900">Resposta de uma pergunta</option>
                        </select>
                      </label>
                    </div>

                    {!novoFixoLeadPass.campo ? null : novoFixoLeadPass.origem === 'pergunta' ? (
                      <Selecao
                        rotulo="Pergunta do formulário"
                        value={novoFixoLeadPass.campo_origem}
                        opcoes={[
                          { valor: '', texto: '— selecione a pergunta —' },
                          ...camposPersonalizados.map((c) => ({ valor: c.nome_campo, texto: c.rotulo || c.nome_campo })),
                        ]}
                        onChange={(e) => setNovoFixoLeadPass((n) => ({ ...n, campo_origem: e.target.value }))}
                      />
                    ) : tipoCampo === 'select' ? (
                      <Selecao
                        rotulo="Valor"
                        value={typeof valorAtual === 'string' ? valorAtual : ''}
                        opcoes={[
                          { valor: '', texto: '— selecione —' },
                          ...(campoSelecionado?.opcoes || []).map((o) => ({ valor: o.valor, texto: o.rotulo })),
                        ]}
                        onChange={(e) => atualizarValor(e.target.value)}
                      />
                    ) : tipoCampo === 'checkbox' ? (
                      <div>
                        <p className="etiqueta mb-1.5">Opções (multi-seleção)</p>
                        <div className="cartao p-3 grid grid-cols-2 gap-2 max-h-40 overflow-y-auto">
                          {(campoSelecionado?.opcoes || []).map((o) => {
                            const marcado = valoresCheckbox.includes(o.valor);
                            return (
                              <label key={o.valor} className="flex items-center gap-2 cursor-pointer text-sm">
                                <input
                                  type="checkbox"
                                  checked={marcado}
                                  onChange={() => atualizarValor(
                                    marcado ? valoresCheckbox.filter((v) => v !== o.valor) : [...valoresCheckbox, o.valor]
                                  )}
                                  className="accent-bronze"
                                />
                                <span>{o.rotulo}</span>
                              </label>
                            );
                          })}
                        </div>
                        {valoresCheckbox.length > 0 && (
                          <p className="text-xs text-osso-mudo mt-1">{valoresCheckbox.length} opção(ões) selecionada(s)</p>
                        )}
                      </div>
                    ) : (
                      <Campo
                        rotulo="Valor"
                        value={typeof valorAtual === 'string' ? valorAtual : ''}
                        onChange={(e) => atualizarValor(e.target.value)}
                        placeholder="Digite o valor"
                      />
                    )}

                    <div className="flex justify-end">
                      <Botao type="button" variante="sutil" onClick={adicionarFixoLeadPass}>
                        + Adicionar campo
                      </Botao>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Tags */}
            {tagsLeadPass.length > 0 ? (
              <div>
                <p className="etiqueta mb-1.5">Tags LeadPass</p>
                <div className="cartao p-4 grid grid-cols-2 md:grid-cols-3 gap-2 max-h-52 overflow-y-auto">
                  {tagsLeadPass.map((tag) => {
                    const selecionado = (dados.leadpass_tags || []).includes(tag.nome);
                    return (
                      <label key={tag.nome} className="flex items-center gap-2 cursor-pointer text-sm">
                        <input
                          type="checkbox"
                          checked={selecionado}
                          onChange={() =>
                            setDados((d) => {
                              const atuais = d.leadpass_tags || [];
                              return {
                                ...d,
                                leadpass_tags: selecionado
                                  ? atuais.filter((n) => n !== tag.nome)
                                  : [...atuais, tag.nome],
                              };
                            })
                          }
                          className="accent-bronze"
                        />
                        <span>{tag.nome}</span>
                      </label>
                    );
                  })}
                </div>
                {(dados.leadpass_tags || []).length > 0 && (
                  <p className="text-xs text-osso-mudo mt-1.5">
                    {(dados.leadpass_tags || []).length} tag(s) selecionada(s)
                  </p>
                )}
              </div>
            ) : (
              <p className="text-xs text-osso-mudo">
                Nenhuma tag encontrada no LeadPass — cadastre tags na sua conta GHL para que apareçam aqui.
              </p>
            )}
          </div>
        )}

        <div className="flex justify-end gap-3">
          <Botao variante="sutil" type="button" onClick={aoFechar}>Cancelar</Botao>
          <Botao type="submit" carregando={carregando}>{dados.id ? 'Salvar alterações' : 'Criar formulário'}</Botao>
        </div>
      </form>
    </Modal>
  );
}
