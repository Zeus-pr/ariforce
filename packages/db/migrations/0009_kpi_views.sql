-- GENERATED from packages/db/drizzle/0009_kpi_views.sql by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '0009_kpi_views') THEN
    RAISE NOTICE 'skip 0009_kpi_views (already applied)';
    RETURN;
  END IF;
  EXECUTE $ariforce_stmt$-- KPI reporting views (docs/kpi-definitions.md). All views are security_invoker so the caller's
-- RLS (tenant_isolation on company_id) applies. Per-user/per-territory grain only; role rollups
-- (BM -> Director, reporting-line subtree) are summed in the API from these rows.
CREATE OR REPLACE VIEW kpi_user_doctor_list WITH (security_invoker = true) AS
SELECT DISTINCT ON (ut.user_id, d.id)
  d.company_id, ut.user_id, d.id AS doctor_id, d.territory_id, d.category_id,
  coalesce(d.visits_per_cycle_override, dc.visits_per_cycle, 1) AS required_visits
FROM user_territories ut
JOIN territories ut_t ON ut_t.id = ut.territory_id AND ut_t.deleted_at IS NULL
JOIN territories dt ON dt.company_id = ut_t.company_id
  AND (dt.path = ut_t.path OR dt.path LIKE ut_t.path || '.%') AND dt.deleted_at IS NULL
JOIN doctors d ON d.territory_id = dt.id AND d.deleted_at IS NULL AND d.approval_status = 'approved'
LEFT JOIN doctor_categories dc ON dc.id = d.category_id;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE OR REPLACE VIEW kpi_user_day WITH (security_invoker = true) AS
SELECT
  r.company_id, r.user_id, r.date, r.status, wt.kind AS work_type_kind,
  wt.counts_as_field_day AS field_day,
  (r.status IN ('submitted','approved')) AS dcr_submitted,
  (r.status IN ('submitted','approved')
    AND (r.submitted_at AT TIME ZONE 'Asia/Kolkata')::date <= r.date + 1) AS dcr_on_time,
  count(c.id) FILTER (WHERE c.outlet_kind = 'doctor' AND c.deleted_at IS NULL) AS doctor_calls,
  count(c.id) FILTER (WHERE c.outlet_kind = 'chemist' AND c.deleted_at IS NULL) AS chemist_calls,
  count(c.id) FILTER (WHERE c.outlet_kind = 'stockist' AND c.deleted_at IS NULL) AS stockist_calls,
  count(DISTINCT c.outlet_id) FILTER (WHERE c.outlet_kind = 'doctor' AND c.deleted_at IS NULL) AS unique_doctors
FROM dcrs r
JOIN work_types wt ON wt.id = r.work_type_id
LEFT JOIN dcr_calls c ON c.dcr_id = r.id
WHERE r.deleted_at IS NULL
GROUP BY r.company_id, r.user_id, r.date, r.status, wt.kind, wt.counts_as_field_day, r.submitted_at;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE OR REPLACE VIEW kpi_user_doctor_month WITH (security_invoker = true) AS
SELECT l.company_id, l.user_id, m.month, l.doctor_id, l.required_visits,
  count(c.id) AS visits,
  (count(c.id) >= l.required_visits) AS frequency_met
FROM kpi_user_doctor_list l
CROSS JOIN LATERAL (
  SELECT DISTINCT date_trunc('month', c2.date)::date AS month
  FROM dcr_calls c2 WHERE c2.user_id = l.user_id AND c2.deleted_at IS NULL
) m
LEFT JOIN dcr_calls c ON c.user_id = l.user_id AND c.outlet_kind = 'doctor'
  AND c.outlet_id = l.doctor_id AND c.deleted_at IS NULL
  AND c.date >= m.month AND c.date < (m.month + interval '1 month')
GROUP BY l.company_id, l.user_id, m.month, l.doctor_id, l.required_visits;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE OR REPLACE VIEW kpi_user_month WITH (security_invoker = true) AS
WITH d AS (
  SELECT company_id, user_id, date_trunc('month', date)::date AS month,
    count(*) FILTER (WHERE field_day) AS field_days,
    count(*) FILTER (WHERE dcr_submitted) AS dcr_submitted_days,
    count(*) FILTER (WHERE dcr_on_time) AS dcr_on_time_days,
    sum(doctor_calls) FILTER (WHERE field_day) AS doctor_calls,
    sum(chemist_calls) FILTER (WHERE field_day) AS chemist_calls
  FROM kpi_user_day GROUP BY 1, 2, 3
), dm AS (
  SELECT company_id, user_id, month,
    count(*) AS msl_size,
    count(*) FILTER (WHERE visits > 0) AS unique_doctors_seen,
    count(*) FILTER (WHERE frequency_met) AS frequency_met_doctors
  FROM kpi_user_doctor_month GROUP BY 1, 2, 3
), pob AS (
  SELECT c.company_id, c.user_id, date_trunc('month', c.date)::date AS month,
    coalesce(sum(p.value), 0) AS pob_value
  FROM dcr_calls c JOIN dcr_call_products p ON p.call_id = c.id AND p.kind = 'pob' AND p.deleted_at IS NULL
  WHERE c.deleted_at IS NULL GROUP BY 1, 2, 3
)
SELECT d.company_id, d.user_id, d.month, d.field_days, d.dcr_submitted_days, d.dcr_on_time_days,
  d.doctor_calls, d.chemist_calls,
  round(d.doctor_calls::numeric / nullif(d.field_days, 0), 2) AS call_average,
  coalesce(dm.msl_size, 0) AS msl_size,
  coalesce(dm.unique_doctors_seen, 0) AS unique_doctors_seen,
  coalesce(dm.frequency_met_doctors, 0) AS frequency_met_doctors,
  round(100.0 * dm.unique_doctors_seen / nullif(dm.msl_size, 0), 1) AS coverage_pct,
  round(100.0 * dm.frequency_met_doctors / nullif(dm.msl_size, 0), 1) AS frequency_compliance_pct,
  round(100.0 * (dm.msl_size - dm.unique_doctors_seen) / nullif(dm.msl_size, 0), 1) AS missed_doctor_pct,
  coalesce(pob.pob_value, 0) AS pob_value
