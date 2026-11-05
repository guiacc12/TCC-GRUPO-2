import { Router } from 'express';
import { z } from 'zod';
import { banco, emTransacao } from '../config/banco.js';
import { ErroHttp } from '../middlewares/erros.js';

export const rotasRelatorios = Router();

// America/Sao_Paulo não tem horário de verão desde 2019: deslocamento fixo de -03:00.
// Usamos o deslocamento em vez do nome do fuso porque o MySQL só entende nomes
// ("America/Sao_Paulo") se as tabelas de fuso estiverem carregadas no servidor.
const DESLOCAMENTO_SP = '-03:00';
const SEGUNDOS_POR_DIA = 86400;
const LIMITE_DIAS = 366;
// Tabelas de origem/campanha/meio mostram as maiores linhas e juntam o resto em "Outros".
// UTM com identificador no nome (ex.: promo_{click_id}) criaria um grupo por lead.
const LIMITE_LINHAS = 200;
const ROTULO_FORMULARIO_REMOVIDO = 'Formulário removido';
const ROTULO_NAO_INFORMADO = 'Não informado';
// Rótulos dos valores do ENUM logs_entrega.canal (o valor armazenado segue no JSON)
const ROTULOS_CANAL = { crm: 'CRM', whatsapp_contato: 'WhatsApp do contato', whatsapp_grupo: 'WhatsApp de grupo' };

