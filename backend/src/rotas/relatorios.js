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
 * Relatório de origem: leads agrupados por utm_source + utm_campaign. Quantidades e
 * percentuais saem do servidor (RNF-62), de uma única consulta: tela e CSV nunca divergem.
 */
async function gerarOrigem(empresaId, { de, ate }) {
  const { inicio, fim } = limitesDoPeriodo(de, ate);

  // Ausente, vazio ou só espaços viram "Não informado". GROUP BY pelos apelidos garante
  // um único grupo por lead. A collation do banco (_ci) ignora maiúsculas: "Google" e
  // "google" caem no mesmo grupo. Os apelidos NÃO podem se chamar "origem": a tabela leads
  // tem uma coluna com esse nome e o GROUP BY agruparia por ela, não pela expressão.
  const [linhas] = await banco.query(
    `SELECT COALESCE(NULLIF(TRIM(l.utm_source), ''), ?) AS grupo_origem,
            COALESCE(NULLIF(TRIM(l.utm_campaign), ''), ?) AS grupo_campanha,
            COUNT(*) AS total
     FROM leads l
     WHERE l.empresa_id = ? AND l.criado_em >= FROM_UNIXTIME(?) AND l.criado_em < FROM_UNIXTIME(?)
     GROUP BY grupo_origem, grupo_campanha
     ORDER BY total DESC, grupo_origem, grupo_campanha`,
    [ROTULO_NAO_INFORMADO, ROTULO_NAO_INFORMADO, empresaId, inicio, fim]
  );

  const total = linhas.reduce((soma, linha) => soma + Number(linha.total), 0);
  const por_origem = linhas.map((linha) => {
    const quantidade = Number(linha.total);
    return {
      origem: linha.grupo_origem,
      campanha: linha.grupo_campanha,
      total: quantidade,
      // Aritmética inteira (centésimos de %): evita o erro de ponto flutuante do toFixed.
      // Com total 0 a lista é vazia e esta conta não roda (sem divisão por zero).
      percentual: Math.round((quantidade * 10000) / total) / 100,
    };
  });

  return { periodo: { de, ate }, total, por_origem };
}

/**
 * Relatório de entregas das integrações: conta registros de logs_entrega (não leads nem
 * mensagens únicas) por canal e destino. Uma única consulta: totais e grupos sempre batem.
 */
