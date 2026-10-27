-- ONE-OFF DATA FIX, run by lead as DB owner, not a migration. DO NOT run from the app or CI.
--
-- Purpose (Part 3): HQ-BURDWAN becomes the parent of HQ-BURDWAN-BMCH and HQ-BURDWAN-ANAMOY, so an ABM
-- on HQ-BURDWAN sees both HQs' doctors, chemists, stockists, DCRs and plans through the territory
-- subtree. HQ-BURDWAN changes level headquarter -> area.
--   Level decision: 'area', because WB is already the region and an area is exactly "a group of HQs
--   one ABM holds" (the API lets an ABM hold area level; a BM may hold headquarter level only).
-- Keeps: both HQs stay headquarter level; their BMs (Sohom Mukherjee on BMCH, Surojit Shikari on
--   Anamoy) keep their user_territories rows; all doctors/chemists/stockists/allowance places/SFC
--   routes keep their territory ids (only paths move). Nothing is deleted.
-- Paths: whatever convention the data uses is kept. Each territory keeps its OWN last path segment
--   (real data: code-based, e.g. WB.HQ_BURDWAN; seed/importer: uuid); only the prefix changes:
--   new path = new parent path || '.' || own existing last segment. E.g. WB.HQ_BURDWAN_BMCH ->
--   WB.HQ_BURDWAN.HQ_BURDWAN_BMCH. Descendants are rebuilt the same way (prefix replacement).
-- Keyed by territory codes; single transaction; idempotent (a second run changes 0 rows).
-- Run:  psql "$URL" -v slug=arighna -v company_id=83584199-7043-46c0-b5cd-8ea938e8dce5 -v ON_ERROR_STOP=1 -f 2026-10-27-burdwan-reparent.sql
-- Afterwards: run 2026-10-27-territory-level-violations-report.sql (a BM left on HQ-BURDWAN itself
--   would now be on an area; see the optional block at the bottom), then set up the ABM (see below).
\if :{?slug}
\else
  \set slug arighna
\endif
\if :{?company_id}
\else
  \set company_id 83584199-7043-46c0-b5cd-8ea938e8dce5
\endif
\set ON_ERROR_STOP 1
\set parent_code HQ-BURDWAN
\set child_a HQ-BURDWAN-BMCH
\set child_b HQ-BURDWAN-ANAMOY
BEGIN;
-- Tenant context: every table has FORCED row-level security keyed on app.current_company_id.
SELECT set_config('app.current_company_id', :'company_id', true);
SELECT (count(*) = 1) AS company_ok FROM companies WHERE id = :'company_id' AND slug = :'slug' \gset
\if :company_ok
\else
  \echo 'ABORT: company_id and slug do not match one company'
  ROLLBACK;
  \quit
\endif

CREATE TEMP TABLE _t ON COMMIT DROP AS
SELECT t.id, t.code, t.level, t.parent_id, t.path, t.version,
       CASE WHEN t.code = :'parent_code' THEN 'parent' ELSE 'child' END AS kind,
       p.code AS parent_code, p.level AS parent_level
FROM territories t LEFT JOIN territories p ON p.id = t.parent_id
WHERE t.company_id = :'company_id' AND t.deleted_at IS NULL
  AND t.code IN (:'parent_code', :'child_a', :'child_b');
SELECT (count(*) = 3 AND count(DISTINCT code) = 3) AS found_ok FROM _t \gset
\if :found_ok
\else
  \echo 'ABORT: expected exactly one live territory for each of the three codes'
  ROLLBACK;
  \quit
\endif
-- Burdwan must sit under a region (WB) to become an area.
SELECT (parent_level = 'region') AS parent_ok FROM _t WHERE code = :'parent_code' \gset
\if :parent_ok
\else
  \echo 'ABORT: HQ-BURDWAN is not directly under a region; see the optional block "re-home Burdwan under WB"'
  ROLLBACK;
  \quit
\endif
-- No grandchildren under the two HQs is expected; any are moved with them (paths rebuilt below).

