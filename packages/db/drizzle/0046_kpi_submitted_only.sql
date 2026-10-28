-- KPIs and missing-DCR flags count submitted DCRs only (status submitted/approved, not deleted);
-- drafts never count. A drafts-only day has no kpi_user_day row, so the exceptions engine flags it
-- (dcr_missing / punch_without_dcr). At most one such row per user and day (dcrs_user_date_submitted_uq,
-- 0045). Same columns as 0045; kpi_user_doctor_month, kpi_user_month, kpi_product_month and
-- kpi_tp_adherence_month read these two views and follow automatically.
CREATE OR REPLACE VIEW kpi_user_day WITH (security_invoker = true) AS
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
WHERE r.deleted_at IS NULL AND r.status IN ('submitted', 'approved')
GROUP BY r.company_id, r.user_id, r.date, r.status, wt.kind, wt.counts_as_field_day, r.submitted_at;
--> statement-breakpoint
-- Calls of submitted reports only.
CREATE OR REPLACE VIEW dcr_day_calls WITH (security_invoker = true) AS
SELECT c.* FROM dcr_calls c
WHERE c.deleted_at IS NULL
  AND EXISTS (
    SELECT 1 FROM dcrs r
    WHERE r.id = c.dcr_id AND r.deleted_at IS NULL AND r.status IN ('submitted', 'approved')
  );
