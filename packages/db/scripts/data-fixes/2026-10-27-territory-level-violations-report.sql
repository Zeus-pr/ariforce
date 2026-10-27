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

-- 3. Tree shape. Any segment style is accepted: real paths are code-based (e.g. WB.HQ_MALDA), seed
--    and older imports use ids. Rule: root path = one segment (no '.'); child path = parent path ||
--    '.' || its own last segment; child level below the parent's. seg_ok (informational) = the last
--    segment equals the code, the code with non-alphanumerics as '_' (HQ-MALDA -> HQ_MALDA), or the id.
WITH x AS (
  SELECT c.id, c.code, c.level, c.parent_id, p.code AS parent, p.level AS parent_level, c.path,
         regexp_replace(c.path, '^.*\.', '') AS seg,
         CASE WHEN c.parent_id IS NULL THEN position('.' IN c.path) = 0
              ELSE p.path IS NOT NULL AND c.path = p.path || '.' || regexp_replace(c.path, '^.*\.', '')
         END AS path_ok,
         (c.parent_id IS NULL OR array_position(enum_range(NULL::territory_level), c.level)
            > array_position(enum_range(NULL::territory_level), p.level)) AS level_ok
  FROM territories c LEFT JOIN territories p ON p.id = c.parent_id AND p.deleted_at IS NULL
  WHERE c.company_id = :'company_id' AND c.deleted_at IS NULL),
y AS (
  SELECT x.*, (upper(seg) IN (upper(code), upper(regexp_replace(code, '[^A-Za-z0-9]', '_', 'g')))
               OR seg = id::text) AS seg_ok
  FROM x)
SELECT code, level, parent, parent_level, path, path_ok, level_ok, seg_ok
FROM y WHERE NOT (path_ok AND level_ok AND seg_ok)
ORDER BY code;

-- 4. Duplicate paths (two live territories must never share one; expected 0 rows).
SELECT path, count(*) AS n, string_agg(code, ', ' ORDER BY code) AS codes
FROM territories WHERE company_id = :'company_id' AND deleted_at IS NULL
GROUP BY path HAVING count(*) > 1;
ROLLBACK;