const dataIso = z
  .string({ required_error: 'Obrigatória' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD')
  .refine((valor) => {
    // Rejeita datas como 2026-02-30, que o Date "corrigiria" para março
    const data = new Date(`${valor}T00:00:00Z`);
    return !Number.isNaN(data.getTime()) && data.toISOString().startsWith(valor);
  }, 'Data inexistente');

// Regras de período comuns a todos os relatórios. Chaves desconhecidas (ex.: empresa_id
// enviado na query) são descartadas pelo zod: o tenant vem só do JWT.
const comPeriodoValido = (objeto) =>
  objeto
    .refine((f) => f.de <= f.ate, { message: 'A data inicial não pode ser posterior à final', path: ['de'] })
    .refine((f) => diasEntre(f.de, f.ate) + 1 <= LIMITE_DIAS, {
      message: `O período máximo é de ${LIMITE_DIAS} dias`,
      path: ['ate'],
    });

const esquemaCaptacao = comPeriodoValido(
  z.object({
    de: dataIso,
    ate: dataIso,
    formulario_id: z.string().regex(/^[1-9]\d*$/, 'ID inválido').optional().or(z.literal('').transform(() => undefined)),
  })
);

const esquemaPeriodo = comPeriodoValido(z.object({ de: dataIso, ate: dataIso }));

function diasEntre(de, ate) {
  return Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / (SEGUNDOS_POR_DIA * 1000));
}

/** Data AAAA-MM-DD somada de N dias (aritmética de calendário, sem fuso). */
function somarDias(data, dias) {
  return new Date(Date.parse(`${data}T00:00:00Z`) + dias * SEGUNDOS_POR_DIA * 1000).toISOString().slice(0, 10);
}

/**
 * Limites do período em epoch (segundos): da meia-noite do 1º dia até a meia-noite
 * seguinte ao último dia, no horário de São Paulo. Intervalo semiaberto [inicio, fim).
 */
function limitesDoPeriodo(de, ate) {
  return {
    inicio: Date.parse(`${de}T00:00:00${DESLOCAMENTO_SP}`) / 1000,
    fim: Date.parse(`${somarDias(ate, 1)}T00:00:00${DESLOCAMENTO_SP}`) / 1000,
  };
}

/**
 * parte ÷ total em %, com 2 casas. Aritmética inteira (centésimos de %) evita o erro de
 * ponto flutuante do toFixed; arredonda a metade para longe do zero, igual para + e -.
 * Devolve null quando total é 0: não há base de cálculo (nunca divide por zero).
 */
function razaoPercentual(parte, total) {
  if (!total) return null;
  const centesimos = (parte * 10000) / total;
  return (Math.sign(centesimos) * Math.round(Math.abs(centesimos))) / 100;
}

/** Mantém as LIMITE_LINHAS maiores linhas e soma o resto em uma linha "Outros": o total não muda. */
function limitarLinhas(linhas, criarOutros) {
  if (linhas.length <= LIMITE_LINHAS) return linhas;
  const resto = linhas.slice(LIMITE_LINHAS);
  return [...linhas.slice(0, LIMITE_LINHAS), criarOutros(resto.length, resto.reduce((soma, l) => soma + l.total, 0))];
}

/**
 * Monta o relatório de captação. Tudo é agregado no MySQL (COUNT + GROUP BY):
 * nenhum lead individual sai do banco (RNF-59).
 */
async function gerarCaptacao(empresaId, { de, ate, formulario_id: formularioId }) {
  let formulario = null;
  if (formularioId) {
    const [linhas] = await banco.query('SELECT id, nome FROM formularios WHERE id = ? AND empresa_id = ?', [
      formularioId,
      empresaId,
    ]);
    if (linhas.length === 0) throw new ErroHttp(404, 'Formulário não encontrado');
    formulario = linhas[0];
  }

  const { inicio, fim } = limitesDoPeriodo(de, ate);

  // UNIX_TIMESTAMP/FROM_UNIXTIME trabalham em epoch, então o resultado não depende
  // do time_zone da sessão MySQL. Lead excluído é DELETE físico: não aparece aqui.
  const condicoes = ['l.empresa_id = ?', 'l.criado_em >= FROM_UNIXTIME(?)', 'l.criado_em < FROM_UNIXTIME(?)'];
  const parametros = [empresaId, inicio, fim];
  if (formulario) {
    condicoes.push('l.formulario_id = ?');
    parametros.push(formulario.id);
  }
  const where = condicoes.join(' AND ');

  // As duas consultas rodam na mesma transação (snapshot consistente do InnoDB):
  // um lead que chegue entre elas não desalinha as somas.
  const { porDia, porFormulario } = await emTransacao(async (conexao) => {
    // Índice do dia = segundos desde a meia-noite (SP) do 1º dia ÷ 86400.
    const [dias] = await conexao.query(
      `SELECT FLOOR((UNIX_TIMESTAMP(l.criado_em) - ?) / ${SEGUNDOS_POR_DIA}) AS indice, COUNT(*) AS total
       FROM leads l WHERE ${where} GROUP BY indice`,
      [inicio, ...parametros]
    );
    const [formularios] = await conexao.query(
      `SELECT l.formulario_id, f.nome, COUNT(*) AS total
       FROM leads l LEFT JOIN formularios f ON f.id = l.formulario_id AND f.empresa_id = l.empresa_id
       WHERE ${where}
       GROUP BY l.formulario_id, f.nome
       ORDER BY total DESC, f.nome IS NULL, f.nome`,
      parametros
    );
    return { porDia: dias, porFormulario: formularios };
  });

  // Todos os dias do período aparecem, inclusive os sem captação (total 0)
  const totalPorIndice = new Map(porDia.map((linha) => [Number(linha.indice), Number(linha.total)]));
  const por_dia = Array.from({ length: diasEntre(de, ate) + 1 }, (_, indice) => ({
    data: somarDias(de, indice),
    total: totalPorIndice.get(indice) || 0,
  }));

  // Lead sem formulário (formulário apagado → SET NULL) vira "Formulário removido"
  const por_formulario = porFormulario.map((linha) => ({
    formulario_id: linha.formulario_id,
    nome: linha.nome ?? ROTULO_FORMULARIO_REMOVIDO,
    total: Number(linha.total),
  }));

  const total = por_formulario.reduce((soma, linha) => soma + linha.total, 0);
  return { periodo: { de, ate }, formulario, total, por_dia, por_formulario };
}

/**
 * Relatório de origem: leads agrupados por utm_source + utm_campaign, mais o total por
 * origem e por meio (utm_medium). Quantidades e percentuais saem do servidor (RNF-62), do
 * mesmo snapshot: tela, PDF e CSV nunca divergem.
 */
async function gerarOrigem(empresaId, { de, ate }) {
  const { inicio, fim } = limitesDoPeriodo(de, ate);
  const periodo = 'l.empresa_id = ? AND l.criado_em >= FROM_UNIXTIME(?) AND l.criado_em < FROM_UNIXTIME(?)';
  // Ausente, vazio ou só espaços viram "Não informado"
  const rotulo = (coluna) => `COALESCE(NULLIF(TRIM(${coluna}), ''), ?)`;

  // GROUP BY pelos apelidos garante um único grupo por lead. A collation do banco (_ci)
  // ignora maiúsculas: "Google" e "google" caem no mesmo grupo. Os apelidos NÃO podem se
  // chamar "origem": a tabela leads tem uma coluna com esse nome e o GROUP BY agruparia por
  // ela, não pela expressão.
  const { grupos, fontes, meios } = await emTransacao(async (conexao) => {
    const [g] = await conexao.query(
      `SELECT ${rotulo('l.utm_source')} AS grupo_origem, ${rotulo('l.utm_campaign')} AS grupo_campanha, COUNT(*) AS total
       FROM leads l WHERE ${periodo}
       GROUP BY grupo_origem, grupo_campanha ORDER BY total DESC, grupo_origem, grupo_campanha`,
      [ROTULO_NAO_INFORMADO, ROTULO_NAO_INFORMADO, empresaId, inicio, fim]
    );
    const [f] = await conexao.query(
      `SELECT ${rotulo('l.utm_source')} AS grupo_origem, COUNT(*) AS total
       FROM leads l WHERE ${periodo} GROUP BY grupo_origem ORDER BY total DESC, grupo_origem`,
      [ROTULO_NAO_INFORMADO, empresaId, inicio, fim]
    );
    const [m] = await conexao.query(
      `SELECT ${rotulo('l.utm_medium')} AS grupo_meio, COUNT(*) AS total
       FROM leads l WHERE ${periodo} GROUP BY grupo_meio ORDER BY total DESC, grupo_meio`,
      [ROTULO_NAO_INFORMADO, empresaId, inicio, fim]
    );
    return { grupos: g, fontes: f, meios: m };
  });

  const total = grupos.reduce((soma, linha) => soma + Number(linha.total), 0);
  const comPercentual = (linhas) => linhas.map((l) => ({ ...l, percentual: razaoPercentual(l.total, total) }));
  const semOrigem = Number(fontes.find((f) => f.grupo_origem === ROTULO_NAO_INFORMADO)?.total ?? 0);

  return {
    periodo: { de, ate },
    total,
    por_origem: comPercentual(
      limitarLinhas(
        grupos.map((l) => ({ origem: l.grupo_origem, campanha: l.grupo_campanha, total: Number(l.total) })),
        (n, soma) => ({ origem: 'Outros', campanha: `${n} grupos menores`, total: soma })
      )
    ),
    por_fonte: comPercentual(
      limitarLinhas(
        fontes.map((l) => ({ origem: l.grupo_origem, total: Number(l.total) })),
        (n, soma) => ({ origem: `Outros (${n} origens)`, total: soma })
      )
    ),
    por_meio: comPercentual(
      limitarLinhas(
        meios.map((l) => ({ meio: l.grupo_meio, total: Number(l.total) })),
        (n, soma) => ({ meio: `Outros (${n} meios)`, total: soma })
      )
    ),
    // Qualidade do rastreamento: leads que chegaram sem utm_source
    sem_origem: { total: semOrigem, percentual: razaoPercentual(semOrigem, total) },
  };
}

/**
 * Relatório de entregas das integrações: conta registros de logs_entrega (não leads nem
 * mensagens únicas) por canal e destino. Tudo do mesmo snapshot: totais e grupos sempre batem.
 */
async function gerarEntregas(empresaId, { de, ate }) {
  const { inicio, fim } = limitesDoPeriodo(de, ate);
  const periodo = 'l.empresa_id = ? AND l.criado_em >= FROM_UNIXTIME(?) AND l.criado_em < FROM_UNIXTIME(?)';
  const parametros = [empresaId, inicio, fim];

  const { grupos, motivos, semEntrega } = await emTransacao(async (conexao) => {
    // Apelidos "grupo_*" para não colidirem com as colunas canal/destino/sucesso da tabela
    // (GROUP BY prefere a coluna ao apelido). O destino é agrupado em collation binária:
    // reflete exatamente o valor armazenado, sem juntar "Pipedrive" com "pipedrive".
    const [g] = await conexao.query(
      `SELECT l.canal AS grupo_canal,
              l.destino COLLATE utf8mb4_bin AS grupo_destino,
              SUM(l.sucesso <> 0) AS sucessos,
              SUM(l.sucesso = 0) AS falhas,
              COUNT(*) AS total
       FROM logs_entrega l WHERE ${periodo}
       GROUP BY grupo_canal, grupo_destino
       ORDER BY total DESC, grupo_canal, grupo_destino`,
      parametros
    );
    // Só o código HTTP já gravado: detalhe (mensagem de erro) nunca sai daqui
    const [m] = await conexao.query(
      `SELECT l.canal AS grupo_canal, l.codigo_http AS grupo_codigo, COUNT(*) AS falhas
       FROM logs_entrega l WHERE ${periodo} AND l.sucesso = 0
       GROUP BY grupo_canal, grupo_codigo ORDER BY falhas DESC, grupo_canal, grupo_codigo`,
      parametros
    );
    // Leads com falha no período e NENHUM sucesso (em qualquer data) no mesmo canal e destino:
    // uma tentativa que falhou e depois deu certo não conta, e uma nova tentativa que falhou
    // outra vez não conta duas vezes (DISTINCT). Este é o número de leads, não de registros.
    const [[{ leads }]] = await conexao.query(
      `SELECT COUNT(DISTINCT l.lead_id) AS leads
       FROM logs_entrega l
       WHERE ${periodo} AND l.sucesso = 0
         AND NOT EXISTS (
           SELECT 1 FROM logs_entrega s
           WHERE s.empresa_id = l.empresa_id AND s.lead_id = l.lead_id AND s.canal = l.canal
             AND s.destino = l.destino COLLATE utf8mb4_bin AND s.sucesso <> 0)`,
      parametros
    );
    return { grupos: g, motivos: m, semEntrega: Number(leads) };
  });

  const por_grupo = grupos.map((linha) => {
    const sucessos = Number(linha.sucessos);
    const total = Number(linha.total);
    return {
      canal: linha.grupo_canal,
      canal_rotulo: ROTULOS_CANAL[linha.grupo_canal] ?? linha.grupo_canal,
      destino: linha.grupo_destino,
      sucessos,
      falhas: Number(linha.falhas),
      total,
      taxa_sucesso: razaoPercentual(sucessos, total),
    };
  });
  const soma = (campo) => por_grupo.reduce((acc, grupo) => acc + grupo[campo], 0);

  return {
    periodo: { de, ate },
    total: soma('total'),
    sucessos: soma('sucessos'),
    falhas: soma('falhas'),
    taxa_sucesso: razaoPercentual(soma('sucessos'), soma('total')),
    leads_sem_entrega: semEntrega,
    por_grupo,
    por_motivo: motivos.map((linha) => ({
      canal: linha.grupo_canal,
      canal_rotulo: ROTULOS_CANAL[linha.grupo_canal] ?? linha.grupo_canal,
      codigo_http: linha.grupo_codigo, // null = falha sem resposta HTTP
      falhas: Number(linha.falhas),
    })),
  };
}

/**
 * Gera o relatório do período pedido e compara o total com o período anterior imediato, de
 * mesmo tamanho (30 dias → os 30 dias antes). Variação em %, null quando o anterior é 0.
 * shortcut: roda o relatório inteiro do período anterior só para ler o total (consultas em
 * dobro); trocar por um COUNT dedicado se isso pesar com muitos leads.
 */
async function comAnterior(gerar, empresaId, filtros) {
  const atual = await gerar(empresaId, filtros);
  const dias = diasEntre(filtros.de, filtros.ate) + 1;
  const periodoAnterior = { de: somarDias(filtros.de, -dias), ate: somarDias(filtros.de, -1) };
  const anterior = await gerar(empresaId, { ...filtros, ...periodoAnterior });
  return {
    ...atual,
    anterior: {
      periodo: periodoAnterior,
      total: anterior.total,
      ...(anterior.taxa_sucesso !== undefined && { taxa_sucesso: anterior.taxa_sucesso }),
    },
    variacao: razaoPercentual(atual.total - anterior.total, anterior.total),
  };
}

// ---------------------------------------------------------------------------
// CSV (RNF-60): UTF-8 com BOM (acentos certos no Excel), separador ";" (detectado
// pelo Google Sheets e padrão do Excel pt-BR) e proteção contra injeção de fórmula.
// Sem linha "sep=": o Sheets a exibe como texto na 1ª célula.
// ---------------------------------------------------------------------------

function celulaCsv(valor) {
  let texto = String(valor ?? '');
  // Valores iniciados por = + - @ TAB ou CR seriam interpretados como fórmula
  if (/^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`;
  if (/[;"\r\n]/.test(texto)) texto = `"${texto.replace(/"/g, '""')}"`;
  return texto;
}

