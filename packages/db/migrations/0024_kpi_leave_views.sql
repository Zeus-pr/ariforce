-- GENERATED from packages/db/drizzle/0024_kpi_leave_views.sql by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '0024_kpi_leave_views') THEN
    RAISE NOTICE 'skip 0024_kpi_leave_views (already applied)';
    RETURN;
  END IF;
  EXECUTE $ariforce_stmt$-- Leave (#51): approved leave per user per day for attendance/KPIs, so a leave day without a DCR
-- counts as an off day (not a missed working day). security_invoker: the caller's RLS applies.
-- Weekly-off days of the company (leave_settings.weekly_off_days) are not leave days.
-- fraction = 1 for a full day, 0.5 for a half day. Re-runnable (CREATE OR REPLACE).
CREATE OR REPLACE VIEW kpi_user_leave_day WITH (security_invoker = true) AS
SELECT r.company_id, r.user_id, g.d::date AS date, p.code AS leave_type_code, r.id AS leave_request_id,
  r.half, CASE WHEN r.half IS NULL THEN 1.0 ELSE 0.5 END::numeric(2, 1) AS fraction
FROM leave_requests r
JOIN leave_policies p ON p.id = r.policy_id
LEFT JOIN leave_settings s ON s.company_id = r.company_id AND s.deleted_at IS NULL
CROSS JOIN LATERAL generate_series(r.from_date::timestamp, r.to_date::timestamp, interval '1 day') AS g(d)
WHERE r.deleted_at IS NULL AND r.status = 'approved'
  AND NOT (extract(dow from g.d)::int = ANY (coalesce(s.weekly_off_days, '{0}'::int[])));$ariforce_stmt$;
  EXECUTE $ariforce_stmt$GRANT SELECT ON kpi_user_leave_day TO ariforce_app;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON kpi_user_leave_day FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON kpi_user_leave_day FROM authenticated;
  END IF;
END $$;$ariforce_stmt$;
  INSERT INTO public.ariforce_migrations (name) VALUES ('0024_kpi_leave_views');
END
$ariforce_migration$;
COMMIT;
