-- Day remarks on a DCR. Separate from the remarks stored on each visit.
ALTER TABLE dcrs ADD COLUMN IF NOT EXISTS remarks text;
