-- DCR expenses (contract #121). Additive; re-runnable.
--  * dcrs.expenses: the day's expense items [{category, amount, note?}], default [] (old rows = none).
--    Linked into the month claim at DCR submit by the API (origin = 'dcr' lines, 0056).
ALTER TABLE "dcrs" ADD COLUMN IF NOT EXISTS "expenses" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "dcrs" DROP CONSTRAINT IF EXISTS "dcrs_expenses_ck";
--> statement-breakpoint
ALTER TABLE "dcrs" ADD CONSTRAINT "dcrs_expenses_ck" CHECK (jsonb_typeof("expenses") = 'array');
