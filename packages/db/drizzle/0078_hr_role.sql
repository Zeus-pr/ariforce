-- One HR role row per company. No field work and no reporting line. Existing rows are left as edited.
INSERT INTO roles (id, company_id, key, name, rank, permissions)
SELECT gen_random_uuid(), c.id, 'hr'::role_key, 'HR', 0,
  ARRAY['me:read','roles:read','territories:read','users:read','users:write']::text[]
FROM companies c
ON CONFLICT (company_id, key) DO NOTHING;
