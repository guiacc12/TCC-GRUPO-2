-- ============================================================================
-- SaaS de Captura de Leads e Roteamento (WhatsApp + CRM)
-- Schema MySQL 8 (modelagem documentada em docs/modelagem.md)
--
-- Estado final único: já inclui tudo que antes estava espalhado nas
-- migrations 002-007 (mapeamentos de CRM, LeadPass, índices de performance).
-- Não existem mais arquivos de migration neste projeto — qualquer alteração
-- de schema daqui pra frente deve ser editada direto aqui.
--
-- Execução local : mysql -h127.0.0.1 -uroot -p < db/schema.sql
-- Railway        : o serviço MySQL já cria um banco (ex.: "railway").
--                  Nesse caso, remova/ajuste o CREATE DATABASE + USE abaixo
--                  ou rode: mysql ... railway < db/schema.sql (sem as 2 linhas).
--
-- Convenções:
--  - InnoDB, utf8mb4/utf8mb4_unicode_ci, snake_case em português.
--  - Toda tabela de dados do tenant carrega empresa_id (isolamento em 1 hop).
--  - Idempotente: CREATE TABLE IF NOT EXISTS.
-- ============================================================================

CREATE DATABASE IF NOT EXISTS saas_leads
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
USE saas_leads;

SET NAMES utf8mb4;

-- ============================================================================
-- 1. ACESSO E TENANTS
-- ============================================================================

