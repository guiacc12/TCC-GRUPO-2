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
const ROTULO_FORMULARIO_REMOVIDO = 'Formulário removido';

const dataIso = z
  .string({ required_error: 'Obrigatória' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD')
  .refine((valor) => {
    // Rejeita datas como 2026-02-30, que o Date "corrigiria" para março
    const data = new Date(`${valor}T00:00:00Z`);
    return !Number.isNaN(data.getTime()) && data.toISOString().startsWith(valor);
  }, 'Data inexistente');

const esquemaFiltros = z
  .object({
    de: dataIso,
    ate: dataIso,
    formulario_id: z.string().regex(/^[1-9]\d*$/, 'ID inválido').optional().or(z.literal('').transform(() => undefined)),
  })
  .refine((f) => f.de <= f.ate, { message: 'A data inicial não pode ser posterior à final', path: ['de'] })
  .refine((f) => diasEntre(f.de, f.ate) + 1 <= LIMITE_DIAS, {
    message: `O período máximo é de ${LIMITE_DIAS} dias`,
    path: ['ate'],
  });

function diasEntre(de, ate) {
  return Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / (SEGUNDOS_POR_DIA * 1000));
}

/** Data AAAA-MM-DD somada de N dias (aritmética de calendário, sem fuso). */
function somarDias(data, dias) {
  return new Date(Date.parse(`${data}T00:00:00Z`) + dias * SEGUNDOS_POR_DIA * 1000).toISOString().slice(0, 10);
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

  // Limites do período em epoch (segundos): da meia-noite do 1º dia até a meia-noite
  // seguinte ao último dia, no horário de São Paulo. Intervalo semiaberto [inicio, fim).
  const inicio = Date.parse(`${de}T00:00:00${DESLOCAMENTO_SP}`) / 1000;
  const fim = Date.parse(`${somarDias(ate, 1)}T00:00:00${DESLOCAMENTO_SP}`) / 1000;

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

// ---------------------------------------------------------------------------
// CSV (RNF-60): UTF-8, separador ";" e proteção contra injeção de fórmula.
// A 1ª linha "sep=;" faz o Excel separar as colunas em qualquer região. Sem BOM:
// com BOM o Excel ignora o "sep=" e volta a usar o separador do sistema.
// ---------------------------------------------------------------------------

function celulaCsv(valor) {
  let texto = String(valor ?? '');
  // Valores iniciados por = + - @ TAB ou CR seriam interpretados como fórmula
  if (/^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`;
  if (/[;"\r\n]/.test(texto)) texto = `"${texto.replace(/"/g, '""')}"`;
  return texto;
}

const dataBr = (iso) => iso.split('-').reverse().join('/');

function montarCsv(relatorio) {
  const linhas = [
    ['Relatório de captação de leads'],
    ['Período', `${dataBr(relatorio.periodo.de)} a ${dataBr(relatorio.periodo.ate)}`],
    ['Formulário', relatorio.formulario ? relatorio.formulario.nome : 'Todos'],
    ['Total de leads', relatorio.total],
    [],
    ['Quantidade por dia'],
    ['Data', 'Quantidade'],
    ...relatorio.por_dia.map((linha) => [dataBr(linha.data), linha.total]),
    [],
    ['Quantidade por formulário'],
    ['Formulário', 'Quantidade'],
    ...relatorio.por_formulario.map((linha) => [linha.nome, linha.total]),
  ];
  return `sep=;\r\n${linhas.map((linha) => linha.map(celulaCsv).join(';')).join('\r\n')}\r\n`;
}

// empresa_id vem SEMPRE do JWT (req.empresaId), nunca da query
rotasRelatorios.get('/captacao-leads', async (req, res, next) => {
  try {
    const filtros = esquemaFiltros.parse(req.query);
    res.json({ sucesso: true, ...(await gerarCaptacao(req.empresaId, filtros)) });
  } catch (erro) {
    next(erro);
  }
});

rotasRelatorios.get('/captacao-leads.csv', async (req, res, next) => {
  try {
    const filtros = esquemaFiltros.parse(req.query);
    const relatorio = await gerarCaptacao(req.empresaId, filtros);
    res
      .set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="captacao-leads_${filtros.de}_a_${filtros.ate}.csv"`,
        'Cache-Control': 'no-store',
        // Painel (Vercel) e API (Railway) estão em origens diferentes: sem isto o
        // navegador esconde o Content-Disposition do JavaScript
        'Access-Control-Expose-Headers': 'Content-Disposition',
      })
      .send(montarCsv(relatorio));
  } catch (erro) {
    next(erro);
  }
});
