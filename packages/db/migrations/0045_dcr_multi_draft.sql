-- GENERATED from packages/db/drizzle/0045_dcr_multi_draft.sql by scripts/sql-files.ts. Do not edit.
-- Apply in filename order. Safe to re-run: skipped if already recorded in public.ariforce_migrations.
BEGIN;
SET LOCAL search_path = public, extensions;
CREATE TABLE IF NOT EXISTS public.ariforce_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ariforce_migrations ENABLE ROW LEVEL SECURITY;
DO $ariforce_migration$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ariforce_migrations WHERE name = '0045_dcr_multi_draft') THEN
    RAISE NOTICE 'skip 0045_dcr_multi_draft (already applied)';
    RETURN;
  END IF;
  EXECUTE $ariforce_stmt$-- DCR multi-draft (docs/DCR-REDESIGN-DESIGN.md): several drafts per user and day, at most one live
-- report counted as submitted ('submitted' or 'approved'; 'rejected' is unused for DCRs and does
-- not block a resubmission). Replaces the full unique index on (company_id, user_id, date).
-- kpi_user_day keeps one row per user and day: the day report = the live non-draft row, else the
-- latest draft (same columns, so kpi_user_month and the exceptions engine are unchanged).
DROP INDEX IF EXISTS dcrs_user_date_uq;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE UNIQUE INDEX IF NOT EXISTS dcrs_user_date_submitted_uq ON dcrs USING btree (company_id, user_id, date)
  WHERE status IN ('submitted', 'approved') AND deleted_at IS NULL;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE INDEX IF NOT EXISTS dcrs_user_date_idx ON dcrs USING btree (company_id, user_id, date);$ariforce_stmt$;
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
  AND r.id = (
    SELECT x.id FROM dcrs x
    WHERE x.company_id = r.company_id AND x.user_id = r.user_id AND x.date = r.date
      AND x.deleted_at IS NULL
    ORDER BY (x.status = 'draft'), x.updated_at DESC, x.id DESC
    LIMIT 1
  )
GROUP BY r.company_id, r.user_id, r.date, r.status, wt.kind, wt.counts_as_field_day, r.submitted_at;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$-- Calls of day reports only (the live submitted report, else the latest draft): KPI views read
-- these so alternative drafts of a day never add calls, POB or product lines.
CREATE OR REPLACE VIEW dcr_day_calls WITH (security_invoker = true) AS
SELECT c.* FROM dcr_calls c
WHERE c.deleted_at IS NULL
  AND EXISTS (
    SELECT 1 FROM dcrs r
    WHERE r.id = c.dcr_id AND r.deleted_at IS NULL
      AND r.id = (
        SELECT x.id FROM dcrs x
        WHERE x.company_id = r.company_id AND x.user_id = r.user_id AND x.date = r.date
          AND x.deleted_at IS NULL
        ORDER BY (x.status = 'draft'), x.updated_at DESC, x.id DESC
        LIMIT 1
      )
  );$ariforce_stmt$;
  EXECUTE $ariforce_stmt$REVOKE ALL ON dcr_day_calls FROM PUBLIC;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$GRANT SELECT ON dcr_day_calls TO ariforce_app;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE OR REPLACE VIEW kpi_user_doctor_month WITH (security_invoker = true) AS
SELECT l.company_id, l.user_id, m.month, l.doctor_id, l.required_visits,
  count(c.id) AS visits,
  (count(c.id) >= l.required_visits) AS frequency_met
FROM kpi_user_doctor_list l
CROSS JOIN LATERAL (
  SELECT DISTINCT date_trunc('month', c2.date)::date AS month
  FROM dcr_day_calls c2 WHERE c2.user_id = l.user_id AND c2.deleted_at IS NULL
) m
LEFT JOIN dcr_day_calls c ON c.user_id = l.user_id AND c.outlet_kind = 'doctor'
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
  FROM dcr_day_calls c JOIN dcr_call_products p ON p.call_id = c.id AND p.kind = 'pob' AND p.deleted_at IS NULL
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
  EXECUTE $ariforce_stmt$CREATE OR REPLACE VIEW kpi_product_month WITH (security_invoker = true) AS
SELECT c.company_id, c.user_id, date_trunc('month', c.date)::date AS month, p.product_id,
  count(*) FILTER (WHERE p.kind = 'detailed') AS detailed_calls,
  count(*) FILTER (WHERE p.kind = 'detailed' AND p.seq = 1) AS first_position_calls,
  coalesce(sum(p.quantity) FILTER (WHERE p.kind = 'sample'), 0) AS sample_qty,
  coalesce(sum(p.quantity) FILTER (WHERE p.kind = 'pob'), 0) AS pob_qty,
  coalesce(sum(p.value) FILTER (WHERE p.kind = 'pob'), 0) AS pob_value
FROM dcr_day_calls c
JOIN dcr_call_products p ON p.call_id = c.id AND p.deleted_at IS NULL
WHERE c.deleted_at IS NULL
GROUP BY 1, 2, 3, 4;$ariforce_stmt$;
  EXECUTE $ariforce_stmt$CREATE OR REPLACE VIEW kpi_tp_adherence_month WITH (security_invoker = true) AS
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
    SELECT 1 FROM dcr_day_calls c WHERE c.user_id = tp.user_id AND c.date = v.date
      AND c.outlet_kind = v.outlet_kind AND c.outlet_id = v.outlet_id AND c.deleted_at IS NULL
  )) AS planned_visits_met,
  round(100.0 * count(v.id) FILTER (WHERE EXISTS (
    SELECT 1 FROM dcr_day_calls c WHERE c.user_id = tp.user_id AND c.date = v.date
      AND c.outlet_kind = v.outlet_kind AND c.outlet_id = v.outlet_id AND c.deleted_at IS NULL
  )) / nullif(count(v.id), 0), 1) AS adherence_pct
FROM tour_plans tp
LEFT JOIN v ON v.tour_plan_id = tp.id
WHERE tp.deleted_at IS NULL AND (tp.status = 'approved' OR EXISTS (
  SELECT 1 FROM tour_plan_submissions ts WHERE ts.tour_plan_id = tp.id
    AND ts.deleted_at IS NULL AND ts.status = 'approved'))
GROUP BY tp.company_id, tp.user_id, tp.month;$ariforce_stmt$;
  INSERT INTO public.ariforce_migrations (name) VALUES ('0045_dcr_multi_draft');
END
$ariforce_migration$;
COMMIT;
