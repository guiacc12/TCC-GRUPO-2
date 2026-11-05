import { useEffect, useState } from 'react';
import { api, baixarArquivo, sessao } from '../../lib/api.js';
import {
  TITULOS, dataBr, diaSemana, imprimirRelatorio, pct, textoComparacao, textoSemOrigem, textoTaxaAnterior,
} from '../../lib/imprimirRelatorio.js';
import { Botao, CabecalhoPagina, Campo, Carregando, EstadoVazio, Selecao, avisar } from '../../componentes/ui.jsx';
import { useRevelar } from '../../lib/animacoes.js';

// O valor do tipo é o caminho da API: /api/empresa/relatorios/<tipo>[.csv]. Os títulos são
// os mesmos do PDF; só a captação tem filtro de formulário.
const USA_FORMULARIO = { 'captacao-leads': true };
const OPCOES_RELATORIO = Object.entries(TITULOS).map(([valor, texto]) => ({ valor, texto }));
const NAO_INFORMADO = 'Não informado';
const ALERTA_SEM_ORIGEM = 30; // % de leads sem utm_source a partir do qual a tela destaca o indicador
const LIMITE_DIAS = 366;

/** Data de hoje (AAAA-MM-DD) no fuso de São Paulo — o "en-CA" já formata em ISO. */
function hojeEmSaoPaulo() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

function somarDias(data, dias) {
  return new Date(Date.parse(`${data}T00:00:00Z`) + dias * 86400000).toISOString().slice(0, 10);
}

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
  if (USA_FORMULARIO[tipo] && filtros.formulario_id) consulta.set('formulario_id', filtros.formulario_id);
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

  // Imprime exatamente o resultado exibido (mesmo objeto da tela), em A4 com fundo branco
  function exportarPdf() {
    try {
      imprimirRelatorio(relatorio, sessao.obter('empresa')?.usuario?.empresa);
    } catch (erro) {
      avisar(erro.message, 'erro');
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
          USA_FORMULARIO[tipo]
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
        {/* Travado durante a geração: trocar o tipo com uma consulta em andamento mostraria o
            resultado do relatório antigo sob o nome do novo */}
        <Selecao
          rotulo="Relatório"
          value={tipo}
          onChange={(e) => trocarTipo(e.target.value)}
          opcoes={OPCOES_RELATORIO}
          disabled={estado === 'carregando'}
        />
        <Campo rotulo="Data inicial" type="date" required value={filtros.de} max={filtros.ate || undefined} onChange={alterar('de')} />
        <Campo rotulo="Data final" type="date" required value={filtros.ate} min={filtros.de || undefined} onChange={alterar('ate')} />
        {USA_FORMULARIO[tipo] && (
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
          <ResultadoCaptacao relatorio={relatorio} aoExportar={exportarCsv} aoImprimir={exportarPdf} exportando={exportando} />
        )}
        {estado === 'pronto' && relatorio?.tipo === 'origem-leads' && (
          <ResultadoOrigem relatorio={relatorio} aoExportar={exportarCsv} aoImprimir={exportarPdf} exportando={exportando} />
        )}
        {estado === 'pronto' && relatorio?.tipo === 'entregas-integracoes' && (
          <ResultadoEntregas relatorio={relatorio} aoExportar={exportarCsv} aoImprimir={exportarPdf} exportando={exportando} />
        )}
      </section>
    </div>
  );
}

const COR_INDICADOR = { ok: 'text-estado-ok', erro: 'text-estado-erro', aviso: 'text-estado-aviso' };

/**
 * Cartão do período + indicadores ([{ rotulo, valor, tom, nota }]). Com um só indicador ele
 * fica ao lado do período; com vários, o período ocupa a linha toda.
 */
function ResumoPeriodo({ periodo, detalhe, indicadores }) {
  const varios = indicadores.length > 1;
  const colunas = indicadores.length > 2 ? 'grid-cols-2 md:grid-cols-3' : 'grid-cols-2';
  return (
    <div className={`grid gap-3 mb-6 ${varios ? colunas : 'md:grid-cols-[2fr_1fr]'}`}>
      <article className={`cartao p-6 bg-vidro-forte ${varios ? 'col-span-full' : ''}`} data-revelar>
        <p className="etiqueta">Período consultado</p>
        <p className="titulo-editorial text-2xl mt-2">{`${dataBr(periodo.de)} a ${dataBr(periodo.ate)}`}</p>
        <p className="text-sm text-osso-mudo mt-1">{detalhe} · horário de Brasília</p>
      </article>
      {indicadores.map((indicador) => (
        <article key={indicador.rotulo} className="cartao p-6" data-revelar>
          <p className="etiqueta">{indicador.rotulo}</p>
          <p className={`titulo-editorial text-4xl mt-2 ${COR_INDICADOR[indicador.tom] ?? ''}`}>
            {typeof indicador.valor === 'number' ? indicador.valor.toLocaleString('pt-BR') : indicador.valor}
          </p>
          {indicador.nota && <p className="text-xs text-osso-mudo mt-2">{indicador.nota}</p>}
        </article>
      ))}
    </div>
  );
}

