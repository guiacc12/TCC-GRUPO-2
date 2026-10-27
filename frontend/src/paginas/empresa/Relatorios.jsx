import { useEffect, useState } from 'react';
import { api, baixarArquivo } from '../../lib/api.js';
import { Botao, CabecalhoPagina, Campo, Carregando, EstadoVazio, Selecao, avisar } from '../../componentes/ui.jsx';
import { useRevelar } from '../../lib/animacoes.js';

// O valor do tipo é o caminho da API: /api/empresa/relatorios/<tipo>[.csv]
const RELATORIOS = {
  'captacao-leads': { texto: 'Captação de leads', usaFormulario: true },
  'origem-leads': { texto: 'Origem dos leads', usaFormulario: false },
  'entregas-integracoes': { texto: 'Entregas e falhas das integrações', usaFormulario: false },
};
const OPCOES_RELATORIO = Object.entries(RELATORIOS).map(([valor, { texto }]) => ({ valor, texto }));
const NAO_INFORMADO = 'Não informado';
const LIMITE_DIAS = 366;

/** Data de hoje (AAAA-MM-DD) no fuso de São Paulo — o "en-CA" já formata em ISO. */
function hojeEmSaoPaulo() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

function somarDias(data, dias) {
  return new Date(Date.parse(`${data}T00:00:00Z`) + dias * 86400000).toISOString().slice(0, 10);
}

