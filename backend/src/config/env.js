import 'dotenv/config';

const OBRIGATORIAS = ['DB_HOST', 'DB_USER', 'DB_NAME', 'JWT_SECRET', 'CRYPTO_KEY'];

const faltantes = OBRIGATORIAS.filter((nome) => !process.env[nome]);
if (faltantes.length > 0) {
  console.error(`[env] Variáveis obrigatórias ausentes: ${faltantes.join(', ')}. Veja .env.example.`);
  process.exit(1);
}

if (!/^[0-9a-fA-F]{64}$/.test(process.env.CRYPTO_KEY)) {
  console.error('[env] CRYPTO_KEY deve ter exatamente 64 caracteres hex (32 bytes). Veja .env.example.');
  process.exit(1);
}

export const env = {
  porta: Number(process.env.PORT || 3000),
  painelOrigin: process.env.PAINEL_ORIGIN || 'http://localhost:5173',

  db: {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME,
  },

  jwtSecret: process.env.JWT_SECRET,
  jwtExpiracao: process.env.JWT_EXPIRACAO || '8h',
  cryptoKey: Buffer.from(process.env.CRYPTO_KEY, 'hex'),

  evolution: {
    baseUrl: (process.env.EVOLUTION_BASE_URL || '').replace(/\/+$/, ''),
    apiKey: process.env.EVOLUTION_API_KEY || '',
  },

  worker: {
    ativo: process.env.WORKER_ATIVO !== 'false',
    intervaloMs: Number(process.env.WORKER_INTERVALO_MS || 3000),
    lote: Number(process.env.WORKER_LOTE || 5),
    delayEntreCrmMs: Number(process.env.WORKER_DELAY_ENTRE_CRM_MS || 3000),
  },

  captura: {
    janelaMs: Number(process.env.CAPTURA_RATE_LIMIT_JANELA_MS || 60000),
    maxPorJanela: Number(process.env.CAPTURA_RATE_LIMIT_MAX || 30),
  },
};
