-- #42 D5: field-level soft-disable — hidden from every runtime surface (admin,
-- REST, TangenQL, GraphQL); column + data preserved, fully reversible.
ALTER TABLE "fields" ADD COLUMN IF NOT EXISTS "disabled" boolean NOT NULL DEFAULT false;