const dataBr = (iso) => iso.split('-').reverse().join('/');
const pctBr = (valor) => (valor === null ? 'Sem registros' : `${valor.toFixed(2).replace('.', ',')}%`);

/** Serializa as linhas: BOM + cada célula protegida + CRLF. */
const serializarCsv = (linhas) =>
  `\uFEFF${linhas.map((linha) => linha.map(celulaCsv).join(';')).join('\r\n')}\r\n`;

const periodoBr = ({ de, ate }) => `${dataBr(de)} a ${dataBr(ate)}`;

// Em palavras ("Aumento de"), não com sinal: "-5,00%" no início da célula viraria fórmula no Excel
const textoVariacao = (variacao) =>
  variacao === null ? 'Sem base de comparação' : variacao === 0 ? 'Sem variação' : `${variacao > 0 ? 'Aumento' : 'Queda'} de ${pctBr(Math.abs(variacao))}`;

const linhasComparacao = ({ anterior, variacao }) => [
  ['Período anterior', periodoBr(anterior.periodo)],
  ['Total no período anterior', anterior.total],
  ['Variação', textoVariacao(variacao)],
];

function csvCaptacao(relatorio) {
  return serializarCsv([
    ['Relatório de captação de leads'],
    ['Período', periodoBr(relatorio.periodo)],
    ['Formulário', relatorio.formulario ? relatorio.formulario.nome : 'Todos'],
    ['Total de leads', relatorio.total],
    ...linhasComparacao(relatorio),
    [],
    ['Quantidade por dia'],
    ['Data', 'Quantidade'],
    ...relatorio.por_dia.map((linha) => [dataBr(linha.data), linha.total]),
    [],
    ['Quantidade por formulário'],
    ['Formulário', 'Quantidade'],
    ...relatorio.por_formulario.map((linha) => [linha.nome, linha.total]),
  ]);
}

