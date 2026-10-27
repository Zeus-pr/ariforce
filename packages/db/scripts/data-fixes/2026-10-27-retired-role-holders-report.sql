-- READ-ONLY report: holders of the retired roles (distribution_head, accountant).
-- Run by lead:  psql "$URL" -v slug=arighna -v company_id=83584199-7043-46c0-b5cd-8ea938e8dce5 -f 2026-10-27-retired-role-holders-report.sql
-- (arighna = company 83584199-7043-46c0-b5cd-8ea938e8dce5). Changes nothing.
\if :{?slug}
\else
  \set slug arighna
\endif
\if :{?company_id}
\else
  \set company_id 83584199-7043-46c0-b5cd-8ea938e8dce5
\endif
BEGIN READ ONLY;
-- Tenant context: every table has FORCED row-level security keyed on app.current_company_id, so a
-- non-superuser owner sees nothing without it. Then refuse to continue unless id and slug match.
SELECT set_config('app.current_company_id', :'company_id', true);
SELECT (count(*) = 1) AS company_ok FROM companies WHERE id = :'company_id' AND slug = :'slug' \gset
\if :company_ok
\else
  \echo 'ABORT: company_id and slug do not match one company'
  ROLLBACK;
  \quit
\endif
SELECT u.name,
       u.employee_code,
       r.key                                   AS role,
       u.status,
       inv.invite_status,
       inv.expires_at                          AS invite_expires_at,
       (u.auth_user_id IS NOT NULL)            AS has_login,
       coalesce(string_agg(DISTINCT t.code || ' (' || t.level || ')', ', '), '-') AS territories,
       m.name                                  AS manager
FROM users u
JOIN companies c   ON c.id = u.company_id AND c.slug = :'slug'
JOIN user_roles ur ON ur.user_id = u.id
JOIN roles r       ON r.id = ur.role_id AND r.key::text IN ('distribution_head', 'accountant')
LEFT JOIN users m  ON m.id = u.manager_id
LEFT JOIN user_territories ut ON ut.user_id = u.id
LEFT JOIN territories t ON t.id = ut.territory_id AND t.deleted_at IS NULL
LEFT JOIN LATERAL (
  SELECT CASE WHEN i.used_at IS NOT NULL THEN 'accepted'
              WHEN i.revoked_at IS NOT NULL THEN 'revoked'
              WHEN i.expires_at < now() THEN 'expired'
              ELSE 'pending' END AS invite_status,
         i.expires_at
  FROM user_invites i WHERE i.user_id = u.id ORDER BY i.created_at DESC LIMIT 1
) inv ON true
WHERE u.deleted_at IS NULL
GROUP BY u.id, u.name, u.employee_code, r.key, u.status, inv.invite_status, inv.expires_at, m.name
ORDER BY r.key, u.name;
-- Does anyone hold ONLY retired roles AND a login? (expected 0 rows; if not, they can no longer sign in)
SELECT u.name, u.employee_code FROM users u JOIN companies c ON c.id = u.company_id AND c.slug = :'slug'
WHERE u.auth_user_id IS NOT NULL AND u.deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id)
  AND NOT EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                  WHERE ur.user_id = u.id AND r.key::text NOT IN ('distribution_head', 'accountant'));
ROLLBACK;