async function gerarEntregas(empresaId, { de, ate }) {
  const { inicio, fim } = limitesDoPeriodo(de, ate);

  // Apelidos "grupo_*" para não colidirem com as colunas canal/destino/sucesso da tabela
  // (GROUP BY prefere a coluna ao apelido). O destino é agrupado em collation binária:
  // reflete exatamente o valor armazenado, sem juntar "Pipedrive" com "pipedrive".
  const [linhas] = await banco.query(
    `SELECT l.canal AS grupo_canal,
            l.destino COLLATE utf8mb4_bin AS grupo_destino,
            SUM(l.sucesso <> 0) AS sucessos,
            SUM(l.sucesso = 0) AS falhas,
            COUNT(*) AS total
     FROM logs_entrega l
     WHERE l.empresa_id = ? AND l.criado_em >= FROM_UNIXTIME(?) AND l.criado_em < FROM_UNIXTIME(?)
     GROUP BY grupo_canal, grupo_destino
     ORDER BY total DESC, grupo_canal, grupo_destino`,
    [empresaId, inicio, fim]
  );

  const por_grupo = linhas.map((linha) => ({
    canal: linha.grupo_canal,
    canal_rotulo: ROTULOS_CANAL[linha.grupo_canal] ?? linha.grupo_canal,
    destino: linha.grupo_destino,
    sucessos: Number(linha.sucessos),
    falhas: Number(linha.falhas),
    total: Number(linha.total),
  }));
  const soma = (campo) => por_grupo.reduce((acc, grupo) => acc + grupo[campo], 0);

  return { periodo: { de, ate }, total: soma('total'), sucessos: soma('sucessos'), falhas: soma('falhas'), por_grupo };
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

/** Serializa as linhas: BOM + cada célula protegida + CRLF. */
const serializarCsv = (linhas) =>
  `\uFEFF${linhas.map((linha) => linha.map(celulaCsv).join(';')).join('\r\n')}\r\n`;

const periodoBr = ({ de, ate }) => `${dataBr(de)} a ${dataBr(ate)}`;

function csvCaptacao(relatorio) {
  return serializarCsv([
    ['Relatório de captação de leads'],
    ['Período', periodoBr(relatorio.periodo)],
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
  ]);
}

// Só origem, campanha, quantidade e percentual: nenhum dado pessoal do lead entra aqui
function csvOrigem(relatorio) {
  return serializarCsv([
    ['Relatório de origem dos leads'],
    ['Período', periodoBr(relatorio.periodo)],
    ['Total de leads', relatorio.total],
    [],
    ['Origem', 'Campanha', 'Quantidade', 'Percentual'],
    ...relatorio.por_origem.map((linha) => [
      linha.origem,
      linha.campanha,
      linha.total,
      `${linha.percentual.toFixed(2).replace('.', ',')}%`,
    ]),
  ]);
}

// Só contagens: detalhe, codigo_http, mensagens e credenciais nunca saem de logs_entrega
function csvEntregas(relatorio) {
  return serializarCsv([
    ['Relatório de entregas e falhas das integrações'],
    ['Período', periodoBr(relatorio.periodo)],
    ['Registros de entrega', relatorio.total],
    ['Sucessos', relatorio.sucessos],
    ['Falhas', relatorio.falhas],
    [],
    ['Canal', 'Destino', 'Sucessos', 'Falhas', 'Total'],
    ...relatorio.por_grupo.map((g) => [g.canal_rotulo, g.destino, g.sucessos, g.falhas, g.total]),
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

// empresa_id vem SEMPRE do JWT (req.empresaId), nunca da query
rotasRelatorios.get('/captacao-leads', async (req, res, next) => {
  try {
    const filtros = esquemaCaptacao.parse(req.query);
    res.json({ sucesso: true, ...(await gerarCaptacao(req.empresaId, filtros)) });
  } catch (erro) {
    next(erro);
  }
});

rotasRelatorios.get('/captacao-leads.csv', async (req, res, next) => {
  try {
    const filtros = esquemaCaptacao.parse(req.query);
    enviarCsv(res, 'captacao-leads', filtros, csvCaptacao(await gerarCaptacao(req.empresaId, filtros)));
  } catch (erro) {
    next(erro);
  }
});

rotasRelatorios.get('/origem-leads', async (req, res, next) => {
  try {
    const filtros = esquemaPeriodo.parse(req.query);
    res.json({ sucesso: true, ...(await gerarOrigem(req.empresaId, filtros)) });
  } catch (erro) {
    next(erro);
  }
});

rotasRelatorios.get('/origem-leads.csv', async (req, res, next) => {
  try {
    const filtros = esquemaPeriodo.parse(req.query);
    enviarCsv(res, 'origem-leads', filtros, csvOrigem(await gerarOrigem(req.empresaId, filtros)));
  } catch (erro) {
    next(erro);
  }
});

rotasRelatorios.get('/entregas-integracoes', async (req, res, next) => {
  try {
    const filtros = esquemaPeriodo.parse(req.query);
    res.json({ sucesso: true, ...(await gerarEntregas(req.empresaId, filtros)) });
  } catch (erro) {
    next(erro);
  }
});

rotasRelatorios.get('/entregas-integracoes.csv', async (req, res, next) => {
  try {
    const filtros = esquemaPeriodo.parse(req.query);
    enviarCsv(res, 'entregas-integracoes', filtros, csvEntregas(await gerarEntregas(req.empresaId, filtros)));
  } catch (erro) {
    next(erro);
  }
});
