-- Coverage counted the must-see list only in months that already had a saved call.
-- A filed day with no calls (or no doctor calls yet) then showed 0 doctors on the list.
-- Months now come from any submitted day. Visits stay 0 until a doctor call is saved.
CREATE OR REPLACE VIEW kpi_user_doctor_month WITH (security_invoker = true) AS
SELECT l.company_id, l.user_id, m.month, l.doctor_id, l.required_visits,
  count(c.id) AS visits,
  (count(c.id) >= l.required_visits) AS frequency_met
FROM kpi_user_doctor_list l
CROSS JOIN LATERAL (
  SELECT DISTINCT date_trunc('month', d.date)::date AS month
  FROM kpi_user_day d
  WHERE d.user_id = l.user_id
) m
LEFT JOIN dcr_day_calls c ON c.user_id = l.user_id AND c.outlet_kind = 'doctor'
  AND c.outlet_id = l.doctor_id AND c.deleted_at IS NULL
  AND c.date >= m.month AND c.date < (m.month + interval '1 month')
GROUP BY l.company_id, l.user_id, m.month, l.doctor_id, l.required_visits;
