-- Site users leaves core (tasks/plan-core-slimming.md S4, 2026-09-13): the
-- four auth tables belong to @tangen/ext-auth, whose migrations create them
-- where the extension is installed. Nothing outside this repository holds
-- site user data yet, so the core copies are dropped rather than migrated.
DROP TABLE IF EXISTS "auth_identities" CASCADE;
DROP TABLE IF EXISTS "auth_sso_accounts" CASCADE;
DROP TABLE IF EXISTS "auth_sessions" CASCADE;
DROP TABLE IF EXISTS "auth_users" CASCADE;