-- Subtree counts per territory (doctors / chemists / stockists / users / allowance places / SFC routes).
CREATE TEMP TABLE _counts (phase text, code text, doctors int, chemists int, stockists int,
                           users int, allowance_places int, sfc_routes int) ON COMMIT DROP;
CREATE TEMP VIEW _subtree_counts AS
SELECT x.code,
  (SELECT count(*) FROM doctors d JOIN territories s ON s.id = d.territory_id
     WHERE d.deleted_at IS NULL AND (s.id = t.id OR starts_with(s.path, t.path || '.')))::int AS doctors,
  (SELECT count(*) FROM chemists d JOIN territories s ON s.id = d.territory_id
     WHERE d.deleted_at IS NULL AND (s.id = t.id OR starts_with(s.path, t.path || '.')))::int AS chemists,
  (SELECT count(*) FROM stockists d JOIN territories s ON s.id = d.territory_id
     WHERE d.deleted_at IS NULL AND (s.id = t.id OR starts_with(s.path, t.path || '.')))::int AS stockists,
  (SELECT count(DISTINCT ut.user_id) FROM user_territories ut JOIN territories s ON s.id = ut.territory_id
     WHERE (s.id = t.id OR starts_with(s.path, t.path || '.')))::int AS users,
  (SELECT count(*) FROM allowance_places a JOIN territories s ON s.id = a.hq_territory_id
     WHERE a.deleted_at IS NULL AND (s.id = t.id OR starts_with(s.path, t.path || '.')))::int AS allowance_places,
  (SELECT count(*) FROM sfc_routes a JOIN territories s ON s.id = a.hq_territory_id
     WHERE a.deleted_at IS NULL AND (s.id = t.id OR starts_with(s.path, t.path || '.')))::int AS sfc_routes
FROM _t x JOIN territories t ON t.id = x.id;
INSERT INTO _counts SELECT 'before', * FROM _subtree_counts;

-- BEFORE
SELECT 'before' AS phase, code, level, parent_code, version, path FROM _t ORDER BY code;
SELECT * FROM _counts WHERE phase = 'before' ORDER BY code;
SELECT 'before' AS phase, t.code AS territory, u.name, r.key AS role, u.status, m.name AS manager
FROM user_territories ut JOIN _t t ON t.id = ut.territory_id JOIN users u ON u.id = ut.user_id
LEFT JOIN user_roles ur ON ur.user_id = u.id LEFT JOIN roles r ON r.id = ur.role_id
LEFT JOIN users m ON m.id = u.manager_id
WHERE u.deleted_at IS NULL ORDER BY t.code, u.name;

-- 1. Burdwan becomes an area (only if not already).
WITH ch AS (
  UPDATE territories t SET level = 'area'
  FROM _t x WHERE t.id = x.id AND x.code = :'parent_code' AND t.level <> 'area'
  RETURNING t.id, x.level AS old_level)
INSERT INTO audit_log (company_id, actor_user_id, action, entity_type, entity_id, before, after)
SELECT :'company_id', NULL, 'territory.level_changed', 'territory', ch.id::text,
       jsonb_build_object('level', ch.old_level),
       jsonb_build_object('level', 'area', 'fix', '2026-10-27-burdwan-reparent')
FROM ch;

-- 2. Re-parent the two HQs under Burdwan (only if not already).
WITH b AS (SELECT id FROM _t WHERE code = :'parent_code'),
ch AS (
  UPDATE territories t SET parent_id = b.id
  FROM _t x, b WHERE t.id = x.id AND x.code IN (:'child_a', :'child_b') AND t.parent_id <> b.id
  RETURNING t.id, x.parent_id AS old_parent, b.id AS new_parent)
INSERT INTO audit_log (company_id, actor_user_id, action, entity_type, entity_id, before, after)
SELECT :'company_id', NULL, 'territory.reparented', 'territory', ch.id::text,
       jsonb_build_object('parentId', ch.old_parent),
       jsonb_build_object('parentId', ch.new_parent, 'fix', '2026-10-27-burdwan-reparent')
FROM ch;

