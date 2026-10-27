-- READ-ONLY report (Part 3): people whose territories break the role/level rule now enforced by the
-- API (422 TERRITORY_LEVEL_INVALID): a business_manager may hold headquarter-level territories only;
-- ABM and above may hold a headquarter or any higher level. The API checks writes only, so existing
-- rows keep working; fix them by editing the person (People page) or with a reviewed data fix.
-- Run by lead:  psql "$URL" -v slug=arighna -v company_id=83584199-7043-46c0-b5cd-8ea938e8dce5 -f 2026-10-27-territory-level-violations-report.sql
-- Changes nothing (READ ONLY transaction, rolled back).
\if :{?slug}
\else
  \set slug arighna
\endif
\if :{?company_id}
\else
  \set company_id 83584199-7043-46c0-b5cd-8ea938e8dce5
\endif
BEGIN READ ONLY;
-- Tenant context: every table has FORCED row-level security keyed on app.current_company_id.
SELECT set_config('app.current_company_id', :'company_id', true);
SELECT (count(*) = 1) AS company_ok FROM companies WHERE id = :'company_id' AND slug = :'slug' \gset
\if :company_ok
\else
  \echo 'ABORT: company_id and slug do not match one company'
  ROLLBACK;
  \quit
\endif

-- 1. Business managers holding a non-headquarter territory (expected 0 rows after Part 3).
SELECT u.name, u.employee_code, u.status, t.code AS territory, t.level, ut.is_primary
FROM users u
JOIN user_roles ur ON ur.user_id = u.id
JOIN roles r ON r.id = ur.role_id AND r.key = 'business_manager'
JOIN user_territories ut ON ut.user_id = u.id
JOIN territories t ON t.id = ut.territory_id AND t.deleted_at IS NULL
WHERE u.company_id = :'company_id' AND u.deleted_at IS NULL AND t.level <> 'headquarter'
ORDER BY u.name, t.code;

-- 2. Hierarchy roles with no live territory at all (cannot work anywhere; informational).
SELECT u.name, u.employee_code, r.key AS role, u.status
FROM users u
JOIN user_roles ur ON ur.user_id = u.id
JOIN roles r ON r.id = ur.role_id AND r.key::text NOT IN ('system_admin', 'distribution_head', 'accountant')
WHERE u.company_id = :'company_id' AND u.deleted_at IS NULL AND u.status <> 'suspended'
  AND NOT EXISTS (SELECT 1 FROM user_territories ut JOIN territories t ON t.id = ut.territory_id
                  WHERE ut.user_id = u.id AND t.deleted_at IS NULL)
ORDER BY r.key, u.name;

-- 3. Tree shape: a child must sit at a lower level than its parent, and path = parent.path || '.' || id.
SELECT c.code, c.level, p.code AS parent, p.level AS parent_level,
       (c.path = p.path || '.' || c.id::text) AS path_ok
FROM territories c JOIN territories p ON p.id = c.parent_id
WHERE c.company_id = :'company_id' AND c.deleted_at IS NULL
  AND (array_position(enum_range(NULL::territory_level), c.level)
         <= array_position(enum_range(NULL::territory_level), p.level)
       OR c.path <> p.path || '.' || c.id::text)
ORDER BY c.code;
ROLLBACK;
