-- A day can hold two plans. Call average weighs every plan, not only the first.
-- Weight is 1 when every plan is field work, 0.5 when field work shares the day
-- with camp or other non-field work, and 0 when no plan is field work.
-- field_day stays true whenever that weight is above 0.
CREATE OR REPLACE VIEW kpi_user_day WITH (security_invoker = true) AS
SELECT
  r.company_id, r.user_id, r.date, r.status, wt.kind AS work_type_kind,
  (coalesce(parts.field_parts, 0) > 0) AS field_day,
  (r.status IN ('submitted','approved')) AS dcr_submitted,
  (r.status IN ('submitted','approved')
    AND (r.submitted_at AT TIME ZONE 'Asia/Kolkata')::date <= r.date + 1) AS dcr_on_time,
  count(c.id) FILTER (WHERE c.outlet_kind = 'doctor' AND c.deleted_at IS NULL) AS doctor_calls,
  count(c.id) FILTER (WHERE c.outlet_kind = 'chemist' AND c.deleted_at IS NULL) AS chemist_calls,
  count(c.id) FILTER (WHERE c.outlet_kind = 'stockist' AND c.deleted_at IS NULL) AS stockist_calls,
  count(DISTINCT c.outlet_id) FILTER (WHERE c.outlet_kind = 'doctor' AND c.deleted_at IS NULL) AS unique_doctors,
  CASE
    WHEN coalesce(parts.field_parts, 0) = 0 THEN 0::numeric
    WHEN parts.field_parts = parts.part_count THEN 1::numeric
    ELSE 0.5
  END AS field_weight
FROM dcrs r
JOIN work_types wt ON wt.id = r.work_type_id
LEFT JOIN dcr_calls c ON c.dcr_id = r.id
LEFT JOIN LATERAL (
  SELECT
    count(*)::int AS part_count,
    count(*) FILTER (WHERE pwt.counts_as_field_day)::int AS field_parts
  FROM jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(r.sections) = 'array' AND jsonb_array_length(r.sections) > 0 THEN r.sections
      ELSE jsonb_build_array(jsonb_build_object('workTypeId', r.work_type_id))
    END
  ) AS sec(part)
  LEFT JOIN work_types pwt ON pwt.id = (sec.part->>'workTypeId')::uuid
) parts ON true
WHERE r.deleted_at IS NULL AND r.status IN ('submitted', 'approved')
GROUP BY r.company_id, r.user_id, r.date, r.status, wt.kind, r.submitted_at,
  parts.field_parts, parts.part_count;
--> statement-breakpoint
-- field_days changes from a count of days to the sum of those weights.
DROP VIEW IF EXISTS kpi_user_month;
--> statement-breakpoint
CREATE VIEW kpi_user_month WITH (security_invoker = true) AS
WITH d AS (
  SELECT company_id, user_id, date_trunc('month', date)::date AS month,
    coalesce(sum(field_weight), 0) AS field_days,
    count(*) FILTER (WHERE dcr_submitted) AS dcr_submitted_days,
    count(*) FILTER (WHERE dcr_on_time) AS dcr_on_time_days,
    coalesce(sum(doctor_calls) FILTER (WHERE field_weight > 0), 0) AS doctor_calls,
    coalesce(sum(chemist_calls) FILTER (WHERE field_weight > 0), 0) AS chemist_calls
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
LEFT JOIN pob ON pob.user_id = d.user_id AND pob.month = d.month;
--> statement-breakpoint
GRANT SELECT ON kpi_user_month TO ariforce_app;
