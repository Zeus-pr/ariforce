CREATE TABLE "standard_tour_plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"days" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tour_plans" ADD COLUMN "days" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tour_plans" ADD COLUMN "decision_comment" text;--> statement-breakpoint
ALTER TABLE "standard_tour_plans" ADD CONSTRAINT "standard_tour_plans_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standard_tour_plans" ADD CONSTRAINT "standard_tour_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "standard_tour_plans_user_uq" ON "standard_tour_plans" USING btree ("company_id","user_id");--> statement-breakpoint
ALTER TABLE standard_tour_plans ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE standard_tour_plans FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON standard_tour_plans TO ariforce_app USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());--> statement-breakpoint
CREATE TRIGGER standard_tour_plans_row_meta BEFORE UPDATE ON standard_tour_plans FOR EACH ROW EXECUTE FUNCTION set_row_meta();--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON standard_tour_plans TO ariforce_app;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON standard_tour_plans FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON standard_tour_plans FROM authenticated;
  END IF;
END $$;
