-- Role rows for distribution_head / accountant in every company (needs 0014 committed first).
-- No reporting line, no field/doctor data: domain permission only. Existing rows are left as edited.
INSERT INTO roles (id, company_id, key, name, rank, permissions)
SELECT gen_random_uuid(), c.id, v.key::role_key, v.name, 0, v.perms
FROM companies c
CROSS JOIN (VALUES
  ('distribution_head', 'Distribution Head', ARRAY['me:read','roles:read','territories:read','sales:read']::text[]),
  ('accountant', 'Accountant', ARRAY['me:read','roles:read','territories:read','finance:read']::text[])
) AS v(key, name, perms)
ON CONFLICT (company_id, key) DO NOTHING;
