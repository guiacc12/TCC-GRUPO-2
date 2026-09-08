import { env } from './config/env.js';
import { banco } from './config/banco.js';
import { app } from './app.js';
import { iniciarWorker, pararWorker } from './servicos/fila.js';
import { logger } from './util/logger.js';

// Valida a conexão com o MySQL antes de aceitar tráfego
try {
  await banco.query('SELECT 1');
} catch (erro) {
  logger.erro('falha ao conectar no MySQL — verifique as variáveis DB_*', { erro: erro.message });
  process.exit(1);
}

const servidor = app.listen(env.porta, () => {
  logger.info('API no ar', { porta: env.porta });
});

if (env.worker.ativo) iniciarWorker();

// Encerramento gracioso (Railway envia SIGTERM em deploys)
function encerrar(sinal) {
  logger.info('encerrando', { sinal });
  pararWorker();
  servidor.close(async () => {
    await banco.end().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => encerrar('SIGTERM'));
process.on('SIGINT', () => encerrar('SIGINT'));