-- Operadores do SaaS. Fora do espaço dos tenants: nunca possuem empresa_id.
CREATE TABLE IF NOT EXISTS super_admins (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nome          VARCHAR(160)    NOT NULL,
  email         VARCHAR(160)    NOT NULL,
  senha_hash    VARCHAR(255)    NOT NULL COMMENT 'bcrypt',
  ativo         TINYINT(1)      NOT NULL DEFAULT 1,
  criado_em     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_super_admins_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Operadores do SaaS (criam/suspendem empresas)';

-- Tenants. Suspensão é via status (nunca DELETE em produção — cascateia tudo).
CREATE TABLE IF NOT EXISTS empresas (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nome                VARCHAR(160)    NOT NULL,
  slug                VARCHAR(80)     NOT NULL COMMENT 'identificador curto, usado no instance_name das instâncias WhatsApp',
  email_contato       VARCHAR(160)    NULL,
  status              ENUM('ativa','suspensa','cancelada') NOT NULL DEFAULT 'ativa',
  criado_por_admin_id BIGINT UNSIGNED NULL,
  criado_em           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_empresas_slug (slug),
  KEY idx_empresas_status (status),
  CONSTRAINT fk_empresas_criado_por
    FOREIGN KEY (criado_por_admin_id) REFERENCES super_admins (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Tenants do SaaS';

-- Logins do painel da empresa. Email único GLOBAL: login só com email+senha,
-- sem precisar informar a empresa; empresa_id vai dentro do JWT.
CREATE TABLE IF NOT EXISTS usuarios (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  empresa_id      BIGINT UNSIGNED NOT NULL,
  nome            VARCHAR(160)    NOT NULL,
  email           VARCHAR(160)    NOT NULL,
  senha_hash      VARCHAR(255)    NOT NULL COMMENT 'bcrypt',
  papel           ENUM('proprietario','membro') NOT NULL DEFAULT 'membro',
  ativo           TINYINT(1)      NOT NULL DEFAULT 1,
  ultimo_login_em DATETIME        NULL,
  criado_em       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_usuarios_email (email),
  KEY idx_usuarios_empresa (empresa_id),
  CONSTRAINT fk_usuarios_empresa
    FOREIGN KEY (empresa_id) REFERENCES empresas (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Usuários do painel da empresa';

-- Origins liberados no CORS do endpoint público de captura.
CREATE TABLE IF NOT EXISTS dominios_autorizados (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  empresa_id BIGINT UNSIGNED NOT NULL,
  dominio    VARCHAR(255)    NOT NULL COMMENT 'origin normalizado, ex. https://cliente.com.br (sem barra final)',
  criado_em  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_dominios_empresa_dominio (empresa_id, dominio),
  CONSTRAINT fk_dominios_empresa
    FOREIGN KEY (empresa_id) REFERENCES empresas (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Domínios liberados no CORS da captura pública';

-- ============================================================================
-- 2. FORMULÁRIOS
-- ============================================================================

CREATE TABLE IF NOT EXISTS formularios (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  empresa_id       BIGINT UNSIGNED NOT NULL,
  nome             VARCHAR(160)    NOT NULL,
  form_key         CHAR(36)        NOT NULL COMMENT 'UUID público — única credencial exigida no endpoint de captura',
  mensagem_sucesso VARCHAR(255)    NULL,
  redirect_url     VARCHAR(500)    NULL COMMENT 'se preenchido, o embed redireciona após o envio',
  ativo            TINYINT(1)      NOT NULL DEFAULT 1,
  origem           VARCHAR(160)    NULL COMMENT 'origem padrão dos leads deste formulário (ex.: Facebook Ads)',
  tags             JSON            NULL COMMENT 'tags padrão aplicadas aos leads deste formulário',
  mapeamentos_fixos_crm JSON       NULL COMMENT 'valores fixos aplicados ao CRM primário: [{campo, valor, rotulo}] (até 20)',
  mapeamentos_utm_crm   JSON       NULL COMMENT 'mapeamento de UTMs para campos do CRM primário: [{utm_param, campo}] (até 10)',
  leadpass_tags         JSON       NULL COMMENT 'IDs de tags do GHL aplicadas automaticamente nos leads deste formulário (até 50)',
  leadpass_campos_fixos JSON       NULL COMMENT 'lista de campos fixos do LeadPass: [{tipo, campo, origem, valor, campo_origem}] (até 20)',
  criado_em        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_formularios_form_key (form_key),
  KEY idx_formularios_empresa (empresa_id),
  KEY idx_formularios_empresa_ativo (empresa_id, ativo),
  CONSTRAINT fk_formularios_empresa
    FOREIGN KEY (empresa_id) REFERENCES empresas (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Formulários de captura criados no painel';

-- Campos dinâmicos do formulário. "papel" diz ao roteador qual campo é o
-- nome/email/telefone do lead, independente do atributo name escolhido.
CREATE TABLE IF NOT EXISTS formulario_campos (
  id            BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  formulario_id BIGINT UNSIGNED  NOT NULL,
  nome_campo    VARCHAR(80)      NOT NULL COMMENT 'atributo name no HTML / chave no payload',
  rotulo        VARCHAR(160)     NOT NULL,
  tipo          ENUM('texto','email','telefone','textarea','select','checkbox','numero','data','oculto') NOT NULL DEFAULT 'texto',
  papel         ENUM('nome','email','telefone','personalizado') NOT NULL DEFAULT 'personalizado',
  obrigatorio   TINYINT(1)       NOT NULL DEFAULT 0,
  placeholder   VARCHAR(160)     NULL,
  opcoes_json   JSON             NULL COMMENT 'opções para tipo=select',
  mapeamento_crm JSON            NULL COMMENT 'lista de destinos no CRM (até 5): formato entidade:chave por item, ex. ["person:email"]',
  ordem         SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  criado_em     TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_campos_formulario_nome (formulario_id, nome_campo),
  CONSTRAINT fk_campos_formulario
    FOREIGN KEY (formulario_id) REFERENCES formularios (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Campos renderizados pelo embed de cada formulário';

-- ============================================================================
-- 3. LEADS (fonte da verdade — o lead nunca se perde, mesmo com CRM fora do ar)
-- ============================================================================

CREATE TABLE IF NOT EXISTS leads (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  empresa_id      BIGINT UNSIGNED NOT NULL,
  formulario_id   BIGINT UNSIGNED NULL COMMENT 'SET NULL: apagar o formulário não apaga o lead',
  origem          VARCHAR(160)    NULL COMMENT 'origem herdada do formulário no momento da captura',
  tags            JSON            NULL COMMENT 'tags herdadas do formulário no momento da captura',
  nome            VARCHAR(160)    NULL,
  email           VARCHAR(160)    NULL,
  telefone        VARCHAR(20)     NULL COMMENT 'normalizado: DDI 55, somente dígitos',
  whatsapp_jid    VARCHAR(64)     NULL COMMENT 'JID validado via /chat/whatsappNumbers, reusado nos envios',
  dados_json      JSON            NOT NULL COMMENT 'payload completo submetido pelo embed',
  utm_source      VARCHAR(255)    NULL,
  utm_medium      VARCHAR(255)    NULL,
  utm_campaign    VARCHAR(255)    NULL,
  utm_term        VARCHAR(255)    NULL,
  utm_content     VARCHAR(255)    NULL,
  referrer        VARCHAR(500)    NULL,
  landing_page    VARCHAR(500)    NULL,
  ip_origem       VARCHAR(45)     NULL,
  user_agent      VARCHAR(255)    NULL,
  status          ENUM('novo','processando','entregue','erro') NOT NULL DEFAULT 'novo'
                  COMMENT 'visão consolidada do painel; detalhe por canal fica em logs_entrega',
  crm_id_externo  VARCHAR(64)     NULL COMMENT 'id da pessoa/negócio criado no CRM',
  criado_em       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_leads_empresa_criado (empresa_id, criado_em),
  KEY idx_leads_empresa_status_criado (empresa_id, status, criado_em),
  KEY idx_leads_empresa_formulario (empresa_id, formulario_id),
  KEY idx_leads_empresa_status (empresa_id, status),
  KEY idx_leads_empresa_utm_source (empresa_id, utm_source),
  KEY idx_leads_empresa_origem (empresa_id, origem),
  KEY idx_leads_email (email),
  KEY idx_leads_telefone (telefone),
  CONSTRAINT fk_leads_empresa
    FOREIGN KEY (empresa_id) REFERENCES empresas (id) ON DELETE CASCADE,
  CONSTRAINT fk_leads_formulario
    FOREIGN KEY (formulario_id) REFERENCES formularios (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Leads capturados (UTMs em colunas dedicadas)';

-- ============================================================================
-- 4. INTEGRAÇÕES (CRM + WhatsApp)
-- ============================================================================

-- Credenciais e destino do roteador de CRM (padrão Adapter).
-- "credenciais" = JSON cifrado AES-256-GCM (iv:tag:ciphertext em base64,
-- chave em env CRYPTO_KEY). Nunca gravar token em texto puro.
CREATE TABLE IF NOT EXISTS crm_configuracoes (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  empresa_id      BIGINT UNSIGNED NOT NULL,
  tipo_crm        ENUM('pipedrive','piperun','leadpass') NOT NULL,
  nome            VARCHAR(120)    NOT NULL COMMENT 'rótulo exibido no painel',
  credenciais     TEXT            NOT NULL COMMENT 'JSON cifrado AES-256-GCM: api_token (Pipedrive), token (PipeRun)...',
  config_json     JSON            NULL COMMENT 'parte não sensível: company_domain (Pipedrive), pipeline_id, stage_id, owner_id',
  ativo           TINYINT(1)      NOT NULL DEFAULT 1 COMMENT 'regra de aplicação: 1 configuração ativa por empresa',
  ultimo_teste_em DATETIME        NULL,
  ultimo_teste_ok TINYINT(1)      NULL COMMENT 'resultado do último testConnection()',
  criado_em       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_crm_empresa_ativo (empresa_id, ativo),
  CONSTRAINT fk_crm_empresa
    FOREIGN KEY (empresa_id) REFERENCES empresas (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Configurações de CRM por tenant (credenciais cifradas)';

-- Espelho das instâncias Evolution. instance_name é namespace ÚNICO GLOBAL
-- na Evolution — gerado como emp{empresa_id}_{slug}. O token (hash.apikey da
-- resposta do POST /instance/create) fica cifrado mas é decifrável, pois o
-- painel o exibe para o cliente plugar no próprio n8n.
CREATE TABLE IF NOT EXISTS whatsapp_instancias (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  empresa_id           BIGINT UNSIGNED NOT NULL,
  instance_name        VARCHAR(100)    NOT NULL,
  instance_id          VARCHAR(64)     NULL COMMENT 'instanceId devolvido pela Evolution',
  token_criptografado  TEXT            NOT NULL COMMENT 'hash.apikey cifrado AES-256-GCM (recuperável p/ exibição no painel)',
  numero               VARCHAR(20)     NULL COMMENT 'número dono da instância, com DDI',
  status_conexao       ENUM('desconectada','conectando','conectada') NOT NULL DEFAULT 'desconectada'
                       COMMENT 'mapeia connectionState da Evolution: close/connecting/open',
  qrcode_base64        MEDIUMTEXT      NULL COMMENT 'último QR emitido (evento QRCODE_UPDATED), para re-render no painel',
  qrcode_atualizado_em DATETIME        NULL,
  criado_em            TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_instancias_instance_name (instance_name),
  KEY idx_instancias_empresa (empresa_id),
  CONSTRAINT fk_instancias_empresa
    FOREIGN KEY (empresa_id) REFERENCES empresas (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Instâncias WhatsApp (Evolution API) por tenant';

-- Disparos pós-CRM. formulario_id NULL = vale para todos os formulários.
CREATE TABLE IF NOT EXISTS whatsapp_automacoes (
  id                 BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  empresa_id         BIGINT UNSIGNED  NOT NULL,
  instancia_id       BIGINT UNSIGNED  NOT NULL,
  formulario_id      BIGINT UNSIGNED  NULL,
  tipo_destino       ENUM('contato_lead','grupo') NOT NULL,
  grupo_jid          VARCHAR(64)      NULL COMMENT 'JID ...@g.us escolhido via GET /group/fetchAllGroups',
  grupo_nome         VARCHAR(160)     NULL COMMENT 'cache do nome do grupo para exibição',
  mensagem_template  TEXT             NOT NULL COMMENT 'placeholders: {{nome}}, {{telefone}}, {{utm_source}}...',
  delay_segundos_min SMALLINT UNSIGNED NOT NULL DEFAULT 2,
  delay_segundos_max SMALLINT UNSIGNED NOT NULL DEFAULT 8 COMMENT 'delay humanizado sorteado no intervalo',
  ordem              SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  ativo              TINYINT(1)       NOT NULL DEFAULT 1,
  criado_em          TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_automacoes_empresa_ativo (empresa_id, ativo),
  KEY idx_automacoes_formulario (formulario_id),
  KEY idx_automacoes_instancia (instancia_id),
  CONSTRAINT fk_automacoes_empresa
    FOREIGN KEY (empresa_id) REFERENCES empresas (id) ON DELETE CASCADE,
  CONSTRAINT fk_automacoes_instancia
    FOREIGN KEY (instancia_id) REFERENCES whatsapp_instancias (id) ON DELETE CASCADE,
  CONSTRAINT fk_automacoes_formulario
    FOREIGN KEY (formulario_id) REFERENCES formularios (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Automações de mensagem disparadas após o lead entrar no CRM';

-- ============================================================================
-- 5. FILA E AUDITORIA
-- ============================================================================

-- Fila assíncrona em MySQL (worker com retry/backoff exponencial).
-- O endpoint público responde 2xx assim que o lead + job estão gravados.
CREATE TABLE IF NOT EXISTS lead_jobs (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  empresa_id           BIGINT UNSIGNED NOT NULL,
  lead_id              BIGINT UNSIGNED NOT NULL,
  automacao_id         BIGINT UNSIGNED NULL COMMENT 'preenchido nos jobs tipo=enviar_whatsapp',
  tipo                 ENUM('rotear_crm','enviar_whatsapp') NOT NULL,
  status               ENUM('pendente','processando','sucesso','erro','cancelado') NOT NULL DEFAULT 'pendente',
  tentativas           TINYINT UNSIGNED NOT NULL DEFAULT 0,
  max_tentativas       TINYINT UNSIGNED NOT NULL DEFAULT 5,
  proxima_tentativa_em DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ultimo_erro          TEXT            NULL,
  criado_em            TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_jobs_polling (status, proxima_tentativa_em) COMMENT 'índice do polling do worker',
  KEY idx_jobs_polling_tipo (status, tipo, proxima_tentativa_em) COMMENT 'polling por tipo de job',
  KEY idx_jobs_lead (lead_id),
  KEY idx_jobs_empresa (empresa_id),
  KEY idx_jobs_automacao (automacao_id),
  CONSTRAINT fk_jobs_empresa
    FOREIGN KEY (empresa_id) REFERENCES empresas (id) ON DELETE CASCADE,
  CONSTRAINT fk_jobs_lead
    FOREIGN KEY (lead_id) REFERENCES leads (id) ON DELETE CASCADE,
  CONSTRAINT fk_jobs_automacao
    FOREIGN KEY (automacao_id) REFERENCES whatsapp_automacoes (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Fila de processamento assíncrono (roteamento CRM + envios WhatsApp)';

-- Trilha de auditoria exibida no painel: cada tentativa de entrega
-- (lead → CRM → WhatsApp) gera um registro, com sucesso ou erro.
CREATE TABLE IF NOT EXISTS logs_entrega (
  id          BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  empresa_id  BIGINT UNSIGNED  NOT NULL,
  lead_id     BIGINT UNSIGNED  NOT NULL,
  job_id      BIGINT UNSIGNED  NULL,
  canal       ENUM('crm','whatsapp_contato','whatsapp_grupo') NOT NULL,
  destino     VARCHAR(160)     NOT NULL COMMENT 'ex.: pipedrive, nome da instância, nome do grupo',
  sucesso     TINYINT(1)       NOT NULL,
  codigo_http SMALLINT UNSIGNED NULL,
  detalhe     TEXT             NULL COMMENT 'mensagem de erro ou resumo da resposta',
  criado_em   TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_logs_empresa_criado (empresa_id, criado_em),
  KEY idx_logs_empresa_sucesso_criado (empresa_id, sucesso, criado_em),
  KEY idx_logs_lead (lead_id),
  KEY idx_logs_job (job_id),
  CONSTRAINT fk_logs_empresa
    FOREIGN KEY (empresa_id) REFERENCES empresas (id) ON DELETE CASCADE,
  CONSTRAINT fk_logs_lead
    FOREIGN KEY (lead_id) REFERENCES leads (id) ON DELETE CASCADE,
  CONSTRAINT fk_logs_job
    FOREIGN KEY (job_id) REFERENCES lead_jobs (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Auditoria de entregas por canal (lead → CRM → WhatsApp)';
