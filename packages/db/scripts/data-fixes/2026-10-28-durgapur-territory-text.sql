-- ONE-OFF DATA FIX, run by lead as DB owner, not a migration. DO NOT run from the app or CI.
-- Purpose: fill doctors.city / chemists.city (raw territory text) where it is NULL/blank, from a
-- staging relation the lead loads IN THE SAME psql SESSION from a CSV kept OUTSIDE the repo (no
-- names ever enter the repo). Written for HQ-DURGAPUR, works for any HQ codes present in the file.
-- Run BEFORE 2026-10-28-territory-backfill.sql.
--
-- Staging relation (exact):
--   CREATE TEMP TABLE tmp_territory_source (hq_code text, entity text, name_key text, territory_text text);
--   \copy tmp_territory_source FROM '/path/outside/repo/durgapur-territories.csv' CSV HEADER
-- CSV header (exact):  hq_code,entity,name_key,territory_text
--   hq_code         territory code of the HQ, e.g. HQ-DURGAPUR
--   entity          doctor | chemist
--   name_key        the doctor/chemist name as in the Excel; raw is fine, the script normalises it
--   territory_text  the territory as written in the Excel column before City, e.g. DURGAPUR
-- Name normalisation (applied to BOTH sides; lead may use it to pre-check):
--   btrim(regexp_replace(regexp_replace(lower(<name>), '^\s*dr(\.|\s)\s*', ''), '[^a-z0-9]+', ' ', 'g'))
--   = lower case, leading "Dr."/"Dr " dropped (same as the doctor duplicate rule), every run of
--   non-alphanumerics -> one space, trimmed.
-- Aborts: relation missing (psql error) or empty, unknown entity, unknown/out-of-company hq_code, or
--   the same (hq_code, entity, name_key) with different territory_text. Exact duplicates are fine.
-- Writes: only live rows of those HQs whose city is NULL/blank; one audit_log row per row changed
--   (action '<entity>.territory_text_filled', after.fix = this file) = the rollback marker.
-- DRY RUN BY DEFAULT (report + ROLLBACK). -v apply=1 commits. Idempotent: a second apply changes 0.
-- Run:
--   psql "$URL" -v slug=arighna -v company_id=<uuid> -v ON_ERROR_STOP=1
--   =# CREATE TEMP TABLE tmp_territory_source (hq_code text, entity text, name_key text, territory_text text);
--   =# \copy tmp_territory_source FROM '/path/outside/repo/durgapur-territories.csv' CSV HEADER
--   =# \i packages/db/scripts/data-fixes/2026-10-28-durgapur-territory-text.sql
--   (then again with  \set apply 1  before \i  to commit)
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

CREATE TEMP TABLE _s ON COMMIT DROP AS
SELECT DISTINCT btrim(hq_code) AS hq_code, lower(btrim(entity)) AS entity,
       btrim(regexp_replace(regexp_replace(lower(name_key), '^\s*dr(\.|\s)\s*', ''), '[^a-z0-9]+', ' ', 'g')) AS k,
       upper(btrim(regexp_replace(territory_text, '\s+', ' ', 'g'))) AS terr
FROM tmp_territory_source;
SELECT count(*) AS n_src,
       count(*) FILTER (WHERE entity NOT IN ('doctor', 'chemist') OR k = '' OR coalesce(terr, '') = '') AS n_bad,
       count(*) FILTER (WHERE hq_code NOT IN (SELECT code FROM territories
                         WHERE company_id = :'company_id' AND deleted_at IS NULL)) AS n_bad_hq
FROM _s \gset
\echo 'staging rows (distinct):' :n_src ' bad entity/blank:' :n_bad ' unknown hq_code:' :n_bad_hq
\echo '== Conflicts: same HQ + entity + name with different territory_text'
SELECT hq_code, entity, k, array_agg(terr ORDER BY terr) FROM _s GROUP BY 1, 2, 3 HAVING count(*) > 1;
SELECT (:n_src > 0 AND :n_bad = 0 AND :n_bad_hq = 0
        AND NOT EXISTS (SELECT 1 FROM _s GROUP BY hq_code, entity, k HAVING count(*) > 1)) AS src_ok \gset
\if :src_ok
\else
  \echo 'ABORT: staging empty, invalid, unknown hq_code, or conflicting territory_text (see above)'
  ROLLBACK;
  \quit
\endif

