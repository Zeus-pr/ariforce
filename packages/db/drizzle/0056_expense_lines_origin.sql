-- Expense line origin + DCR link (contract #121). Additive; re-runnable.
--  * expense_lines.origin: manual | ta_da | dcr (default manual). Backfill: live or deleted lines
--    with source = 'auto' become ta_da (only rows still at the default, so a re-run changes 0).
--  * expense_lines.dcr_item_index: position of the item in dcrs.expenses for origin = 'dcr' lines.
--  * expense_lines_dcr_item_uq: one live line per (DCR, item) -> a resubmit can never duplicate.
--  * expense_lines_auto_uq (0052) is rebuilt to leave out origin = 'dcr' lines (several food
--    items on one day are allowed; TA/DA keeps one auto line per claim, day and category).
--    Drop + create run in one transaction; the index is briefly rebuilt (SHARE lock on writes).
ALTER TABLE "expense_lines" ADD COLUMN IF NOT EXISTS "origin" text DEFAULT 'manual' NOT NULL;
--> statement-breakpoint
ALTER TABLE "expense_lines" ADD COLUMN IF NOT EXISTS "dcr_item_index" integer;
--> statement-breakpoint
UPDATE "expense_lines" SET "origin" = 'ta_da' WHERE "source" = 'auto' AND "origin" = 'manual';
--> statement-breakpoint
ALTER TABLE "expense_lines" DROP CONSTRAINT IF EXISTS "expense_lines_origin_ck";
--> statement-breakpoint
ALTER TABLE "expense_lines" ADD CONSTRAINT "expense_lines_origin_ck" CHECK ("origin" in ('manual','ta_da','dcr') AND ("origin" = 'dcr') = ("dcr_item_index" IS NOT NULL) AND ("origin" <> 'dcr' OR "dcr_id" IS NOT NULL));
--> statement-breakpoint
DROP INDEX IF EXISTS "expense_lines_auto_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "expense_lines_auto_uq" ON "expense_lines" USING btree ("company_id","claim_id","date","category") WHERE source = 'auto' AND origin <> 'dcr' AND deleted_at IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "expense_lines_dcr_item_uq" ON "expense_lines" USING btree ("company_id","dcr_id","dcr_item_index") WHERE origin = 'dcr' AND deleted_at IS NULL;
