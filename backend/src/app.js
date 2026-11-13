import express from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import { rota404, tratadorDeErros } from './middlewares/erros.js';
import { autenticarEmpresa } from './middlewares/autenticacao.js';
import { rotasAuth } from './rotas/auth.js';
import { rotasAdmin } from './rotas/admin.js';
import { rotasCaptura } from './rotas/captura.js';
import { rotasFormularios } from './rotas/formularios.js';
import { rotasDominios } from './rotas/dominios.js';
import { rotasLeads } from './rotas/leads.js';
import { rotasCrm } from './rotas/crm.js';
import { rotasWhatsapp } from './rotas/whatsapp.js';
import { rotasRelatorios } from './rotas/relatorios.js';
import { rotasContaEmpresa } from './rotas/conta.js';

export const app = express();

// Railway roda atrás de proxy — necessário para req.ip e rate limit corretos
app.set('trust proxy', 1);
app.use(helmet());
// CORS fixo do painel (frontend no Vercel) — o CORS da captura é dinâmico, por tenant.
// Registrado antes do express.json: erro de leitura do corpo também precisa sair com CORS,
// senão o navegador esconde a resposta e o painel só enxerga "falha de rede".
app.use(['/api/auth', '/api/admin', '/api/empresa'], corsDoPainel);
app.use(express.json({ limit: '100kb' }));

function corsDoPainel(req, res, next) {
  res.set({
    'Access-Control-Allow-Origin': env.painelOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    Vary: 'Origin',
  });
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}

app.get('/api/saude', (req, res) => res.json({ sucesso: true, servico: 'saas-leads-api' }));


// Rota pública de captura (CORS dinâmico por tenant, rate limit, honeypot)
app.use('/api/captura', rotasCaptura);

// Autenticação dos painéis
app.use('/api/auth', rotasAuth);

// Painel do Super Admin
app.use('/api/admin', rotasAdmin);

// Painel da empresa — tudo abaixo exige JWT de empresa; empresa_id sai do token
app.use('/api/empresa', autenticarEmpresa);
app.use('/api/empresa/conta', rotasContaEmpresa);
app.use('/api/empresa/formularios', rotasFormularios);
app.use('/api/empresa/dominios', rotasDominios);
app.use('/api/empresa/leads', rotasLeads);
app.use('/api/empresa/crm', rotasCrm);
app.use('/api/empresa/whatsapp', rotasWhatsapp);
app.use('/api/empresa/relatorios', rotasRelatorios);

app.use(rota404);
app.use(tratadorDeErros);
