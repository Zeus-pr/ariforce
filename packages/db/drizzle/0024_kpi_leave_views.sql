-- Leave (#51): approved leave per user per day for attendance/KPIs, so a leave day without a DCR
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
  AND NOT (extract(dow from g.d)::int = ANY (coalesce(s.weekly_off_days, '{0}'::int[])));
--> statement-breakpoint
GRANT SELECT ON kpi_user_leave_day TO ariforce_app;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON kpi_user_leave_day FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON kpi_user_leave_day FROM authenticated;
  END IF;
END $$;
