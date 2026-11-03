-- Tour plan items (0050): one-day or from-to plans with the DCR's day fields, approved through
-- approval_requests (entity_type 'tour_plan_item'; the column is text with no check constraint, so
-- no change there). Additive only: a new table and one nullable column on dcrs. KPI views unchanged.
CREATE TABLE IF NOT EXISTS "tour_plan_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL REFERENCES "public"."companies"("id"),
	"user_id" uuid NOT NULL REFERENCES "public"."users"("id"),
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"status" "doc_status" DEFAULT 'draft' NOT NULL,
	"plan" jsonb NOT NULL,
	"submitted_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"decided_by" uuid REFERENCES "public"."users"("id"),
	"decision_comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "tour_plan_items_range_ck" CHECK ("to_date" >= "from_date" AND "to_date" - "from_date" <= 30)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tour_plan_items_user_idx" ON "tour_plan_items" USING btree ("company_id","user_id","from_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tour_plan_items_status_idx" ON "tour_plan_items" USING btree ("company_id","status");
--> statement-breakpoint
ALTER TABLE tour_plan_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tour_plan_items FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON tour_plan_items;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON tour_plan_items TO ariforce_app USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
DROP TRIGGER IF EXISTS tour_plan_items_row_meta ON tour_plan_items;
--> statement-breakpoint
CREATE TRIGGER tour_plan_items_row_meta BEFORE UPDATE ON tour_plan_items FOR EACH ROW EXECUTE FUNCTION set_row_meta();
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON tour_plan_items TO ariforce_app;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON tour_plan_items FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON tour_plan_items FROM authenticated;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE dcrs ADD COLUMN IF NOT EXISTS tour_plan_item_id uuid REFERENCES tour_plan_items(id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dcrs_tour_plan_item_idx" ON "dcrs" USING btree ("tour_plan_item_id") WHERE "tour_plan_item_id" IS NOT NULL;
