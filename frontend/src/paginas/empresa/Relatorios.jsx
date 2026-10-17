import { useEffect, useState } from 'react';
import { api, baixarArquivo } from '../../lib/api.js';
import { Botao, CabecalhoPagina, Campo, Carregando, EstadoVazio, Selecao, avisar } from '../../componentes/ui.jsx';
import { useRevelar } from '../../lib/animacoes.js';

const TIPOS_RELATORIO = [{ valor: 'captacao-leads', texto: 'Captação de leads' }];
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

/** Mesmas regras do servidor — validar aqui só evita uma ida à API à toa. */
function validar({ de, ate }) {
  if (!de || !ate) return 'Informe a data inicial e a data final.';
  if (de > ate) return 'A data inicial não pode ser posterior à final.';
  const dias = (Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86400000 + 1;
  if (dias > LIMITE_DIAS) return `O período máximo é de ${LIMITE_DIAS} dias.`;
  return null;
}

function consultaDe(filtros) {
  const consulta = new URLSearchParams({ de: filtros.de, ate: filtros.ate });
  if (filtros.formulario_id) consulta.set('formulario_id', filtros.formulario_id);
  return consulta.toString();
}

export default function Relatorios() {
  const [tipo, setTipo] = useState(TIPOS_RELATORIO[0].valor);
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
  // Filtros que geraram o resultado na tela — a exportação usa estes, não os campos
  // editados depois, para o CSV corresponder ao que está sendo exibido
  const [filtrosGerados, setFiltrosGerados] = useState(null);
  const [exportando, setExportando] = useState(false);
  const ref = useRevelar([estado]);

  useEffect(() => {
    api('/api/empresa/formularios')
      .then((resposta) => setFormularios(resposta.formularios || []))
      .catch(() => {}); // sem a lista, o relatório ainda funciona com "Todos os formulários"
  }, []);

  async function gerar(alvo = filtros) {
    const problema = validar(alvo);
    setErroValidacao(problema);
    if (problema) return;

    setEstado('carregando');
    setErroConsulta(null);
    try {
      const resposta = await api(`/api/empresa/relatorios/captacao-leads?${consultaDe(alvo)}`);
      setRelatorio(resposta);
      setFiltrosGerados(alvo);
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
        `/api/empresa/relatorios/captacao-leads.csv?${consultaDe(filtrosGerados)}`,
        `captacao-leads_${filtrosGerados.de}_a_${filtrosGerados.ate}.csv`
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
        descricao="Acompanhe o volume de contatos recebidos por período e formulário."
      />

      <form
        className="cartao p-5 mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-[1.2fr_150px_150px_1.2fr_auto] items-end"
        onSubmit={(evento) => {
          evento.preventDefault();
          gerar();
        }}
        noValidate
        data-revelar
      >
        <Selecao rotulo="Relatório" value={tipo} onChange={(e) => setTipo(e.target.value)} opcoes={TIPOS_RELATORIO} />
        <Campo rotulo="Data inicial" type="date" required value={filtros.de} max={filtros.ate || undefined} onChange={alterar('de')} />
        <Campo rotulo="Data final" type="date" required value={filtros.ate} min={filtros.de || undefined} onChange={alterar('ate')} />
        <Selecao
          rotulo="Formulário"
          value={filtros.formulario_id}
          onChange={alterar('formulario_id')}
          opcoes={[
            { valor: '', texto: 'Todos os formulários' },
            ...formularios.map((f) => ({ valor: String(f.id), texto: f.nome })),
          ]}
        />
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
          <EstadoVazio
            titulo="Escolha o período"
            descricao="Ajuste as datas e o formulário, se quiser, e clique em Gerar relatório."
          />
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

        {estado === 'pronto' && relatorio && (
          <ResultadoCaptacao relatorio={relatorio} aoExportar={exportarCsv} exportando={exportando} />
        )}
      </section>
    </div>
  );
}

function ResultadoCaptacao({ relatorio, aoExportar, exportando }) {
  const periodo = `${dataBr(relatorio.periodo.de)} a ${dataBr(relatorio.periodo.ate)}`;
  const nomeFormulario = relatorio.formulario?.nome || 'Todos os formulários';

  return (
    <>
      <div className="grid gap-3 md:grid-cols-[2fr_1fr] mb-6">
        <article className="cartao p-6 bg-vidro-forte" data-revelar>
          <p className="etiqueta">Período consultado</p>
          <p className="titulo-editorial text-2xl mt-2">{periodo}</p>
          <p className="text-sm text-osso-mudo mt-1">{nomeFormulario} · horário de Brasília</p>
        </article>
        <article className="cartao p-6" data-revelar>
          <p className="etiqueta">Total de leads</p>
          <p className="titulo-editorial text-4xl mt-2">{relatorio.total.toLocaleString('pt-BR')}</p>
        </article>
      </div>

      {relatorio.total === 0 ? (
        <EstadoVazio titulo="Não há leads no período" descricao="Nenhum lead foi capturado entre as datas selecionadas." />
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
