-- Expense auto-draft on DCR submit (0052). Additive only:
--  * companies.auto_expense_on_dcr_submit (default false = off for every company; turned on per
--    company by a separate data step, not in this migration)
--  * expense_lines.auto_trigger (what wrote an auto line) and expense_lines.dcr_rejected_at (flag for
--    lines whose DCR was rejected after the line was added)
--  * one live auto line per (claim, date, category): partial unique index, after a duplicate pre-check
--    that aborts the whole migration (nothing changes) if live duplicates exist.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM expense_lines
    WHERE source = 'auto' AND deleted_at IS NULL
    GROUP BY company_id, claim_id, date, category
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION '0052: live duplicate auto expense lines per (claim, date, category); soft-delete the extras first';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "auto_expense_on_dcr_submit" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "expense_lines" ADD COLUMN IF NOT EXISTS "auto_trigger" text;
--> statement-breakpoint
ALTER TABLE "expense_lines" ADD COLUMN IF NOT EXISTS "dcr_rejected_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "expense_lines" DROP CONSTRAINT IF EXISTS "expense_lines_auto_trigger_ck";
--> statement-breakpoint
ALTER TABLE "expense_lines" ADD CONSTRAINT "expense_lines_auto_trigger_ck" CHECK ("auto_trigger" IS NULL OR "auto_trigger" in ('allowances_run','dcr_submit'));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expense_lines_dcr_idx" ON "expense_lines" USING btree ("company_id","dcr_id") WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "expense_lines_auto_uq" ON "expense_lines" USING btree ("company_id","claim_id","date","category") WHERE source = 'auto' AND deleted_at IS NULL;
