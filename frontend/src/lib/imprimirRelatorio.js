// Versão para impressão (A4, fundo branco) dos relatórios do painel.
// Monta um documento HTML independente a partir do resultado JÁ exibido na tela: sem nova
// consulta, sem dependência e sem tocar no estilo do painel. O usuário imprime ou escolhe
// "Salvar como PDF" no diálogo do navegador.

// Todo valor vindo do banco (UTM, nome de formulário, destino) é controlado por terceiros:
// sempre passa por esc() antes de entrar no HTML.
const esc = (valor) =>
  String(valor ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Formatação e textos compartilhados com a tela (Relatorios.jsx): um só lugar para os dois
// mostrarem o mesmo número do mesmo jeito.
export const num = (valor) => valor.toLocaleString('pt-BR');
export const pct = (valor) => `${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
export const dataBr = (iso) => iso.split('-').reverse().join('/');
export const diaSemana = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' });

export const TITULOS = {
  'captacao-leads': 'Captação de leads',
  'origem-leads': 'Origem dos leads',
  'entregas-integracoes': 'Entregas e falhas das integrações',
};

/** Linha de comparação do total com o período anterior ("variacao" já vem do servidor, em %). */
export function textoComparacao({ periodo, total }, variacao) {
  const base = `Período anterior (${dataBr(periodo.de)} a ${dataBr(periodo.ate)}): ${num(total)}`;
  if (variacao === null) return `${base} · sem base de comparação`;
  if (variacao === 0) return `${base} · sem variação`;
  return `${base} · ${variacao > 0 ? '+' : '-'}${pct(Math.abs(variacao))}`;
}

export const textoTaxaAnterior = ({ taxa_sucesso: taxa }) =>
  `Período anterior: ${taxa === null ? 'sem registros' : pct(taxa)}`;

export const textoSemOrigem = ({ total, percentual }) => ({
  valor: percentual === null ? '—' : pct(percentual),
  nota: `${num(total)} lead${total === 1 ? '' : 's'} sem utm_source`,
});

// Margem de 20 mm por @page (o navegador desconta da folha em todas as páginas). Só bordas
// e texto escuro, sem fundos: imprime igual em qualquer impressora e em preto e branco.
const ESTILO = `
  @page { size: A4 portrait; margin: 20mm 18mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #fff; color: #111; }
  body { font: 10pt/1.45 Arial, Helvetica, sans-serif; }
  header { border-bottom: 1.5pt solid #111; padding-bottom: 5mm; margin-bottom: 7mm; }
  .empresa { margin: 0 0 1mm; font-size: 9pt; letter-spacing: .08em; text-transform: uppercase; color: #444; }
  h1 { margin: 0 0 4mm; font-size: 18pt; line-height: 1.2; }
  .meta { display: flex; flex-wrap: wrap; gap: 2mm 10mm; margin: 0; font-size: 9pt; }
  .meta div { min-width: 0; }
  .meta dt { color: #555; font-size: 8pt; text-transform: uppercase; letter-spacing: .06em; }
  .meta dd { margin: 0; font-weight: 700; overflow-wrap: anywhere; }
  .cartoes { display: flex; flex-wrap: wrap; gap: 4mm; margin: 0 0 7mm; }
  .cartao { flex: 1 1 52mm; border: .75pt solid #888; padding: 3mm 4mm; break-inside: avoid; }
  .cartao small { display: block; margin-top: 1.5mm; font-size: 8pt; line-height: 1.3; color: #555; }
  .cartao span { display: block; font-size: 8pt; color: #555; text-transform: uppercase; letter-spacing: .06em; }
  .cartao strong { display: block; margin-top: 1mm; font-size: 18pt; line-height: 1.1; }
  .nota { margin: 0 0 6mm; font-size: 8.5pt; color: #444; }
  .vazio { margin: 0; padding: 10mm 0; text-align: center; border: .75pt dashed #888; }
  .vazio strong { display: block; font-size: 12pt; margin-bottom: 1mm; }
  table { width: 100%; border-collapse: collapse; margin: 0 0 8mm; table-layout: auto; }
  caption { caption-side: top; text-align: left; font-weight: 700; font-size: 11pt; margin-bottom: 2mm; }
  thead { display: table-header-group; }   /* repete o cabeçalho a cada página */
  tfoot { display: table-row-group; }      /* o total aparece uma vez só, no fim */
  tr { break-inside: avoid; }
  th, td { padding: 1.8mm 2.5mm; text-align: left; vertical-align: top; border-bottom: .5pt solid #bbb; overflow-wrap: anywhere; }
  th:first-child, td:first-child { padding-left: 0; }   /* texto alinhado à margem, linhas de ponta a ponta */
  th:last-child, td:last-child { padding-right: 0; }
  .nw { white-space: nowrap; }
  thead th { font-size: 8pt; text-transform: uppercase; letter-spacing: .05em; color: #333; border-bottom: 1pt solid #111; }
  tfoot td { border-top: 1pt solid #111; border-bottom: 0; font-weight: 700; }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .mudo { color: #666; }
`;

/** itens: [rotulo, valor, nota?] */
const cartoes = (itens) =>
  `<section class="cartoes">${itens
    .map(([rotulo, valor, nota]) => `<div class="cartao"><span>${esc(rotulo)}</span><strong>${esc(valor)}</strong>${nota ? `<small>${esc(nota)}</small>` : ''}</div>`)
    .join('')}</section>`;

const vazio = (titulo, descricao) => `<p class="vazio"><strong>${esc(titulo)}</strong>${esc(descricao)}</p>`;

/** colunas: [{ rotulo, num, nw, min }] (nw = sem quebra; min = largura mínima); linhas e rodape: células já formatadas. */
function tabela(titulo, colunas, linhas, rodape) {
  const atributos = (c) => {
    const classes = [c.num && 'num', c.nw && 'nw'].filter(Boolean).join(' ');
    return (classes ? ` class="${classes}"` : '') + (c.min ? ` style="min-width:${c.min}"` : '');
  };
  const celula = (tag, valor, i) => `<${tag}${atributos(colunas[i])}>${esc(valor)}</${tag}>`;
  const cabeca = colunas.map((c, i) => celula('th', c.rotulo, i)).join('');
  const corpo = linhas.map((linha) => `<tr>${linha.map((v, i) => celula('td', v, i)).join('')}</tr>`).join('');
  const pe = rodape ? `<tfoot><tr>${rodape.map((v, i) => celula('td', v, i)).join('')}</tr></tfoot>` : '';
  return `<table><caption>${esc(titulo)}</caption><thead><tr>${cabeca}</tr></thead><tbody>${corpo}</tbody>${pe}</table>`;
}

// Cada tipo devolve { detalhe, conteudo }. As regras espelham as telas ([Relatorios.jsx]):
// sem registros, só os totais zerados e a mensagem de ausência de dados.
const CORPOS = {
  'captacao-leads': (r) => ({
    detalhe: [['Formulário', r.formulario?.nome || 'Todos os formulários']],
    conteudo:
      cartoes([['Total de leads', num(r.total), textoComparacao(r.anterior, r.variacao)]]) +
      (r.total === 0
        ? vazio('Não há leads no período', 'Nenhum lead foi capturado entre as datas selecionadas.')
        : tabela(
            'Quantidade por formulário',
            [{ rotulo: 'Formulário' }, { rotulo: 'Leads', num: true }],
            r.por_formulario.map((l) => [l.nome, num(l.total)]),
            ['Total', num(r.total)]
          ) +
          tabela(
            'Quantidade por dia',
            [{ rotulo: 'Data' }, { rotulo: 'Leads', num: true }],
            r.por_dia.map((l) => [`${dataBr(l.data)}  ${diaSemana(l.data)}`, num(l.total)]),
            ['Total', num(r.total)]
          )),
  }),

  'origem-leads': (r) => ({
    detalhe: [['Agrupamento', 'Origem e campanha (UTM)']],
    conteudo:
      cartoes([
        ['Total de leads', num(r.total), textoComparacao(r.anterior, r.variacao)],
        ['Leads sem origem informada', textoSemOrigem(r.sem_origem).valor, textoSemOrigem(r.sem_origem).nota],
      ]) +
      (r.total === 0
        ? vazio('Não há leads no período', 'Nenhum lead foi capturado entre as datas selecionadas.')
        : '<p class="nota">Mede o volume de contatos por origem e campanha, não vendas nem conversões. ' +
          'Percentuais arredondados em duas casas: a soma pode diferir de 100%.</p>' +
          tabela(
            'Leads por origem e campanha',
            [{ rotulo: 'Origem', min: '28mm' }, { rotulo: 'Campanha' }, { rotulo: 'Leads', num: true }, { rotulo: 'Percentual', num: true }],
            r.por_origem.map((l) => [l.origem, l.campanha, num(l.total), pct(l.percentual)]),
            ['Total', '', num(r.total), '']) +
          tabela(
            'Total por origem',
            [{ rotulo: 'Origem', min: '28mm' }, { rotulo: 'Leads', num: true }, { rotulo: 'Percentual', num: true }],
            r.por_fonte.map((l) => [l.origem, num(l.total), pct(l.percentual)]),
            ['Total', num(r.total), '']) +
          tabela(
            'Total por meio (utm_medium)',
            [{ rotulo: 'Meio', min: '28mm' }, { rotulo: 'Leads', num: true }, { rotulo: 'Percentual', num: true }],
            r.por_meio.map((l) => [l.meio, num(l.total), pct(l.percentual)]),
            ['Total', num(r.total), ''])),
  }),

  'entregas-integracoes': (r) => ({
    detalhe: [['Canais', 'CRM e WhatsApp']],
    conteudo:
      cartoes([
        ['Registros de entrega', num(r.total), textoComparacao(r.anterior, r.variacao)],
        ['Sucessos', num(r.sucessos)],
        ['Falhas', num(r.falhas)],
        ['Taxa de sucesso', r.taxa_sucesso === null ? '—' : pct(r.taxa_sucesso), textoTaxaAnterior(r.anterior)],
        ['Leads sem entrega concluída', num(r.leads_sem_entrega), 'falha sem nenhum sucesso no mesmo canal e destino'],
      ]) +
      (r.total === 0
        ? vazio('Não há registros de entrega no período', 'Nenhuma tentativa de entrega ao CRM ou ao WhatsApp foi registrada entre as datas selecionadas.')
        : '<p class="nota">Cada registro de entrega conta uma vez: não são leads nem mensagens únicas, e um mesmo lead pode aparecer em vários grupos.</p>' +
          tabela(
            'Entregas por canal e destino',
            [
              { rotulo: 'Canal', nw: true }, { rotulo: 'Destino' }, { rotulo: 'Sucessos', num: true },
              { rotulo: 'Falhas', num: true }, { rotulo: 'Total', num: true }, { rotulo: 'Taxa', num: true },
            ],
            r.por_grupo.map((g) => [g.canal_rotulo, g.destino, num(g.sucessos), num(g.falhas), num(g.total), pct(g.taxa_sucesso)]),
            ['Total', '', num(r.sucessos), num(r.falhas), num(r.total), r.taxa_sucesso === null ? '' : pct(r.taxa_sucesso)]) +
          (r.por_motivo.length === 0
            ? ''
            : tabela(
                'Falhas por código de resposta',
                [{ rotulo: 'Canal', nw: true }, { rotulo: 'Código' }, { rotulo: 'Falhas', num: true }],
                r.por_motivo.map((m) => [m.canal_rotulo, m.codigo_http ?? 'Sem código', num(m.falhas)]),
                ['Total', '', num(r.falhas)]))),
  }),
};

/** Documento HTML completo do relatório (função pura: testável sem navegador). */
export function montarHtmlRelatorio(relatorio, { empresa = '', geradoEm = new Date() } = {}) {
  const titulo = TITULOS[relatorio.tipo];
  if (!titulo) throw new Error('Tipo de relatório desconhecido');

  const { detalhe, conteudo } = CORPOS[relatorio.tipo](relatorio);
  const { de, ate } = relatorio.periodo;
  const gerado = geradoEm.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
  const meta = [['Período', `${dataBr(de)} a ${dataBr(ate)}`], ...detalhe, ['Gerado em', `${gerado} (Brasília)`]]
    .map(([rotulo, valor]) => `<div><dt>${esc(rotulo)}</dt><dd>${esc(valor)}</dd></div>`)
    .join('');

  // O <title> vira o nome sugerido do arquivo em "Salvar como PDF"
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(`${relatorio.tipo}_${de}_a_${ate}`)}</title>` +
    `<style>${ESTILO}</style></head><body><header>` +
    `${empresa ? `<p class="empresa">${esc(empresa)}</p>` : ''}<h1>${esc(titulo)}</h1><dl class="meta">${meta}</dl></header>${conteudo}</body></html>`;
}

/** Abre o documento numa nova janela e chama a impressão (daí: imprimir ou salvar em PDF). */
export function imprimirRelatorio(relatorio, empresa) {
  // Precisa ser chamada direto de um clique, senão o navegador bloqueia a janela
  const janela = window.open('', '_blank');
  if (!janela) throw new Error('O navegador bloqueou a nova janela. Permita pop-ups para este site e tente de novo.');

  janela.document.open();
  janela.document.write(montarHtmlRelatorio(relatorio, { empresa }));
  janela.document.close();
  const imprimir = () => {
    janela.focus();
    janela.print();
  };
  if (janela.document.readyState === 'complete') imprimir();
  else janela.addEventListener('load', imprimir);
}