// Só origem, campanha, meio, quantidade e percentual: nenhum dado pessoal do lead entra aqui
function csvOrigem(relatorio) {
  return serializarCsv([
    ['Relatório de origem dos leads'],
    ['Período', periodoBr(relatorio.periodo)],
    ['Total de leads', relatorio.total],
    ...linhasComparacao(relatorio),
    ['Leads sem origem informada', relatorio.sem_origem.total, pctBr(relatorio.sem_origem.percentual)],
    [],
    ['Origem', 'Campanha', 'Quantidade', 'Percentual'],
    ...relatorio.por_origem.map((l) => [l.origem, l.campanha, l.total, pctBr(l.percentual)]),
    [],
    ['Total por origem'],
    ['Origem', 'Quantidade', 'Percentual'],
    ...relatorio.por_fonte.map((l) => [l.origem, l.total, pctBr(l.percentual)]),
    [],
    ['Total por meio (utm_medium)'],
    ['Meio', 'Quantidade', 'Percentual'],
    ...relatorio.por_meio.map((l) => [l.meio, l.total, pctBr(l.percentual)]),
  ]);
}

// Só contagens e códigos HTTP: detalhe, mensagens e credenciais nunca saem de logs_entrega
function csvEntregas(relatorio) {
  return serializarCsv([
    ['Relatório de entregas e falhas das integrações'],
    ['Período', periodoBr(relatorio.periodo)],
    ['Registros de entrega', relatorio.total],
    ['Sucessos', relatorio.sucessos],
    ['Falhas', relatorio.falhas],
    ['Taxa de sucesso', pctBr(relatorio.taxa_sucesso)],
    ['Leads sem entrega concluída', relatorio.leads_sem_entrega],
    ...linhasComparacao(relatorio),
    ['Taxa de sucesso no período anterior', pctBr(relatorio.anterior.taxa_sucesso)],
    [],
    ['Canal', 'Destino', 'Sucessos', 'Falhas', 'Total', 'Taxa de sucesso'],
    ...relatorio.por_grupo.map((g) => [g.canal_rotulo, g.destino, g.sucessos, g.falhas, g.total, pctBr(g.taxa_sucesso)]),
    [],
    ['Falhas por código de resposta'],
    ['Canal', 'Código', 'Falhas'],
    ...relatorio.por_motivo.map((m) => [m.canal_rotulo, m.codigo_http ?? 'Sem código', m.falhas]),
  ]);
}

