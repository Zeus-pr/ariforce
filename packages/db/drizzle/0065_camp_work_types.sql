-- Camp work types. Same bands and SFC as field work; no call-average day and no calls.
-- Inserts CAMP_HQ / CAMP_EXHQ / CAMP_OUT for every existing company.
-- Idempotent: ON CONFLICT (company_id, code) DO NOTHING. Keep in sync with CAMP_WORK_TYPES.
INSERT INTO work_types (id, company_id, code, name, kind, counts_as_field_day, allowance_band, requires_location)
SELECT gen_random_uuid(), c.id, d.code, d.name, d.kind::work_type_kind, d.field_day, d.band, d.loc
FROM companies c
CROSS JOIN (VALUES
  ('CAMP_HQ',   'Camp (HQ)',         'field', false, 'hq',         true),
  ('CAMP_EXHQ', 'Camp (ex-HQ)',      'field', false, 'ex_hq',      true),
  ('CAMP_OUT',  'Camp (outstation)', 'field', false, 'outstation', true)
) AS d(code, name, kind, field_day, band, loc)
WHERE c.deleted_at IS NULL
ON CONFLICT (company_id, code) DO NOTHING;