function BotoesExportar({ aoExportar, aoImprimir, exportando }) {
  return (
    <div className="flex items-center gap-2">
      <Botao variante="fantasma" onClick={aoImprimir}>
        Exportar PDF
      </Botao>
      <Botao variante="fantasma" onClick={aoExportar} carregando={exportando}>
        {exportando ? 'Exportando…' : 'Exportar CSV'}
      </Botao>
    </div>
  );
}

function SemLeads() {
  return <EstadoVazio titulo="Não há leads no período" descricao="Nenhum lead foi capturado entre as datas selecionadas." />;
}

function ResultadoCaptacao({ relatorio, aoExportar, aoImprimir, exportando }) {
  return (
    <>
      <ResumoPeriodo
        periodo={relatorio.periodo}
        detalhe={relatorio.formulario?.nome || 'Todos os formulários'}
        indicadores={[
          { rotulo: 'Total de leads', valor: relatorio.total, nota: textoComparacao(relatorio.anterior, relatorio.variacao) },
        ]}
      />

      {relatorio.total === 0 ? (
        <SemLeads />
      ) : (
        <>
          <div className="flex justify-end mb-3" data-revelar>
            <BotoesExportar aoExportar={aoExportar} aoImprimir={aoImprimir} exportando={exportando} />
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
                detalhe: diaSemana(linha.data),
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

/** linhas: [{ chave, rotulo, detalhe?, mudo?, total, percentual? }]; a coluna de % só aparece se houver percentual. */
function TabelaContagem({ titulo, colunaRotulo, linhas, total, rolagem = false }) {
  const comPercentual = linhas.some((linha) => linha.percentual !== undefined);
  return (
    <div className="cartao overflow-hidden" data-revelar>
      <div className={rolagem ? 'max-h-[520px] overflow-y-auto' : ''} tabIndex={rolagem ? 0 : undefined} aria-label={rolagem ? titulo : undefined}>
        <table className="w-full text-sm">
          <caption className="text-left px-5 pt-4 pb-2 etiqueta">{titulo}</caption>
          <thead className="sticky top-0 bg-grafite-900/95 backdrop-blur-md">
            <tr className="border-b border-linha text-left">
              <th scope="col" className="etiqueta px-5 py-3 font-medium">{colunaRotulo}</th>
              <th scope="col" className="etiqueta px-5 py-3 font-medium text-right">Leads</th>
              {comPercentual && <th scope="col" className="etiqueta px-5 py-3 font-medium text-right">Percentual</th>}
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
                {comPercentual && (
                  <td className="px-5 py-2.5 text-right tabular-nums text-osso-suave">{pct(linha.percentual)}</td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-linha">
              <th scope="row" className="px-5 py-3 text-left etiqueta font-medium">Total</th>
              <td className="px-5 py-3 text-right tabular-nums font-medium">{total.toLocaleString('pt-BR')}</td>
              {comPercentual && <td />}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function ResultadoOrigem({ relatorio, aoExportar, aoImprimir, exportando }) {
  const semOrigem = textoSemOrigem(relatorio.sem_origem);
  // Muitos leads sem origem = rastreamento falhando: o resto da análise fica pouco confiável
  const alerta = relatorio.sem_origem.percentual !== null && relatorio.sem_origem.percentual >= ALERTA_SEM_ORIGEM;
  return (
    <>
      <ResumoPeriodo
        periodo={relatorio.periodo}
        detalhe="Origem e campanha"
        indicadores={[
          { rotulo: 'Total de leads', valor: relatorio.total, nota: textoComparacao(relatorio.anterior, relatorio.variacao) },
          {
            rotulo: 'Leads sem origem informada',
            valor: semOrigem.valor,
            tom: alerta ? 'aviso' : undefined,
            nota: alerta ? `${semOrigem.nota}. Confira se os links das campanhas têm UTM.` : semOrigem.nota,
          },
        ]}
      />

      {relatorio.total === 0 ? (
        <SemLeads />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3" data-revelar>
            <p className="text-xs text-osso-mudo max-w-xl">
              Mede o volume de contatos por origem e campanha, não vendas nem conversões. Percentuais
              arredondados em duas casas: a soma pode diferir de 100%.
            </p>
            <BotoesExportar aoExportar={aoExportar} aoImprimir={aoImprimir} exportando={exportando} />
          </div>
          <TabelaOrigem linhas={relatorio.por_origem} total={relatorio.total} />
          <div className="grid gap-6 lg:grid-cols-2 items-start mt-6">
            <TabelaContagem
              titulo="Total por origem"
              colunaRotulo="Origem"
              linhas={relatorio.por_fonte.map((linha) => ({
                chave: linha.origem,
                rotulo: linha.origem,
                mudo: linha.origem === NAO_INFORMADO,
                total: linha.total,
                percentual: linha.percentual,
              }))}
              total={relatorio.total}
            />
            <TabelaContagem
              titulo="Total por meio (utm_medium)"
              colunaRotulo="Meio"
              linhas={relatorio.por_meio.map((linha) => ({
                chave: linha.meio,
                rotulo: linha.meio,
                mudo: linha.meio === NAO_INFORMADO,
                total: linha.total,
                percentual: linha.percentual,
              }))}
              total={relatorio.total}
            />
          </div>
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
                <td className="px-5 py-2.5 text-right tabular-nums text-osso-suave">{pct(linha.percentual)}</td>
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

function ResultadoEntregas({ relatorio, aoExportar, aoImprimir, exportando }) {
  return (
    <>
      <ResumoPeriodo
        periodo={relatorio.periodo}
        detalhe="CRM e WhatsApp"
        indicadores={[
          { rotulo: 'Registros de entrega', valor: relatorio.total, nota: textoComparacao(relatorio.anterior, relatorio.variacao) },
          { rotulo: 'Sucessos', valor: relatorio.sucessos, tom: 'ok' },
          { rotulo: 'Falhas', valor: relatorio.falhas, tom: 'erro' },
          {
            rotulo: 'Taxa de sucesso',
            valor: relatorio.taxa_sucesso === null ? '—' : pct(relatorio.taxa_sucesso),
            nota: textoTaxaAnterior(relatorio.anterior),
          },
          {
            rotulo: 'Leads sem entrega concluída',
            valor: relatorio.leads_sem_entrega,
            tom: relatorio.leads_sem_entrega > 0 ? 'aviso' : undefined,
            nota: 'falha sem nenhum sucesso no mesmo canal e destino',
          },
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
            <BotoesExportar aoExportar={aoExportar} aoImprimir={aoImprimir} exportando={exportando} />
          </div>
          <TabelaEntregas grupos={relatorio.por_grupo} relatorio={relatorio} />
          {relatorio.por_motivo.length > 0 && <TabelaMotivos motivos={relatorio.por_motivo} falhas={relatorio.falhas} />}
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
              <th scope="col" className="etiqueta px-5 py-3 font-medium text-right">Taxa</th>
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
                <td className="px-5 py-2.5 text-right tabular-nums text-osso-suave">{pct(grupo.taxa_sucesso)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-linha">
              <th scope="row" colSpan={2} className="px-5 py-3 text-left etiqueta font-medium">Total</th>
              <td className="px-5 py-3 text-right tabular-nums font-medium">{numero(relatorio.sucessos)}</td>
              <td className="px-5 py-3 text-right tabular-nums font-medium">{numero(relatorio.falhas)}</td>
              <td className="px-5 py-3 text-right tabular-nums font-medium">{numero(relatorio.total)}</td>
              <td className="px-5 py-3 text-right tabular-nums font-medium">
                {relatorio.taxa_sucesso === null ? '' : pct(relatorio.taxa_sucesso)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/** Falhas por canal e código HTTP já gravado; nunca a mensagem de erro. */
function TabelaMotivos({ motivos, falhas }) {
  return (
    <div className="cartao overflow-hidden mt-6" data-revelar>
      <table className="w-full text-sm">
        <caption className="text-left px-5 pt-4 pb-2 etiqueta">Falhas por código de resposta</caption>
        <thead>
          <tr className="border-b border-linha text-left">
            <th scope="col" className="etiqueta px-5 py-3 font-medium">Canal</th>
            <th scope="col" className="etiqueta px-5 py-3 font-medium">Código</th>
            <th scope="col" className="etiqueta px-5 py-3 font-medium text-right">Falhas</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[rgba(233,229,220,0.05)]">
          {motivos.map((motivo) => (
            <tr key={JSON.stringify([motivo.canal, motivo.codigo_http])}>
              <th scope="row" className="px-5 py-2.5 text-left font-normal text-osso-suave">{motivo.canal_rotulo}</th>
              <td className={`px-5 py-2.5 ${motivo.codigo_http === null ? 'text-osso-mudo' : 'text-osso-suave'}`}>
                {motivo.codigo_http ?? 'Sem código'}
              </td>
              <td className="px-5 py-2.5 text-right tabular-nums text-estado-erro">{motivo.falhas.toLocaleString('pt-BR')}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-linha">
            <th scope="row" colSpan={2} className="px-5 py-3 text-left etiqueta font-medium">Total</th>
            <td className="px-5 py-3 text-right tabular-nums font-medium">{falhas.toLocaleString('pt-BR')}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