CREATE TEMP TABLE _db ON COMMIT DROP AS
SELECT 'doctor'::text AS entity, d.id, h.code AS hq_code, d.city,
       btrim(regexp_replace(regexp_replace(lower(d.name), '^\s*dr(\.|\s)\s*', ''), '[^a-z0-9]+', ' ', 'g')) AS k
FROM doctors d JOIN territories h ON h.id = d.territory_id
WHERE d.company_id = :'company_id' AND d.deleted_at IS NULL AND h.code IN (SELECT hq_code FROM _s)
UNION ALL
SELECT 'chemist', c.id, h.code, c.city,
       btrim(regexp_replace(regexp_replace(lower(c.name), '^\s*dr(\.|\s)\s*', ''), '[^a-z0-9]+', ' ', 'g'))
FROM chemists c JOIN territories h ON h.id = c.territory_id
WHERE c.company_id = :'company_id' AND c.deleted_at IS NULL AND h.code IN (SELECT hq_code FROM _s);

CREATE TEMP TABLE _m ON COMMIT DROP AS
SELECT b.entity, b.id, b.hq_code, b.city, s.terr FROM _db b
JOIN _s s ON s.hq_code = b.hq_code AND s.entity = b.entity AND s.k = b.k;

\echo '== Matched (already filled rows are kept, not overwritten)'
SELECT entity, count(*) AS matched, count(*) FILTER (WHERE coalesce(btrim(city), '') = '') AS to_fill FROM _m GROUP BY 1 ORDER BY 1;
\echo '== Per territory (rows to fill)'
SELECT hq_code, entity, terr, count(*) FROM _m WHERE coalesce(btrim(city), '') = '' GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;
\echo '== Unmatched DB rows (stay as they are)'
SELECT b.hq_code, b.entity, count(*) FROM _db b LEFT JOIN _m m ON m.id = b.id WHERE m.id IS NULL GROUP BY 1, 2 ORDER BY 1, 2;
\echo '== Unmatched staging rows'
SELECT s.hq_code, s.entity, count(*) FROM _s s
WHERE NOT EXISTS (SELECT 1 FROM _db b WHERE b.hq_code = s.hq_code AND b.entity = s.entity AND b.k = s.k)
GROUP BY 1, 2 ORDER BY 1, 2;

WITH u AS (
  UPDATE doctors d SET city = m.terr, updated_at = now() FROM _m m
  WHERE m.entity = 'doctor' AND m.id = d.id AND coalesce(btrim(d.city), '') = ''
  RETURNING d.id, m.terr)
INSERT INTO audit_log (company_id, actor_user_id, action, entity_type, entity_id, before, after)
SELECT :'company_id', NULL, 'doctor.territory_text_filled', 'doctor', u.id::text, jsonb_build_object('city', NULL),
       jsonb_build_object('city', u.terr, 'fix', '2026-10-28-durgapur-territory-text') FROM u;
WITH u AS (
  UPDATE chemists c SET city = m.terr, updated_at = now() FROM _m m
  WHERE m.entity = 'chemist' AND m.id = c.id AND coalesce(btrim(c.city), '') = ''
  RETURNING c.id, m.terr)
INSERT INTO audit_log (company_id, actor_user_id, action, entity_type, entity_id, before, after)
SELECT :'company_id', NULL, 'chemist.territory_text_filled', 'chemist', u.id::text, jsonb_build_object('city', NULL),
       jsonb_build_object('city', u.terr, 'fix', '2026-10-28-durgapur-territory-text') FROM u;
SELECT count(*) AS rows_filled_this_run FROM audit_log
WHERE company_id = :'company_id' AND action LIKE '%.territory_text_filled' AND at = now();

\if :apply
  COMMIT;
  \echo 'APPLIED'
\else
  ROLLBACK;
  \echo 'DRY RUN: rolled back. \set apply 1 and re-run to commit.'
\endif
-- ROLLBACK SQL (run separately; clears only rows this fix filled and nobody changed since):
-- BEGIN; SELECT set_config('app.current_company_id', '<uuid>', true);
-- UPDATE doctors d SET city = NULL, updated_at = now() FROM audit_log a
--  WHERE a.action = 'doctor.territory_text_filled' AND a.after->>'fix' = '2026-10-28-durgapur-territory-text'
--    AND a.entity_id = d.id::text AND d.city = a.after->>'city';
-- UPDATE chemists c SET city = NULL, updated_at = now() FROM audit_log a
--  WHERE a.action = 'chemist.territory_text_filled' AND a.after->>'fix' = '2026-10-28-durgapur-territory-text'
--    AND a.entity_id = c.id::text AND c.city = a.after->>'city';
-- COMMIT;
