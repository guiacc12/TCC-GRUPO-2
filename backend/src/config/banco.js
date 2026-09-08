import mysql from 'mysql2/promise';
import { env } from './env.js';

// Pool único da aplicação. Sempre prepared statements (?), nunca concatenar SQL.
export const banco = mysql.createPool({
  ...env.db,
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: false,
  timezone: 'Z',
});

/** Executa um callback dentro de uma transação, com commit/rollback automáticos. */
export async function emTransacao(callback) {
  const conexao = await banco.getConnection();
  try {
    await conexao.beginTransaction();
    const resultado = await callback(conexao);
    await conexao.commit();
    return resultado;
  } catch (erro) {
    await conexao.rollback();
    throw erro;
  } finally {
    conexao.release();
  }
}
