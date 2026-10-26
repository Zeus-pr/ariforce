-- GENERATED from packages/db/drizzle/0013_dcr_detail.sql by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '0013_dcr_detail') THEN
    RAISE NOTICE 'skip 0013_dcr_detail (already applied)';
    RETURN;
  END IF;
  EXECUTE $ariforce_stmt$ALTER TABLE "dcr_calls" ADD COLUMN "joint_work_user_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "dcrs" ADD COLUMN "territory_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "dcrs" ADD COLUMN "tour_plan_id" uuid;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE "dcrs" ADD CONSTRAINT "dcrs_tour_plan_id_tour_plans_id_fk" FOREIGN KEY ("tour_plan_id") REFERENCES "public"."tour_plans"("id") ON DELETE no action ON UPDATE no action;$ariforce_stmt$;
  INSERT INTO public.ariforce_migrations (name) VALUES ('0013_dcr_detail');
END
$ariforce_migration$;
COMMIT;
