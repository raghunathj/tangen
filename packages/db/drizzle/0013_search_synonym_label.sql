-- Search synonyms: a human title/label per group so marketing knows its purpose.
ALTER TABLE search_synonyms ADD COLUMN IF NOT EXISTS label text;