FROM d
LEFT JOIN dm ON dm.user_id = d.user_id AND dm.month = d.month
LEFT JOIN pob ON pob.user_id = d.user_id AND pob.month = d.month;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE OR REPLACE VIEW kpi_tp_adherence_month WITH (security_invoker = true) AS
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
LEFT JOIN tour_plan_visits v ON v.tour_plan_id = tp.id AND v.deleted_at IS NULL
WHERE tp.deleted_at IS NULL AND tp.status = 'approved'
GROUP BY tp.company_id, tp.user_id, tp.month;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE OR REPLACE VIEW kpi_product_month WITH (security_invoker = true) AS
SELECT c.company_id, c.user_id, date_trunc('month', c.date)::date AS month, p.product_id,
  count(*) FILTER (WHERE p.kind = 'detailed') AS detailed_calls,
  count(*) FILTER (WHERE p.kind = 'detailed' AND p.seq = 1) AS first_position_calls,
  coalesce(sum(p.quantity) FILTER (WHERE p.kind = 'sample'), 0) AS sample_qty,
  coalesce(sum(p.quantity) FILTER (WHERE p.kind = 'pob'), 0) AS pob_qty,
  coalesce(sum(p.value) FILTER (WHERE p.kind = 'pob'), 0) AS pob_value
FROM dcr_calls c
JOIN dcr_call_products p ON p.call_id = c.id AND p.deleted_at IS NULL
WHERE c.deleted_at IS NULL
GROUP BY 1, 2, 3, 4;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE OR REPLACE VIEW kpi_sales_month WITH (security_invoker = true) AS
WITH a AS (
  SELECT company_id, territory_id, month, kind,
    sum(CASE WHEN is_return THEN -value ELSE value END) AS actual_value
  FROM sales_actuals WHERE deleted_at IS NULL GROUP BY 1, 2, 3, 4
), t AS (
  SELECT company_id, territory_id, month, kind, sum(value) AS target_value
  FROM sales_targets WHERE deleted_at IS NULL AND product_id IS NULL GROUP BY 1, 2, 3, 4
), k AS (
  SELECT company_id, territory_id, month, kind FROM a UNION SELECT company_id, territory_id, month, kind FROM t
)
SELECT k.company_id, k.territory_id, k.month, k.kind,
  coalesce(a.actual_value, 0) AS actual_value,
  t.target_value,
  round(100.0 * coalesce(a.actual_value, 0) / nullif(t.target_value, 0), 1) AS achievement_pct,
  ly.actual_value AS ly_value,
  round(100.0 * (coalesce(a.actual_value, 0) - ly.actual_value) / nullif(ly.actual_value, 0), 1) AS growth_pct
FROM k
LEFT JOIN a ON a.territory_id = k.territory_id AND a.month = k.month AND a.kind = k.kind
LEFT JOIN t ON t.territory_id = k.territory_id AND t.month = k.month AND t.kind = k.kind
LEFT JOIN a ly ON ly.territory_id = k.territory_id AND ly.kind = k.kind
  AND ly.month = (k.month - interval '1 year')::date;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$GRANT SELECT ON kpi_user_doctor_list, kpi_user_day, kpi_user_doctor_month, kpi_user_month,
  kpi_tp_adherence_month, kpi_product_month, kpi_sales_month TO ariforce_app;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON kpi_user_doctor_list, kpi_user_day, kpi_user_doctor_month, kpi_user_month,
      kpi_tp_adherence_month, kpi_product_month, kpi_sales_month FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON kpi_user_doctor_list, kpi_user_day, kpi_user_doctor_month, kpi_user_month,
      kpi_tp_adherence_month, kpi_product_month, kpi_sales_month FROM authenticated;
  END IF;
END $$;$ariforce_stmt$;
  INSERT INTO public.ariforce_migrations (name) VALUES ('0009_kpi_views');
END
$ariforce_migration$;
COMMIT;
