-- ONE-OFF DATA FIX, run by lead as DB owner, not a migration. DO NOT run from the app or CI.
-- Purpose: SFC category becomes the fixed enum ex | hq | os (DCR band: ex -> ex_hq, hq -> hq,
-- os -> outstation). Rewrites legacy text on live sfc_routes by a key = upper case with every
-- non-alphanumeric removed:
--   HQ                          -> hq
--   EX, EXHQ (e.g. 'EX HQ')     -> ex
--   OS, OUTSTATION, OUTEXHQ     -> os
-- Misfits are NOT changed unless a decision variable is passed:
--   'EX / OS'  (key EXOS):  -v exos=ex  or  -v exos=os   sets that category (no split; split = re-enter in SFC UI)
--   'MEETING'  (key MEETING): -v meeting=archive soft-deletes those routes (Meeting work type never uses SFC)
--   anything else: listed only.
-- Each changed route: category set, version + 1, one audit_log row (action 'sfc_route.category_normalised'
-- or 'sfc_route.archived', before/after, fix = this file) = the rollback marker.
-- DRY RUN BY DEFAULT (report + ROLLBACK); -v apply=1 commits. Idempotent: a second apply changes 0.
-- Run:  psql "$URL" -v slug=arighna -v company_id=<uuid> [-v exos=os] [-v meeting=archive] [-v apply=1] -v ON_ERROR_STOP=1 -f 2026-10-28-sfc-category-normalise.sql
\if :{?slug}
\else
  \set slug arighna
\endif
\if :{?company_id}
\else
  \set company_id 83584199-7043-46c0-b5cd-8ea938e8dce5
\endif
\if :{?apply}
\else
  \set apply 0
\endif
\if :{?exos}
\else
  \set exos ''
\endif
\if :{?meeting}
\else
  \set meeting ''
\endif
\set ON_ERROR_STOP 1
BEGIN;
SELECT set_config('app.current_company_id', :'company_id', true);
SELECT (count(*) = 1) AS company_ok FROM companies WHERE id = :'company_id' AND slug = :'slug' \gset
\if :company_ok
\else
  \echo 'ABORT: company_id and slug do not match one company'
  ROLLBACK;
  \quit
\endif
SELECT (:'exos' IN ('', 'ex', 'os') AND :'meeting' IN ('', 'archive')) AS vars_ok \gset
\if :vars_ok
\else
  \echo 'ABORT: exos must be ex|os, meeting must be archive'
  ROLLBACK;
  \quit
\endif

CREATE TEMP TABLE _r ON COMMIT DROP AS
SELECT r.id, r.category AS old,
       CASE WHEN r.category IN ('ex', 'hq', 'os') THEN r.category
            WHEN k = 'HQ' THEN 'hq'
            WHEN k IN ('EX', 'EXHQ') THEN 'ex'
            WHEN k IN ('OS', 'OUTSTATION', 'OUTEXHQ') THEN 'os'
            WHEN k = 'EXOS' AND :'exos' <> '' THEN :'exos'
       END AS new,
       (k = 'MEETING' AND :'meeting' = 'archive') AS archive
FROM sfc_routes r, LATERAL (SELECT upper(regexp_replace(coalesce(r.category, ''), '[^A-Za-z0-9]', '', 'g')) AS k) x
WHERE r.company_id = :'company_id' AND r.deleted_at IS NULL;

\echo '== Plan by current value (new = null and not archived: left as is)'
SELECT coalesce(old, '<null>') AS old, new, archive, count(*) FROM _r GROUP BY 1, 2, 3 ORDER BY 1;

WITH u AS (
  UPDATE sfc_routes r SET category = x.new, version = r.version + 1, updated_at = now()
  FROM _r x WHERE x.id = r.id AND x.new IS NOT NULL AND r.category IS DISTINCT FROM x.new
  RETURNING r.id, x.old, x.new)
INSERT INTO audit_log (company_id, actor_user_id, action, entity_type, entity_id, before, after)
SELECT :'company_id', NULL, 'sfc_route.category_normalised', 'sfc_route', u.id::text,
       jsonb_build_object('category', u.old),
       jsonb_build_object('category', u.new, 'fix', '2026-10-28-sfc-category-normalise') FROM u;
WITH u AS (
  UPDATE sfc_routes r SET deleted_at = now(), version = r.version + 1, updated_at = now()
  FROM _r x WHERE x.id = r.id AND x.archive
  RETURNING r.id, x.old)
INSERT INTO audit_log (company_id, actor_user_id, action, entity_type, entity_id, before, after)
SELECT :'company_id', NULL, 'sfc_route.archived', 'sfc_route', u.id::text,
       jsonb_build_object('category', u.old, 'deleted_at', NULL),
       jsonb_build_object('fix', '2026-10-28-sfc-category-normalise') FROM u;
SELECT count(*) FILTER (WHERE action = 'sfc_route.category_normalised') AS normalised,
       count(*) FILTER (WHERE action = 'sfc_route.archived') AS archived
FROM audit_log WHERE company_id = :'company_id' AND at = now() AND after->>'fix' = '2026-10-28-sfc-category-normalise';
\echo '== Left outside ex|hq|os (need a decision)'
SELECT category, count(*) FROM sfc_routes
WHERE company_id = :'company_id' AND deleted_at IS NULL AND category IS NOT NULL AND category NOT IN ('ex', 'hq', 'os')
GROUP BY 1 ORDER BY 1;

\if :apply
  COMMIT;
  \echo 'APPLIED'
\else
  ROLLBACK;
  \echo 'DRY RUN: rolled back. Re-run with -v apply=1 to commit.'
\endif
-- ROLLBACK SQL (run separately; restores only rows this fix changed and nobody changed since):
-- BEGIN; SELECT set_config('app.current_company_id', '<uuid>', true);
-- UPDATE sfc_routes r SET category = a.before->>'category', version = r.version + 1, updated_at = now()
--   FROM audit_log a WHERE a.action = 'sfc_route.category_normalised'
--    AND a.after->>'fix' = '2026-10-28-sfc-category-normalise' AND a.entity_id = r.id::text
--    AND r.category = a.after->>'category';
-- UPDATE sfc_routes r SET deleted_at = NULL, version = r.version + 1, updated_at = now()
--   FROM audit_log a WHERE a.action = 'sfc_route.archived'
--    AND a.after->>'fix' = '2026-10-28-sfc-category-normalise' AND a.entity_id = r.id::text;
-- COMMIT;
