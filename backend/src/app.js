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

export const app = express();

// Railway roda atrás de proxy — necessário para req.ip e rate limit corretos
app.set('trust proxy', 1);
app.use(helmet());
app.use(express.json({ limit: '100kb' }));

// CORS fixo do painel (frontend no Vercel) — o CORS da captura é dinâmico, por tenant
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
app.use('/api/auth', corsDoPainel, rotasAuth);

// Painel do Super Admin
app.use('/api/admin', corsDoPainel, rotasAdmin);

// Painel da empresa — tudo abaixo exige JWT de empresa; empresa_id sai do token
app.use('/api/empresa', corsDoPainel, autenticarEmpresa);
app.use('/api/empresa/formularios', rotasFormularios);
app.use('/api/empresa/dominios', rotasDominios);
app.use('/api/empresa/leads', rotasLeads);
app.use('/api/empresa/crm', rotasCrm);
app.use('/api/empresa/whatsapp', rotasWhatsapp);

app.use(rota404);
app.use(tratadorDeErros);