-- 3. Rebuild materialised paths below Burdwan from parent_id (moves any descendants along).
--    Each node keeps its own last segment (code- or uuid-based, whatever is stored).
WITH RECURSIVE tree AS (
  SELECT t.id, t.path AS p FROM territories t JOIN _t x ON x.id = t.id AND x.code = :'parent_code'
  UNION ALL
  SELECT c.id, tree.p || '.' || regexp_replace(c.path, '^.*\.', '')
  FROM territories c JOIN tree ON c.parent_id = tree.id
  WHERE c.deleted_at IS NULL AND c.company_id = :'company_id')
UPDATE territories t SET path = tree.p FROM tree WHERE t.id = tree.id AND t.path <> tree.p;

-- AFTER
SELECT 'after' AS phase, t.code, t.level, p.code AS parent_code, t.version, t.path
FROM territories t JOIN _t x ON x.id = t.id LEFT JOIN territories p ON p.id = t.parent_id
ORDER BY t.code;
INSERT INTO _counts SELECT 'after', * FROM _subtree_counts;
SELECT * FROM _counts ORDER BY code, phase DESC;

-- Post-checks (raise = whole fix rolls back).
DO $$
DECLARE bad text;
BEGIN
  -- Children keep their own counts; Burdwan's subtree now = its own before + both children.
  SELECT string_agg(a.code, ', ') INTO bad FROM _counts a JOIN _counts b USING (code)
  WHERE a.phase = 'after' AND b.phase = 'before'
    AND a.code IN (SELECT code FROM _t WHERE kind = 'child')
    AND (a.doctors, a.chemists, a.stockists, a.users, a.allowance_places, a.sfc_routes)
        IS DISTINCT FROM (b.doctors, b.chemists, b.stockists, b.users, b.allowance_places, b.sfc_routes);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'post-check: child subtree counts changed: %', bad; END IF;
  IF EXISTS (
    WITH par AS (SELECT code FROM _t WHERE kind = 'parent'),
    -- expected = Burdwan before + each child that was NOT already under Burdwan (re-runs add 0)
    agg AS (SELECT sum(k.doctors) d, sum(k.chemists) c, sum(k.stockists) s,
                   sum(k.allowance_places) a, sum(k.sfc_routes) r
            FROM _counts k JOIN _t x ON x.code = k.code
            WHERE k.phase = 'before'
              AND (x.kind = 'parent' OR x.parent_id <> (SELECT id FROM _t WHERE kind = 'parent')))
    SELECT 1 FROM _counts k, agg, par WHERE k.phase = 'after' AND k.code = par.code
      AND (k.doctors, k.chemists, k.stockists, k.allowance_places, k.sfc_routes)
          IS DISTINCT FROM (agg.d::int, agg.c::int, agg.s::int, agg.a::int, agg.r::int))
  THEN RAISE EXCEPTION 'post-check: Burdwan subtree is not the sum of the three'; END IF;
  -- Orphans / broken paths anywhere in the company.
  IF EXISTS (SELECT 1 FROM territories c LEFT JOIN territories p ON p.id = c.parent_id
             WHERE c.deleted_at IS NULL AND c.parent_id IS NOT NULL
               AND (p.id IS NULL OR p.deleted_at IS NOT NULL))
  THEN RAISE EXCEPTION 'post-check: orphan territory (parent missing or deleted)'; END IF;
  IF EXISTS (SELECT 1 FROM territories c JOIN territories p ON p.id = c.parent_id
             JOIN _t x ON x.id IN (c.id, c.parent_id)
             WHERE c.path <> p.path || '.' || regexp_replace(c.path, '^.*\.', ''))
  THEN RAISE EXCEPTION 'post-check: path does not match parent'; END IF;
  -- Segments may repeat across the tree, but two live territories may never share a path.
  IF EXISTS (SELECT path FROM territories WHERE company_id = current_setting('app.current_company_id')::uuid
               AND deleted_at IS NULL GROUP BY path HAVING count(*) > 1)
  THEN RAISE EXCEPTION 'post-check: two territories share a path'; END IF;
  -- Levels: Burdwan area under a region; both children headquarter.
  IF EXISTS (SELECT 1 FROM territories t JOIN _t x ON x.id = t.id
             WHERE x.kind = 'child' AND t.level <> 'headquarter')
  THEN RAISE EXCEPTION 'post-check: a child is no longer headquarter level'; END IF;
  IF EXISTS (SELECT 1 FROM territories t JOIN _t x ON x.id = t.id
             WHERE x.kind = 'child' AND t.parent_id <> (SELECT id FROM _t WHERE kind = 'parent'))
  THEN RAISE EXCEPTION 'post-check: a child is not under Burdwan'; END IF;
