-- DCR manager review + doctor presentation (0048). Additive only; RLS, triggers, indexes and the
-- KPI views are unchanged:
-- * doc_status already has 'rejected'. dcrs_user_date_submitted_uq stays WHERE status IN
--   ('submitted','approved'), so a rejected report is outside it and the day can be filed again.
-- * kpi_user_day / dcr_day_calls (0046) already count only submitted/approved, so rejected reports
--   drop out of KPIs, missed-DCR flags and exceptions without a view change; the POB views sum the
--   stored dcr_call_products.value (priced by the API at save time, now at PTS), so no view reads
--   products.ptr.
ALTER TABLE dcrs ADD COLUMN IF NOT EXISTS approved_at timestamptz;
--> statement-breakpoint
ALTER TABLE dcrs ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE dcrs ADD COLUMN IF NOT EXISTS rejected_at timestamptz;
--> statement-breakpoint
ALTER TABLE dcrs ADD COLUMN IF NOT EXISTS rejected_by uuid REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE dcrs ADD COLUMN IF NOT EXISTS rejection_reason text;
--> statement-breakpoint
ALTER TABLE dcrs DROP CONSTRAINT IF EXISTS dcrs_rejected_ck;
--> statement-breakpoint
ALTER TABLE dcrs ADD CONSTRAINT dcrs_rejected_ck CHECK (status <> 'rejected' OR (rejected_at IS NOT NULL AND rejected_by IS NOT NULL AND length(rejection_reason) BETWEEN 1 AND 500));
--> statement-breakpoint
ALTER TABLE dcr_calls ADD COLUMN IF NOT EXISTS presentation_opened_at timestamptz;
