-- ============================================================================
-- Seed inicial — SaaS de Captura de Leads
-- Execução: mysql ... saas_leads < db/seed.sql  (após db/schema.sql)
-- Idempotente: INSERT IGNORE (reexecutar não duplica).
-- ============================================================================

USE saas_leads;

-- ----------------------------------------------------------------------------
-- Super admin inicial
--
-- ⚠️ O hash abaixo é um PLACEHOLDER INVÁLIDO de propósito: o login NÃO
-- funciona até você gerar um hash bcrypt real e substituí-lo. Gere com:
--
--   node -e "console.log(require('bcryptjs').hashSync('SUA_SENHA_FORTE', 10))"
--
-- (rode dentro do diretório do backend, após `npm install bcryptjs`)
-- ----------------------------------------------------------------------------
INSERT IGNORE INTO super_admins (nome, email, senha_hash)
VALUES ('Administrador', 'guilherme.infocrescimento@gmail.com', '$2a$10$rZUU2XFhvhRH6U3Wr51DQ.jlA856CPXqbBg2oWhYOKXZA5JmWbkCy');

-- ----------------------------------------------------------------------------
-- (Opcional) Empresa de demonstração — descomente para ambiente de testes.
-- O usuário demo também precisa de hash bcrypt real (mesmo comando acima).
-- ----------------------------------------------------------------------------
-- INSERT IGNORE INTO empresas (nome, slug, email_contato, criado_por_admin_id)
-- VALUES ('Empresa Demo', 'demo', 'demo@saasleads.local',
--         (SELECT id FROM super_admins WHERE email = 'admin@saasleads.local'));
--
-- INSERT IGNORE INTO usuarios (empresa_id, nome, email, senha_hash, papel)
-- VALUES ((SELECT id FROM empresas WHERE slug = 'demo'),
--         'Usuário Demo', 'usuario@saasleads.local',
--         '$2b$10$SUBSTITUA_ESTE_HASH_ANTES_DE_USAR_xxxxxxxxxxxxxxxxxxxx',
--         'proprietario');
--
-- INSERT IGNORE INTO dominios_autorizados (empresa_id, dominio)
-- VALUES ((SELECT id FROM empresas WHERE slug = 'demo'), 'http://localhost:8080');
--
-- INSERT IGNORE INTO formularios (empresa_id, nome, form_key, mensagem_sucesso)
-- VALUES ((SELECT id FROM empresas WHERE slug = 'demo'),
--         'Formulário Demo', UUID(), 'Recebemos seus dados. Obrigado!');
