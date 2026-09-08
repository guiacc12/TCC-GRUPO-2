# LeadFlow — SaaS de Captura de Leads e Roteamento (WhatsApp + CRM)

Plataforma multi-tenant que gera formulários de captura nativos (sem iframe), roteia os leads pro CRM da empresa (Pipedrive, PipeRun ou LeadPass/GoHighLevel) e dispara automações de WhatsApp via Evolution API.

- **Backend**: Node.js + Express, MySQL via `mysql2/promise` (sem ORM). Schema único em [`db/schema.sql`](db/schema.sql).
- **Frontend**: React (Vite) + Tailwind, painéis Admin e Empresa.

## Pré-requisitos

- Node.js 20+
- [XAMPP](https://www.apachefriends.org/) (ou qualquer MySQL 8 / MariaDB local em `127.0.0.1:3306`)

## 1. Banco de dados (XAMPP)

Abre o painel de controle do XAMPP e sobe só o módulo **MySQL** (porta padrão 3306, usuário `root`, sem senha).

```bash
# Mac (ajuste o caminho se instalou em outro lugar)
/Applications/XAMPP/xamppfiles/bin/mysql -uroot < db/schema.sql
```

Isso cria o banco `saas_leads` com as 12 tabelas já no estado final (não existem migrations neste projeto — qualquer mudança de schema é editada direto em `db/schema.sql`).

### Seed do Super Admin

`db/seed.sql` vem com um hash de senha placeholder inválido de propósito. Gera um hash real:

```bash
cd backend
node -e "console.log(require('bcryptjs').hashSync('SUA_SENHA_AQUI', 10))"
```

Cola o hash gerado em `db/seed.sql` (substitui o hash da linha do `INSERT IGNORE INTO super_admins`), troque o e-mail se quiser, depois:

```bash
/Applications/XAMPP/xamppfiles/bin/mysql -uroot saas_leads < db/seed.sql
```

## 2. Backend

```bash
cd backend
npm install
cp .env.example .env
```

Edita `backend/.env` e preenche `JWT_SECRET` e `CRYPTO_KEY` (comandos de geração já estão comentados no próprio `.env.example`). Os dados de `DB_*` já vêm certos pro XAMPP padrão.

```bash
npm run dev   # http://localhost:3210
```

`EVOLUTION_BASE_URL`/`EVOLUTION_API_KEY` podem ficar em branco por enquanto — só as rotas de WhatsApp vão dar erro; o resto (leads, formulários, CRM) funciona sem isso.

## 3. Frontend

```bash
cd frontend
npm install
npm run dev   # http://localhost:5173
```

Não precisa configurar `.env` em dev: o Vite já faz proxy de `/api` pro backend em `127.0.0.1:3210` ([`vite.config.js`](frontend/vite.config.js)).

## 4. Acessar

- Painel da empresa: `http://localhost:5173/login`
- Painel Super Admin: `http://localhost:5173/admin/login` (e-mail/senha do seed)

## Estrutura do repositório

```
backend/   API Express — rotas, serviços (adapters de CRM, orquestrador Evolution, fila), utilitários
frontend/  Painéis Admin e Empresa (React/Vite/Tailwind)
db/        schema.sql (estado único do banco) + seed.sql
```
