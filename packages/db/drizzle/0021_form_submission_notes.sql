-- #50: internal admin notes per form submission (lead management)
ALTER TABLE "form_submissions" ADD COLUMN IF NOT EXISTS "notes" text;