const dataBr = (iso) => iso.split('-').reverse().join('/');
const diaDaSemana = (iso) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' });
const percentualBr = (valor) =>
  `${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

/** Mesmas regras do servidor — validar aqui só evita uma ida à API à toa. */
function validar({ de, ate }) {
  if (!de || !ate) return 'Informe a data inicial e a data final.';
  if (de > ate) return 'A data inicial não pode ser posterior à final.';
  const dias = (Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86400000 + 1;
  if (dias > LIMITE_DIAS) return `O período máximo é de ${LIMITE_DIAS} dias.`;
  return null;
}

function consultaDe(filtros, tipo) {
  const consulta = new URLSearchParams({ de: filtros.de, ate: filtros.ate });
  if (RELATORIOS[tipo].usaFormulario && filtros.formulario_id) consulta.set('formulario_id', filtros.formulario_id);
  return consulta.toString();
}

export default function Relatorios() {
  const [tipo, setTipo] = useState('captacao-leads');
  const [formularios, setFormularios] = useState([]);
  // Período inicial: hoje + os 29 dias anteriores (30 dias no total)
  const [filtros, setFiltros] = useState(() => {
    const hoje = hojeEmSaoPaulo();
    return { de: somarDias(hoje, -29), ate: hoje, formulario_id: '' };
  });
  const [erroValidacao, setErroValidacao] = useState(null);
  // estado: 'inicial' | 'carregando' | 'pronto' | 'erro'
  const [estado, setEstado] = useState('inicial');
  const [relatorio, setRelatorio] = useState(null);
  const [erroConsulta, setErroConsulta] = useState(null);
  // Filtros (e tipo) que geraram o resultado na tela — a exportação usa estes, não os
  // campos editados depois, para o CSV corresponder ao que está sendo exibido
  const [filtrosGerados, setFiltrosGerados] = useState(null);
  const [exportando, setExportando] = useState(false);
  const ref = useRevelar([estado]);

  useEffect(() => {
    api('/api/empresa/formularios')
      .then((resposta) => setFormularios(resposta.formularios || []))
      .catch(() => {}); // sem a lista, o relatório ainda funciona com "Todos os formulários"
  }, []);

  function trocarTipo(novoTipo) {
    // Resultado de um relatório não pode aparecer sob outro tipo selecionado
    setTipo(novoTipo);
    setEstado('inicial');
    setRelatorio(null);
    setErroConsulta(null);
    setErroValidacao(null);
  }

  async function gerar(alvo = filtros) {
    const problema = validar(alvo);
    setErroValidacao(problema);
    if (problema) return;

    setEstado('carregando');
    setErroConsulta(null);
    try {
      const resposta = await api(`/api/empresa/relatorios/${tipo}?${consultaDe(alvo, tipo)}`);
      setRelatorio({ ...resposta, tipo });
      setFiltrosGerados({ ...alvo, tipo });
      setEstado('pronto');
    } catch (erro) {
      setErroConsulta({ mensagem: erro.message, filtros: alvo });
      setEstado('erro');
    }
  }

  async function exportarCsv() {
    if (!filtrosGerados) return;
    setExportando(true);
    try {
      await baixarArquivo(
        `/api/empresa/relatorios/${filtrosGerados.tipo}.csv?${consultaDe(filtrosGerados, filtrosGerados.tipo)}`,
        `${filtrosGerados.tipo}_${filtrosGerados.de}_a_${filtrosGerados.ate}.csv`
      );
    } catch (erro) {
      avisar(erro.message, 'erro');
    } finally {
      setExportando(false);
    }
  }

  const alterar = (campo) => (evento) => setFiltros((atuais) => ({ ...atuais, [campo]: evento.target.value }));

  return (
    <div ref={ref}>
      <CabecalhoPagina
        etiqueta="Análise"
        titulo="Relatórios"
        descricao="Acompanhe o volume de contatos recebidos, por período, formulário e origem."
      />

      <form
        className={`cartao p-5 mb-8 grid gap-4 sm:grid-cols-2 items-end ${
          RELATORIOS[tipo].usaFormulario
            ? 'xl:grid-cols-[1.2fr_150px_150px_1.2fr_auto]'
            : 'xl:grid-cols-[1.2fr_150px_150px_auto]'
        }`}
        onSubmit={(evento) => {
          evento.preventDefault();
          gerar();
        }}
        noValidate
        data-revelar
      >
        <Selecao rotulo="Relatório" value={tipo} onChange={(e) => trocarTipo(e.target.value)} opcoes={OPCOES_RELATORIO} />
        <Campo rotulo="Data inicial" type="date" required value={filtros.de} max={filtros.ate || undefined} onChange={alterar('de')} />
        <Campo rotulo="Data final" type="date" required value={filtros.ate} min={filtros.de || undefined} onChange={alterar('ate')} />
        {RELATORIOS[tipo].usaFormulario && (
          <Selecao
            rotulo="Formulário"
            value={filtros.formulario_id}
            onChange={alterar('formulario_id')}
            opcoes={[
              { valor: '', texto: 'Todos os formulários' },
              ...formularios.map((f) => ({ valor: String(f.id), texto: f.nome })),
            ]}
          />
        )}
        <Botao type="submit" carregando={estado === 'carregando'}>
          {estado === 'carregando' ? 'Gerando…' : 'Gerar relatório'}
        </Botao>
        {erroValidacao && (
          <p role="alert" className="col-span-full text-sm text-estado-erro">
            {erroValidacao}
          </p>
        )}
      </form>

      <section aria-live="polite" aria-busy={estado === 'carregando'}>
        {estado === 'inicial' && (
          <EstadoVazio titulo="Escolha o período" descricao="Ajuste os filtros e clique em Gerar relatório." />
        )}

        {estado === 'carregando' && (
          <div role="status">
            <Carregando />
            <p className="sr-only">Gerando relatório…</p>
          </div>
        )}

        {estado === 'erro' && (
          <div className="cartao p-10 text-center space-y-4 border-estado-erro/30" role="alert" data-revelar>
            <p className="titulo-editorial text-xl text-estado-erro">Não foi possível gerar o relatório</p>
            <p className="text-sm text-osso-mudo">{erroConsulta?.mensagem}</p>
            <Botao variante="fantasma" onClick={() => gerar(erroConsulta.filtros)}>
              Tentar novamente
            </Botao>
          </div>
        )}

        {estado === 'pronto' && relatorio?.tipo === 'captacao-leads' && (
          <ResultadoCaptacao relatorio={relatorio} aoExportar={exportarCsv} exportando={exportando} />
        )}
        {estado === 'pronto' && relatorio?.tipo === 'origem-leads' && (
          <ResultadoOrigem relatorio={relatorio} aoExportar={exportarCsv} exportando={exportando} />
        )}
        {estado === 'pronto' && relatorio?.tipo === 'entregas-integracoes' && (
          <ResultadoEntregas relatorio={relatorio} aoExportar={exportarCsv} exportando={exportando} />
        )}
      </section>
    </div>
  );
}

const COR_INDICADOR = { ok: 'text-estado-ok', erro: 'text-estado-erro' };

/** Cartão do período + total; `extras` ([{ rotulo, valor, tom }]) acrescenta indicadores ao lado. */
function ResumoPeriodo({ periodo, total, detalhe, rotuloTotal = 'Total de leads', extras = [] }) {
  const indicadores = [{ rotulo: rotuloTotal, valor: total }, ...extras];
  return (
    <div className={`grid gap-3 mb-6 ${extras.length ? 'md:grid-cols-3 xl:grid-cols-[2fr_1fr_1fr_1fr]' : 'md:grid-cols-[2fr_1fr]'}`}>
      <article className={`cartao p-6 bg-vidro-forte ${extras.length ? 'md:col-span-3 xl:col-span-1' : ''}`} data-revelar>
        <p className="etiqueta">Período consultado</p>
        <p className="titulo-editorial text-2xl mt-2">{`${dataBr(periodo.de)} a ${dataBr(periodo.ate)}`}</p>
        <p className="text-sm text-osso-mudo mt-1">{detalhe} · horário de Brasília</p>
      </article>
      {indicadores.map((indicador) => (
        <article key={indicador.rotulo} className="cartao p-6" data-revelar>
          <p className="etiqueta">{indicador.rotulo}</p>
          <p className={`titulo-editorial text-4xl mt-2 ${COR_INDICADOR[indicador.tom] ?? ''}`}>
            {indicador.valor.toLocaleString('pt-BR')}
          </p>
        </article>
      ))}
    </div>
  );
}

function SemLeads() {
  return <EstadoVazio titulo="Não há leads no período" descricao="Nenhum lead foi capturado entre as datas selecionadas." />;
}

function ResultadoCaptacao({ relatorio, aoExportar, exportando }) {
  return (
    <>
      <ResumoPeriodo
        periodo={relatorio.periodo}
        total={relatorio.total}
        detalhe={relatorio.formulario?.nome || 'Todos os formulários'}
      />

      {relatorio.total === 0 ? (
        <SemLeads />
      ) : (
        <>
          <div className="flex justify-end mb-3" data-revelar>
            <Botao variante="fantasma" onClick={aoExportar} carregando={exportando}>
              {exportando ? 'Exportando…' : 'Exportar CSV'}
            </Botao>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr] items-start">
            <TabelaContagem
              titulo="Quantidade por formulário"
              colunaRotulo="Formulário"
              linhas={relatorio.por_formulario.map((linha) => ({
                chave: linha.formulario_id ?? 'removido',
                rotulo: linha.nome,
                mudo: linha.formulario_id === null,
                total: linha.total,
              }))}
              total={relatorio.total}
            />
            <TabelaContagem
              titulo="Quantidade por dia"
              colunaRotulo="Data"
              linhas={relatorio.por_dia.map((linha) => ({
                chave: linha.data,
                rotulo: dataBr(linha.data),
                detalhe: diaDaSemana(linha.data),
                mudo: linha.total === 0,
                total: linha.total,
              }))}
              total={relatorio.total}
              rolagem
            />
          </div>
        </>
      )}
    </>
  );
}

function TabelaContagem({ titulo, colunaRotulo, linhas, total, rolagem = false }) {
  return (
    <div className="cartao overflow-hidden" data-revelar>
      <div className={rolagem ? 'max-h-[520px] overflow-y-auto' : ''} tabIndex={rolagem ? 0 : undefined} aria-label={rolagem ? titulo : undefined}>
        <table className="w-full text-sm">
          <caption className="text-left px-5 pt-4 pb-2 etiqueta">{titulo}</caption>
          <thead className="sticky top-0 bg-grafite-900/95 backdrop-blur-md">
            <tr className="border-b border-linha text-left">
              <th scope="col" className="etiqueta px-5 py-3 font-medium">{colunaRotulo}</th>
              <th scope="col" className="etiqueta px-5 py-3 font-medium text-right">Leads</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[rgba(233,229,220,0.05)]">
            {linhas.map((linha) => (
              <tr key={linha.chave}>
                <th scope="row" className={`px-5 py-2.5 text-left font-normal ${linha.mudo ? 'text-osso-mudo' : 'text-osso-suave'}`}>
                  {linha.rotulo}
                  {linha.detalhe && <span className="ml-2 text-xs text-osso-mudo">{linha.detalhe}</span>}
                </th>
                <td className={`px-5 py-2.5 text-right tabular-nums ${linha.mudo ? 'text-osso-mudo' : ''}`}>
                  {linha.total.toLocaleString('pt-BR')}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-linha">
              <th scope="row" className="px-5 py-3 text-left etiqueta font-medium">Total</th>
              <td className="px-5 py-3 text-right tabular-nums font-medium">{total.toLocaleString('pt-BR')}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function ResultadoOrigem({ relatorio, aoExportar, exportando }) {
  return (
    <>
      <ResumoPeriodo periodo={relatorio.periodo} total={relatorio.total} detalhe="Origem e campanha" />

      {relatorio.total === 0 ? (
        <SemLeads />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3" data-revelar>
            <p className="text-xs text-osso-mudo max-w-xl">
              Mede o volume de contatos por origem e campanha, não vendas nem conversões. Percentuais
              arredondados em duas casas: a soma pode diferir de 100%.
            </p>
            <Botao variante="fantasma" onClick={aoExportar} carregando={exportando}>
              {exportando ? 'Exportando…' : 'Exportar CSV'}
            </Botao>
          </div>
          <TabelaOrigem linhas={relatorio.por_origem} total={relatorio.total} />
        </>
      )}
    </>
  );
}

function TabelaOrigem({ linhas, total }) {
  const tom = (valor) => (valor === NAO_INFORMADO ? 'text-osso-mudo' : 'text-osso-suave');
  return (
    <div className="cartao overflow-hidden" data-revelar>
      <div className="max-h-[560px] overflow-y-auto" tabIndex={0} aria-label="Leads por origem e campanha">
        <table className="w-full text-sm">
          <caption className="text-left px-5 pt-4 pb-2 etiqueta">Leads por origem e campanha</caption>
          <thead className="sticky top-0 bg-grafite-900/95 backdrop-blur-md">
            <tr className="border-b border-linha text-left">
              <th scope="col" className="etiqueta px-5 py-3 font-medium">Origem</th>
              <th scope="col" className="etiqueta px-5 py-3 font-medium">Campanha</th>
              <th scope="col" className="etiqueta px-5 py-3 font-medium text-right">Leads</th>
              <th scope="col" className="etiqueta px-5 py-3 font-medium text-right">Percentual</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[rgba(233,229,220,0.05)]">
            {linhas.map((linha) => (
              <tr key={JSON.stringify([linha.origem, linha.campanha])}>
                <th scope="row" className={`px-5 py-2.5 text-left font-normal break-all ${tom(linha.origem)}`}>
                  {linha.origem}
                </th>
                <td className={`px-5 py-2.5 break-all ${tom(linha.campanha)}`}>{linha.campanha}</td>
                <td className="px-5 py-2.5 text-right tabular-nums">{linha.total.toLocaleString('pt-BR')}</td>
                <td className="px-5 py-2.5 text-right tabular-nums text-osso-suave">{percentualBr(linha.percentual)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-linha">
              <th scope="row" colSpan={2} className="px-5 py-3 text-left etiqueta font-medium">Total</th>
              <td className="px-5 py-3 text-right tabular-nums font-medium">{total.toLocaleString('pt-BR')}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function ResultadoEntregas({ relatorio, aoExportar, exportando }) {
  return (
    <>
      <ResumoPeriodo
        periodo={relatorio.periodo}
        total={relatorio.total}
        rotuloTotal="Registros de entrega"
        detalhe="CRM e WhatsApp"
        extras={[
          { rotulo: 'Sucessos', valor: relatorio.sucessos, tom: 'ok' },
          { rotulo: 'Falhas', valor: relatorio.falhas, tom: 'erro' },
        ]}
      />

      {relatorio.total === 0 ? (
        <EstadoVazio
          titulo="Não há registros de entrega no período"
          descricao="Nenhuma tentativa de entrega ao CRM ou ao WhatsApp foi registrada entre as datas selecionadas."
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3" data-revelar>
            <p className="text-xs text-osso-mudo max-w-xl">
              Cada registro de entrega conta uma vez: não são leads nem mensagens únicas, e um mesmo lead pode aparecer em
              vários grupos.
            </p>
            <Botao variante="fantasma" onClick={aoExportar} carregando={exportando}>
              {exportando ? 'Exportando…' : 'Exportar CSV'}
            </Botao>
          </div>
          <TabelaEntregas grupos={relatorio.por_grupo} relatorio={relatorio} />
        </>
      )}
    </>
  );
}

function TabelaEntregas({ grupos, relatorio }) {
  const numero = (valor) => valor.toLocaleString('pt-BR');
  return (
    <div className="cartao overflow-hidden" data-revelar>
      <div className="max-h-[560px] overflow-y-auto" tabIndex={0} aria-label="Entregas por canal e destino">
        <table className="w-full text-sm">
          <caption className="text-left px-5 pt-4 pb-2 etiqueta">Entregas por canal e destino</caption>
          <thead className="sticky top-0 bg-grafite-900/95 backdrop-blur-md">
            <tr className="border-b border-linha text-left">
              <th scope="col" className="etiqueta px-5 py-3 font-medium">Canal</th>
              <th scope="col" className="etiqueta px-5 py-3 font-medium">Destino</th>
              <th scope="col" className="etiqueta px-5 py-3 font-medium text-right">Sucessos</th>
              <th scope="col" className="etiqueta px-5 py-3 font-medium text-right">Falhas</th>
              <th scope="col" className="etiqueta px-5 py-3 font-medium text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[rgba(233,229,220,0.05)]">
            {grupos.map((grupo) => (
              <tr key={JSON.stringify([grupo.canal, grupo.destino])}>
                <th scope="row" className="px-5 py-2.5 text-left font-normal text-osso-suave">{grupo.canal_rotulo}</th>
                <td className="px-5 py-2.5 text-osso-suave break-all">{grupo.destino}</td>
                <td className={`px-5 py-2.5 text-right tabular-nums ${grupo.sucessos ? 'text-estado-ok' : 'text-osso-mudo'}`}>
                  {numero(grupo.sucessos)}
                </td>
                <td className={`px-5 py-2.5 text-right tabular-nums ${grupo.falhas ? 'text-estado-erro' : 'text-osso-mudo'}`}>
                  {numero(grupo.falhas)}
                </td>
                <td className="px-5 py-2.5 text-right tabular-nums">{numero(grupo.total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-linha">
              <th scope="row" colSpan={2} className="px-5 py-3 text-left etiqueta font-medium">Total</th>
              <td className="px-5 py-3 text-right tabular-nums font-medium">{numero(relatorio.sucessos)}</td>
              <td className="px-5 py-3 text-right tabular-nums font-medium">{numero(relatorio.falhas)}</td>
              <td className="px-5 py-3 text-right tabular-nums font-medium">{numero(relatorio.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