END $$;

DROP VIEW _subtree_counts;
COMMIT;

-- ===================================================================================================
-- SET-UP AFTER THE FIX (People page or API, not SQL): the Burdwan ABM needs BOTH
--   * user_territories = HQ-BURDWAN (now area level)           -> territory-subtree lists, and
--   * Sohom's and Surojit's managerId = the ABM                  -> reporting-line lists/approvals.
-- See docs/RBAC.md "Territory subtree vs reporting line".
--
-- ROLLBACK SQL (run separately if needed; puts parents and level back from this fix's audit rows):
-- BEGIN;
-- SELECT set_config('app.current_company_id', :'company_id', true);
-- UPDATE territories t SET parent_id = (a.before->>'parentId')::uuid
-- FROM audit_log a WHERE a.action = 'territory.reparented' AND a.entity_id = t.id::text
--   AND a.after->>'fix' = '2026-10-27-burdwan-reparent';
-- UPDATE territories t SET level = (a.before->>'level')::territory_level
-- FROM audit_log a WHERE a.action = 'territory.level_changed' AND a.entity_id = t.id::text
--   AND a.after->>'fix' = '2026-10-27-burdwan-reparent';
-- WITH RECURSIVE tree AS (   -- roots keep their path; every node keeps its own last segment
--   SELECT id, path AS p FROM territories WHERE parent_id IS NULL AND company_id = :'company_id'
--     AND deleted_at IS NULL
--   UNION ALL
--   SELECT c.id, tree.p || '.' || regexp_replace(c.path, '^.*\.', '')
--   FROM territories c JOIN tree ON c.parent_id = tree.id
--   WHERE c.company_id = :'company_id' AND c.deleted_at IS NULL)
-- UPDATE territories t SET path = tree.p FROM tree WHERE t.id = tree.id AND t.path <> tree.p;
-- INSERT INTO audit_log (company_id, actor_user_id, action, entity_type, entity_id)
-- SELECT company_id, NULL, action || '_rollback', 'territory', entity_id FROM audit_log
-- WHERE after->>'fix' = '2026-10-27-burdwan-reparent';
-- COMMIT;
--
-- OPTIONAL (commented): re-home Burdwan under WB first, if it is not directly under the region.
-- UPDATE territories SET parent_id = (SELECT id FROM territories WHERE code = 'WB' AND company_id = :'company_id')
-- WHERE code = 'HQ-BURDWAN' AND company_id = :'company_id';   -- then re-run this script
--
-- OPTIONAL (commented): a BM still holding HQ-BURDWAN itself (now an area) breaks the BM rule on the
-- next edit of their territories. Move them to one of the two HQs (pick per person):
-- UPDATE user_territories ut SET territory_id = (SELECT id FROM territories WHERE code = 'HQ-BURDWAN-BMCH' AND company_id = :'company_id')
-- WHERE ut.user_id = (SELECT id FROM users WHERE employee_code = '<CODE>' AND company_id = :'company_id')
--   AND ut.territory_id = (SELECT id FROM territories WHERE code = 'HQ-BURDWAN' AND company_id = :'company_id');
--
-- OPTIONAL (commented): rename Burdwan to show it is now an area (code is kept; imports key on it).
-- UPDATE territories SET name = 'Burdwan (area)' WHERE code = 'HQ-BURDWAN' AND company_id = :'company_id';
