-- GENERATED from packages/db/drizzle/0037_tour_plan_submissions.sql by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '0037_tour_plan_submissions') THEN
    RAISE NOTICE 'skip 0037_tour_plan_submissions (already applied)';
    RETURN;
  END IF;
  EXECUTE $ariforce_stmt$CREATE TABLE IF NOT EXISTS "tour_plan_submissions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"tour_plan_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"dates" date[] NOT NULL,
	"status" "doc_status" DEFAULT 'submitted' NOT NULL,
	"submitter_note" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"decision_comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "tour_plan_submissions_dates_ck" CHECK (cardinality("tour_plan_submissions"."dates") >= 1)
);$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DO $$ BEGIN ALTER TABLE "tour_plan_submissions" ADD CONSTRAINT "tour_plan_submissions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DO $$ BEGIN ALTER TABLE "tour_plan_submissions" ADD CONSTRAINT "tour_plan_submissions_tour_plan_id_tour_plans_id_fk" FOREIGN KEY ("tour_plan_id") REFERENCES "public"."tour_plans"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DO $$ BEGIN ALTER TABLE "tour_plan_submissions" ADD CONSTRAINT "tour_plan_submissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DO $$ BEGIN ALTER TABLE "tour_plan_submissions" ADD CONSTRAINT "tour_plan_submissions_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE INDEX IF NOT EXISTS "tour_plan_submissions_plan_idx" ON "tour_plan_submissions" USING btree ("company_id","tour_plan_id");$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE tour_plan_submissions ENABLE ROW LEVEL SECURITY;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$ALTER TABLE tour_plan_submissions FORCE ROW LEVEL SECURITY;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DROP POLICY IF EXISTS tenant_isolation ON tour_plan_submissions;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE POLICY tenant_isolation ON tour_plan_submissions TO ariforce_app USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DROP TRIGGER IF EXISTS tour_plan_submissions_row_meta ON tour_plan_submissions;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE TRIGGER tour_plan_submissions_row_meta BEFORE UPDATE ON tour_plan_submissions FOR EACH ROW EXECUTE FUNCTION set_row_meta();$ariforce_stmt$;
  EXECUTE $ariforce_stmt$GRANT SELECT, INSERT, UPDATE ON tour_plan_submissions TO ariforce_app;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$-- #86 backfill: every submitted/approved/rejected month plan becomes one submission holding its
-- planned days (same status, decision and note). Its latest approval request now points at the
-- submission (entity_id) and carries planId/submissionId/dates in payload. Older requests keep the
-- plan id. Plans with no planned day get no submission. Skips plans that already have one.
DO $$
DECLARE r record; sid uuid; ds date[];
BEGIN
  FOR r IN SELECT * FROM tour_plans tp WHERE tp.deleted_at IS NULL
      AND tp.status IN ('submitted', 'approved', 'rejected')
      AND NOT EXISTS (SELECT 1 FROM tour_plan_submissions s WHERE s.tour_plan_id = tp.id)
  LOOP
    SELECT array_agg((d->>'date')::date ORDER BY (d->>'date')::date) INTO ds
      FROM jsonb_array_elements(r.days) d WHERE jsonb_array_length(coalesce(d->'entries', '[]'::jsonb)) > 0;
    CONTINUE WHEN ds IS NULL;
    sid := gen_random_uuid();
    INSERT INTO tour_plan_submissions (id, company_id, tour_plan_id, user_id, dates, status, submitter_note,
        submitted_at, decided_at, decided_by, decision_comment)
      VALUES (sid, r.company_id, r.id, r.user_id, ds, r.status, r.submitter_note,
        coalesce(r.submitted_at, r.updated_at), r.decided_at, r.decided_by, r.decision_comment);
    UPDATE approval_requests ar SET entity_id = sid,
        payload = coalesce(ar.payload, '{}'::jsonb) || jsonb_build_object('planId', r.id, 'submissionId', sid, 'dates', to_jsonb(ds))
      WHERE ar.id = (SELECT a2.id FROM approval_requests a2 WHERE a2.entity_type = 'tour_plan'
        AND a2.entity_id = r.id ORDER BY a2.created_at DESC LIMIT 1);
  END LOOP;
END $$;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON tour_plan_submissions FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON tour_plan_submissions FROM authenticated;
  END IF;
END $$;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$-- #86: adherence counts approved days only (approved submissions; pre-#86 plans: approved plan).
CREATE OR REPLACE VIEW kpi_tp_adherence_month WITH (security_invoker = true) AS
WITH v AS (
  SELECT v.*, tp.user_id FROM tour_plans tp
  JOIN tour_plan_visits v ON v.tour_plan_id = tp.id AND v.deleted_at IS NULL
  WHERE tp.deleted_at IS NULL AND (
    EXISTS (SELECT 1 FROM tour_plan_submissions ts WHERE ts.tour_plan_id = tp.id
      AND ts.deleted_at IS NULL AND ts.status = 'approved' AND v.date = ANY (ts.dates))
    OR (tp.status = 'approved' AND NOT EXISTS (SELECT 1 FROM tour_plan_submissions ts2
      WHERE ts2.tour_plan_id = tp.id AND ts2.deleted_at IS NULL)))
)
SELECT tp.company_id, tp.user_id, tp.month,
  count(v.id) AS planned_visits,
  count(v.id) FILTER (WHERE EXISTS (
    SELECT 1 FROM dcr_calls c WHERE c.user_id = tp.user_id AND c.date = v.date
      AND c.outlet_kind = v.outlet_kind AND c.outlet_id = v.outlet_id AND c.deleted_at IS NULL
  )) AS planned_visits_met,
  round(100.0 * count(v.id) FILTER (WHERE EXISTS (
    SELECT 1 FROM dcr_calls c WHERE c.user_id = tp.user_id AND c.date = v.date
      AND c.outlet_kind = v.outlet_kind AND c.outlet_id = v.outlet_id AND c.deleted_at IS NULL
  )) / nullif(count(v.id), 0), 1) AS adherence_pct
FROM tour_plans tp
LEFT JOIN v ON v.tour_plan_id = tp.id
WHERE tp.deleted_at IS NULL AND (tp.status = 'approved' OR EXISTS (
  SELECT 1 FROM tour_plan_submissions ts WHERE ts.tour_plan_id = tp.id
    AND ts.deleted_at IS NULL AND ts.status = 'approved'))
GROUP BY tp.company_id, tp.user_id, tp.month;$ariforce_stmt$;
  INSERT INTO public.ariforce_migrations (name) VALUES ('0037_tour_plan_submissions');
END
$ariforce_migration$;
COMMIT;
