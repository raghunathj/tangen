-- TL-1: type-level soft delete — content APIs 404 for disabled types
ALTER TABLE "object_types" ADD COLUMN IF NOT EXISTS "disabled" boolean NOT NULL DEFAULT false;
