import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { Badge, Botao, CabecalhoPagina, Campo, Carregando, Selecao, avisar, formatarData } from '../../componentes/ui.jsx';
import { useRevelar } from '../../lib/animacoes.js';

const CRMS_PRIMARIOS = [
  {
    tipo: 'pipedrive',
    nome: 'Pipedrive',
    descricao: 'Pessoa + negócio (ou lead) criados com nota de rastreamento UTM.',
  },
  {
    tipo: 'piperun',
    nome: 'PipeRun',
    descricao: 'Pessoa + oportunidade na etapa do funil que você escolher.',
  },
];

export default function Crm() {
  const [configuracao, setConfiguracao] = useState(undefined);
  const [configLeadPass, setConfigLeadPass] = useState(undefined);
  const [tipoSelecionado, setTipoSelecionado] = useState(null);
  const [teste, setTeste] = useState(null);
  const [testeLeadPass, setTesteLeadPass] = useState(null);
  const [mostrarFormLeadPass, setMostrarFormLeadPass] = useState(false);
  const ref = useRevelar([configuracao !== undefined, configLeadPass !== undefined, tipoSelecionado]);

  async function carregar() {
    const [dadosCrm, dadosLeadPass] = await Promise.all([
      api('/api/empresa/crm/configuracao'),
      api('/api/empresa/crm/leadpass'),
    ]);
    setConfiguracao(dadosCrm.configuracao);
    setTipoSelecionado(dadosCrm.configuracao?.tipo_crm ?? null);
    setConfigLeadPass(dadosLeadPass.configuracao);
  }

  useEffect(() => {
    carregar().catch((erro) => avisar(erro.message, 'erro'));
  }, []);

  async function testarConexao() {
    setTeste({ executando: true });
    try {
      const { teste: resultado } = await api('/api/empresa/crm/configuracao/testar', { metodo: 'POST' });
      setTeste(resultado);
      avisar(resultado.detalhe, resultado.ok ? 'ok' : 'erro');
      carregar();
    } catch (erro) {
      setTeste({ ok: false, detalhe: erro.message });
      avisar(erro.message, 'erro');
    }
  }

  async function testarLeadPass() {
    setTesteLeadPass({ executando: true });
    try {
      const { teste: resultado } = await api('/api/empresa/crm/leadpass/testar', { metodo: 'POST' });
      setTesteLeadPass(resultado);
      avisar(resultado.detalhe, resultado.ok ? 'ok' : 'erro');
      carregar();
    } catch (erro) {
      setTesteLeadPass({ ok: false, detalhe: erro.message });
      avisar(erro.message, 'erro');
    }
  }

  async function removerLeadPass() {
    try {
      await api('/api/empresa/crm/leadpass', { metodo: 'DELETE' });
      avisar('LeadPass removido.');
      setConfigLeadPass(null);
      setMostrarFormLeadPass(false);
    } catch (erro) {
      avisar(erro.message, 'erro');
    }
  }

  if (configuracao === undefined || configLeadPass === undefined) return <Carregando />;

  return (
    <div ref={ref}>
      <CabecalhoPagina
        etiqueta="Roteamento"
        titulo="CRM"
        descricao="Escolha para onde cada lead capturado deve ser enviado. As credenciais ficam criptografadas."
      />

      {/* Status CRM primário */}
      {configuracao && (
        <div className="cartao p-4 mb-8 flex flex-wrap items-center gap-3" data-revelar>
          <Badge tom="info">{configuracao.nome}</Badge>
          <span className="text-sm text-osso-suave">é o CRM ativo desta conta.</span>
          {configuracao.ultimo_teste_em && (
            <span className="text-xs text-osso-mudo">
              último teste {formatarData(configuracao.ultimo_teste_em)} ·{' '}
              {configuracao.ultimo_teste_ok ? 'ok' : 'falhou'}
            </span>
          )}
          <span className="ml-auto">
            <Botao variante="fantasma" onClick={testarConexao} carregando={teste?.executando}>
              Testar conexão
            </Botao>
          </span>
        </div>
      )}

      {/* Seletor CRM primário */}
      <div className="grid md:grid-cols-2 gap-3 mb-8" data-revelar>
        {CRMS_PRIMARIOS.map((crm) => (
          <button
            key={crm.tipo}
            onClick={() => setTipoSelecionado(crm.tipo)}
            className={`cartao p-5 text-left transition-all duration-200 ${
              tipoSelecionado === crm.tipo
                ? 'border-bronze/60 bg-vidro-forte'
                : 'cartao-hover'
            }`}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-editorial text-lg">{crm.nome}</h3>
              {configuracao?.tipo_crm === crm.tipo && <Badge tom="ok">ativo</Badge>}
            </div>
            <p className="text-xs text-osso-mudo mt-2 leading-relaxed">{crm.descricao}</p>
          </button>
        ))}
      </div>

      {tipoSelecionado === 'pipedrive' && <FormularioPipedrive configuracao={configuracao} aoSalvar={carregar} />}
      {tipoSelecionado === 'piperun' && <FormularioPipeRun configuracao={configuracao} aoSalvar={carregar} />}

      {/* Seção LeadPass — backup universal */}
      <div className="mt-10 pt-8 border-t border-vidro" data-revelar>
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="font-editorial text-xl">LeadPass — Backup Universal</h2>
            <p className="text-xs text-osso-mudo mt-1 max-w-lg">
              Todos os leads desta conta são também enviados ao LeadPass para acompanhamento por e-mail.
              Independente do CRM principal.
            </p>
          </div>
          {configLeadPass ? (
            <Badge tom="ok">ativo</Badge>
          ) : (
            <Badge tom="neutro">não configurado</Badge>
          )}
        </div>

        {configLeadPass && !mostrarFormLeadPass && (
          <div className="cartao p-4 flex flex-wrap items-center gap-3 mb-4">
            <span className="text-sm text-osso-suave">Location configurada.</span>
            {configLeadPass.ultimo_teste_em && (
              <span className="text-xs text-osso-mudo">
                último teste {formatarData(configLeadPass.ultimo_teste_em)} ·{' '}
                {configLeadPass.ultimo_teste_ok ? 'ok' : 'falhou'}
              </span>
            )}
            <div className="ml-auto flex gap-2">
              <Botao variante="fantasma" onClick={testarLeadPass} carregando={testeLeadPass?.executando}>
                Testar conexão
              </Botao>
              <Botao variante="fantasma" onClick={() => setMostrarFormLeadPass(true)}>
                Editar
              </Botao>
              <Botao variante="fantasma" onClick={removerLeadPass}>
                Remover
              </Botao>
            </div>
          </div>
        )}

        {(!configLeadPass || mostrarFormLeadPass) && (
          <FormularioLeadPass
            configLeadPass={configLeadPass}
            aoSalvar={() => { setMostrarFormLeadPass(false); carregar(); }}
            aoCancelar={configLeadPass ? () => setMostrarFormLeadPass(false) : null}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formulários
// ---------------------------------------------------------------------------

function usarEnvioCrmPrimario(montarCorpo, aoSalvar) {
  const [carregando, setCarregando] = useState(false);
  async function enviar(evento) {
    evento.preventDefault();
    setCarregando(true);
    try {
      await api('/api/empresa/crm/configuracao', { metodo: 'PUT', corpo: montarCorpo() });
      avisar('CRM configurado. Faça um teste de conexão.');
      aoSalvar();
    } catch (erro) {
      avisar(erro.message, 'erro');
    } finally {
      setCarregando(false);
    }
  }
  return { enviar, carregando };
}

function parsearConfigJson(valor) {
  if (!valor) return {};
  if (typeof valor === 'string') { try { return JSON.parse(valor); } catch { return {}; } }
  return valor;
}

function FormularioPipedrive({ configuracao, aoSalvar }) {
  const configAtual = configuracao?.tipo_crm === 'pipedrive' ? parsearConfigJson(configuracao.config_json) : {};
  const [dados, setDados] = useState({
    api_token: '',
    company_domain: configAtual.company_domain || '',
    pipeline_id: String(configAtual.pipeline_id || ''),
    stage_id: String(configAtual.stage_id || ''),
    owner_id: String(configAtual.owner_id || ''),
  });
  const [opcoes, setOpcoes] = useState(null);
  const [carregandoOpcoes, setCarregandoOpcoes] = useState(false);

  const set = (chave) => (e) => setDados((d) => ({ ...d, [chave]: e.target.value }));

  async function carregarDados(tokenOverride, dominioOverride, silencioso = false) {
    const token = tokenOverride ?? dados.api_token;
    const dominio = dominioOverride ?? dados.company_domain;
    if (!token || !dominio) {
      if (!silencioso) avisar('Preencha o API token e o domínio antes de carregar.', 'erro');
      return;
    }
    setCarregandoOpcoes(true);
    try {
      const resultado = await api('/api/empresa/crm/pipedrive/dados', {
        metodo: 'POST',
        corpo: { api_token: token, company_domain: dominio },
      });
      setOpcoes(resultado);
      if (!resultado.pipelines.length && !silencioso) avisar('Nenhum pipeline encontrado nessa conta.', 'erro');
    } catch (erro) {
      if (!silencioso) avisar(erro.message, 'erro');
    } finally {
      setCarregandoOpcoes(false);
    }
  }

  useEffect(() => {
    if (configuracao?.tipo_crm !== 'pipedrive') return;
    api('/api/empresa/crm/configuracao/credenciais')
      .then(({ credenciais }) => {
        if (!credenciais?.api_token) return;
        setDados((d) => ({ ...d, api_token: credenciais.api_token }));
        carregarDados(credenciais.api_token, configAtual.company_domain, true);
      })
      .catch(() => {});
  }, []);


  const stagesFiltrados = opcoes?.stages.filter(
    (s) => !dados.pipeline_id || String(s.pipeline_id) === String(dados.pipeline_id)
  ) || [];

  const { enviar, carregando } = usarEnvioCrmPrimario(
    () => ({
      tipo_crm: 'pipedrive',
      nome: 'Pipedrive',
      credenciais: { api_token: dados.api_token },
      config: {
        company_domain: dados.company_domain,
        ...(dados.pipeline_id && { pipeline_id: dados.pipeline_id }),
        ...(dados.stage_id && { stage_id: dados.stage_id }),
        ...(dados.owner_id && { owner_id: dados.owner_id }),
      },
    }),
    aoSalvar
  );

  return (
    <form onSubmit={enviar} className="cartao p-6 space-y-4 max-w-2xl" data-revelar>
      <h3 className="font-editorial text-lg">Conectar Pipedrive</h3>
      <div className="grid md:grid-cols-2 gap-4">
        <Campo
          rotulo="API token" type="password" value={dados.api_token} required
          onChange={set('api_token')}
          dica="Pipedrive → Configurações pessoais → API"
        />
        <Campo
          rotulo="Domínio da empresa" value={dados.company_domain} required pattern="[a-z0-9-]+"
          onChange={set('company_domain')}
          placeholder="minhaempresa" dica="de minhaempresa.pipedrive.com"
        />
      </div>

      <div className="flex justify-end">
        <Botao type="button" variante="fantasma" carregando={carregandoOpcoes} onClick={() => carregarDados()}>
          {opcoes ? 'Recarregar pipelines e usuários' : 'Carregar pipelines e usuários'}
        </Botao>
      </div>

      {opcoes && (
        <>
          <p className="etiqueta pt-1">Destino (opcional — sem funil, cria um Lead)</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Selecao
              rotulo="Pipeline"
              value={dados.pipeline_id}
              onChange={(e) => setDados((d) => ({ ...d, pipeline_id: e.target.value, stage_id: '' }))}
              opcoes={[
                { valor: '', texto: '— nenhum —' },
                ...opcoes.pipelines.map((p) => ({ valor: String(p.id), texto: p.nome })),
              ]}
            />
            <Selecao
              rotulo="Etapa (stage)"
              value={dados.stage_id}
              onChange={set('stage_id')}
              opcoes={[
                { valor: '', texto: dados.pipeline_id ? '— selecione —' : '— escolha um pipeline —' },
                ...stagesFiltrados.map((s) => ({ valor: String(s.id), texto: s.nome })),
              ]}
            />
            <Selecao
              rotulo="Responsável (owner)"
              value={dados.owner_id}
              onChange={set('owner_id')}
              opcoes={[
                { valor: '', texto: '— nenhum —' },
                ...opcoes.usuarios.map((u) => ({ valor: String(u.id), texto: u.nome })),
              ]}
            />
          </div>
        </>
      )}

      <div className="flex justify-end">
        <Botao type="submit" carregando={carregando}>Salvar e ativar</Botao>
      </div>
    </form>
  );
}

function FormularioPipeRun({ configuracao, aoSalvar }) {
  const configAtual = configuracao?.tipo_crm === 'piperun' ? parsearConfigJson(configuracao.config_json) : {};
  const [dados, setDados] = useState({
    token: '',
    pipeline_id: String(configAtual.pipeline_id || ''),
    stage_id: String(configAtual.stage_id || ''),
    owner_id: String(configAtual.owner_id || ''),
    campos_ocultos_str: (configAtual.campos_ocultos || []).join(', '),
  });
  const [opcoes, setOpcoes] = useState(null);
  const [carregandoOpcoes, setCarregandoOpcoes] = useState(false);

  const set = (chave) => (e) => setDados((d) => ({ ...d, [chave]: e.target.value }));

  async function carregarDados(tokenOverride, silencioso = false) {
    const token = tokenOverride ?? dados.token;
    if (!token) {
      if (!silencioso) avisar('Preencha o token antes de carregar.', 'erro');
      return;
    }
    setCarregandoOpcoes(true);
    try {
      const resultado = await api('/api/empresa/crm/piperun/dados', {
        metodo: 'POST',
        corpo: { token },
      });
      setOpcoes(resultado);
      if (!resultado.pipelines.length && !silencioso) avisar('Nenhum pipeline encontrado nessa conta.', 'erro');
    } catch (erro) {
      if (!silencioso) avisar(erro.message, 'erro');
    } finally {
      setCarregandoOpcoes(false);
    }
  }

  useEffect(() => {
    if (configuracao?.tipo_crm !== 'piperun') return;
    api('/api/empresa/crm/configuracao/credenciais')
      .then(({ credenciais }) => {
        if (!credenciais?.token) return;
        setDados((d) => ({ ...d, token: credenciais.token }));
        carregarDados(credenciais.token, true);
      })
      .catch(() => {});
  }, []);


  const stagesFiltrados = opcoes?.stages.filter(
    (s) => !dados.pipeline_id || String(s.pipeline_id) === String(dados.pipeline_id)
  ) || [];

  const camposOcultosParsed = dados.campos_ocultos_str
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const { enviar, carregando } = usarEnvioCrmPrimario(
    () => ({
      tipo_crm: 'piperun',
      nome: 'PipeRun',
      credenciais: { token: dados.token },
      config: {
        ...(dados.pipeline_id && { pipeline_id: dados.pipeline_id }),
        ...(dados.stage_id && { stage_id: dados.stage_id }),
        ...(dados.owner_id && { owner_id: dados.owner_id }),
        ...(camposOcultosParsed.length > 0 && { campos_ocultos: camposOcultosParsed }),
      },
    }),
    aoSalvar
  );

  return (
    <form onSubmit={enviar} className="cartao p-6 space-y-4 max-w-2xl" data-revelar>
      <h3 className="font-editorial text-lg">Conectar PipeRun</h3>
      <Campo
        rotulo="Token de usuário" type="password" value={dados.token} required
        onChange={set('token')}
        dica="Na plataforma: tela do usuário, abaixo da foto. Use um usuário Gestor (G1)."
      />

      <div className="flex justify-end">
        <Botao type="button" variante="fantasma" carregando={carregandoOpcoes} onClick={() => carregarDados()}>
          {opcoes ? 'Recarregar pipelines e usuários' : 'Carregar pipelines e usuários'}
        </Botao>
      </div>

      {opcoes && (
        <>
          <p className="etiqueta pt-1">Destino (stage é necessário para criar a oportunidade)</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Selecao
              rotulo="Pipeline"
              value={dados.pipeline_id}
              onChange={(e) => setDados((d) => ({ ...d, pipeline_id: e.target.value, stage_id: '' }))}
              opcoes={[
                { valor: '', texto: '— nenhum —' },
                ...opcoes.pipelines.map((p) => ({ valor: String(p.id), texto: p.nome })),
              ]}
            />
            <Selecao
              rotulo="Etapa (stage)"
              value={dados.stage_id}
              onChange={set('stage_id')}
              opcoes={[
                { valor: '', texto: dados.pipeline_id ? '— selecione —' : '— escolha um pipeline —' },
                ...stagesFiltrados.map((s) => ({ valor: String(s.id), texto: s.nome })),
              ]}
            />
            <Selecao
              rotulo="Responsável (owner)"
              value={dados.owner_id}
              onChange={set('owner_id')}
              opcoes={[
                { valor: '', texto: '— nenhum —' },
                ...opcoes.usuarios.map((u) => ({ valor: String(u.id), texto: u.nome })),
              ]}
            />
          </div>
        </>
      )}

      <details className="border border-linha rounded-lg">
        <summary className="px-4 py-2.5 text-sm text-osso-suave cursor-pointer select-none">Avançado</summary>
        <div className="px-4 pb-4 pt-2">
          <Campo
            rotulo="Campos ocultos do mapeamento"
            value={dados.campos_ocultos_str}
            onChange={set('campos_ocultos_str')}
            dica="Chaves separadas por vírgula que não devem aparecer nos formulários. Ex: deal:custom_681249"
          />
        </div>
      </details>

      <div className="flex justify-end">
        <Botao type="submit" carregando={carregando}>Salvar e ativar</Botao>
      </div>
    </form>
  );
}

function FormularioLeadPass({ configLeadPass, aoSalvar, aoCancelar }) {
  const configAtual = parsearConfigJson(configLeadPass?.config_json);
  const [dados, setDados] = useState({
    api_token: '',
    location_id: '',
    pipeline_id: configAtual.pipeline_id || '',
    stage_id: configAtual.stage_id || '',
    assigned_to: configAtual.assigned_to || '',
    cf_utm_source: configAtual.campos_utm?.utm_source || '',
    cf_utm_medium: configAtual.campos_utm?.utm_medium || '',
    cf_utm_campaign: configAtual.campos_utm?.utm_campaign || '',
    cf_utm_term: configAtual.campos_utm?.utm_term || '',
    cf_utm_content: configAtual.campos_utm?.utm_content || '',
  });
  const [opcoes, setOpcoes] = useState(null);
  const [carregandoOpcoes, setCarregandoOpcoes] = useState(false);
  const [carregando, setCarregando] = useState(false);

  const set = (chave) => (e) => setDados((d) => ({ ...d, [chave]: e.target.value }));

  async function carregarDados(tokenOverride, locationOverride, silencioso = false) {
    const token = tokenOverride ?? dados.api_token;
    const locationId = locationOverride ?? dados.location_id;
    if (!token || !locationId) {
      if (!silencioso) avisar('Preencha o token e o Location ID antes de carregar.', 'erro');
      return;
    }
    setCarregandoOpcoes(true);
    try {
      const resultado = await api('/api/empresa/crm/leadpass/dados', {
        metodo: 'POST',
        corpo: { api_token: token, location_id: locationId },
      });
      setOpcoes(resultado);
      if (!resultado.pipelines.length && !silencioso) avisar('Nenhum pipeline encontrado nessa conta.', 'erro');
    } catch (erro) {
      if (!silencioso) avisar(erro.message, 'erro');
    } finally {
      setCarregandoOpcoes(false);
    }
  }

  useEffect(() => {
    if (!configLeadPass) return;
    api('/api/empresa/crm/leadpass/credenciais')
      .then(({ credenciais }) => {
        if (!credenciais?.api_token) return;
        setDados((d) => ({ ...d, api_token: credenciais.api_token, location_id: credenciais.location_id }));
        carregarDados(credenciais.api_token, credenciais.location_id, true);
      })
      .catch(() => {});
  }, []);


  const stagesFiltrados = opcoes?.stages.filter(
    (s) => !dados.pipeline_id || s.pipeline_id === dados.pipeline_id
  ) || [];

  async function enviar(evento) {
    evento.preventDefault();
    setCarregando(true);

    const camposUtm = {};
    if (dados.cf_utm_source) camposUtm.utm_source = dados.cf_utm_source;
    if (dados.cf_utm_medium) camposUtm.utm_medium = dados.cf_utm_medium;
    if (dados.cf_utm_campaign) camposUtm.utm_campaign = dados.cf_utm_campaign;
    if (dados.cf_utm_term) camposUtm.utm_term = dados.cf_utm_term;
    if (dados.cf_utm_content) camposUtm.utm_content = dados.cf_utm_content;

    try {
      await api('/api/empresa/crm/leadpass', {
        metodo: 'PUT',
        corpo: {
          nome: 'LeadPass',
          credenciais: { api_token: dados.api_token, location_id: dados.location_id },
          config: {
            ...(dados.pipeline_id && { pipeline_id: dados.pipeline_id }),
            ...(dados.stage_id && { stage_id: dados.stage_id }),
            ...(dados.assigned_to && { assigned_to: dados.assigned_to }),
            ...(Object.keys(camposUtm).length > 0 && { campos_utm: camposUtm }),
          },
        },
      });
      avisar('LeadPass configurado. Faça um teste de conexão.');
      aoSalvar();
    } catch (erro) {
      avisar(erro.message, 'erro');
    } finally {
      setCarregando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="cartao p-6 space-y-5 max-w-4xl mx-auto">
      <h3 className="font-editorial text-lg">Conectar LeadPass</h3>

      <div className="grid md:grid-cols-2 gap-4">
        <Campo
          rotulo="API Token (Private Integration)" type="password"
          value={dados.api_token} required
          onChange={set('api_token')}
          dica="LeadPass → Settings → Private Integrations"
        />
        <Campo
          rotulo="Location ID" value={dados.location_id} required
          onChange={set('location_id')}
          placeholder="xxxxxxxxxxxxxxxxxxxxxxxx"
          dica="ID da sub-conta (location) no LeadPass"
        />
      </div>

      <div className="flex justify-end">
        <Botao type="button" variante="fantasma" carregando={carregandoOpcoes} onClick={() => carregarDados()}>
          {opcoes ? 'Recarregar pipelines e usuários' : 'Carregar pipelines e usuários'}
        </Botao>
      </div>

      {opcoes && (
        <div>
          <p className="etiqueta mb-3">Oportunidade (opcional — sem pipeline, só cria o contato)</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Selecao
              rotulo="Pipeline"
              value={dados.pipeline_id}
              onChange={(e) => setDados((d) => ({ ...d, pipeline_id: e.target.value, stage_id: '' }))}
              opcoes={[
                { valor: '', texto: '— nenhum —' },
                ...opcoes.pipelines.map((p) => ({ valor: p.id, texto: p.nome })),
              ]}
            />
            <Selecao
              rotulo="Etapa (stage)"
              value={dados.stage_id}
              onChange={set('stage_id')}
              opcoes={[
                { valor: '', texto: dados.pipeline_id ? '— selecione —' : '— escolha um pipeline —' },
                ...stagesFiltrados.map((s) => ({ valor: s.id, texto: s.nome })),
              ]}
            />
            <Selecao
              rotulo="Responsável (assignedTo)"
              value={dados.assigned_to}
              onChange={set('assigned_to')}
              opcoes={[
                { valor: '', texto: '— nenhum —' },
                ...opcoes.usuarios.map((u) => ({ valor: u.id, texto: u.nome })),
              ]}
            />
          </div>
        </div>
      )}

      <div>
        <p className="etiqueta mb-1">Campos customizados para UTMs na oportunidade</p>
        <p className="text-xs text-osso-mudo mb-3">
          {opcoes?.camposCustom?.length > 0
            ? 'Selecione qual campo do LeadPass deve receber cada parâmetro UTM. Deixe em branco para ignorar.'
            : 'Cole o ID do campo customizado do LeadPass para cada parâmetro UTM. Carregue os dados acima para ver os campos disponíveis como lista.'}
        </p>
        <div className="grid grid-cols-2 gap-3">
          {[
            { chave: 'cf_utm_source', rotulo: 'utm_source' },
            { chave: 'cf_utm_medium', rotulo: 'utm_medium' },
            { chave: 'cf_utm_campaign', rotulo: 'utm_campaign' },
            { chave: 'cf_utm_term', rotulo: 'utm_term' },
            { chave: 'cf_utm_content', rotulo: 'utm_content' },
          ].map(({ chave, rotulo }) =>
            opcoes?.camposCustom?.length > 0 ? (
              <Selecao
                key={chave}
                rotulo={rotulo}
                value={dados[chave]}
                onChange={set(chave)}
                opcoes={[
                  { valor: '', texto: '— não mapear —' },
                  ...opcoes.camposCustom.map((c) => ({ valor: c.id, texto: c.nome })),
                ]}
              />
            ) : (
              <Campo
                key={chave}
                rotulo={rotulo}
                value={dados[chave]}
                onChange={set(chave)}
                placeholder="ID do campo customizado"
              />
            )
          )}
        </div>
      </div>

      <div className="flex justify-end gap-2">
        {aoCancelar && (
          <Botao type="button" variante="fantasma" onClick={aoCancelar}>
            Cancelar
          </Botao>
        )}
        <Botao type="submit" carregando={carregando}>Salvar LeadPass</Botao>
      </div>
    </form>
  );
}