function enviarCsv(res, nomeBase, { de, ate }, conteudo) {
  res
    .set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${nomeBase}_${de}_a_${ate}.csv"`,
      'Cache-Control': 'no-store',
      // Painel (Vercel) e API (Railway) estão em origens diferentes: sem isto o
      // navegador esconde o Content-Disposition do JavaScript
      'Access-Control-Expose-Headers': 'Content-Disposition',
    })
    .send(conteudo);
}

// Cada relatório vira duas rotas: /<nome> (JSON da tela e do PDF) e /<nome>.csv.
// empresa_id vem SEMPRE do JWT (req.empresaId), nunca da query.
const RELATORIOS = {
  'captacao-leads': { esquema: esquemaCaptacao, gerar: gerarCaptacao, csv: csvCaptacao },
  'origem-leads': { esquema: esquemaPeriodo, gerar: gerarOrigem, csv: csvOrigem },
  'entregas-integracoes': { esquema: esquemaPeriodo, gerar: gerarEntregas, csv: csvEntregas },
};

for (const [nome, { esquema, gerar, csv }] of Object.entries(RELATORIOS)) {
  rotasRelatorios.get(`/${nome}`, async (req, res, next) => {
    try {
      const filtros = esquema.parse(req.query);
      res.json({ sucesso: true, ...(await comAnterior(gerar, req.empresaId, filtros)) });
    } catch (erro) {
      next(erro);
    }
  });

  rotasRelatorios.get(`/${nome}.csv`, async (req, res, next) => {
    try {
      const filtros = esquema.parse(req.query);
      enviarCsv(res, nome, filtros, csv(await comAnterior(gerar, req.empresaId, filtros)));
    } catch (erro) {
      next(erro);
    }
  });
}
