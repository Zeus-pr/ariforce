-- ONE-OFF DATA FIX, run by lead as DB owner, not a migration. DO NOT run from the app or CI.
-- Needs migration 0042_territory_city. See docs/TERRITORY-MODEL.md.
--
-- Creates one 'territory' (city) under each HQ for every distinct normalised doctor/chemist city
-- (business key company + HQ + ariforce_city_key(city)) and sets doctors/chemists.city_territory_id.
-- doctors/chemists.territory_id (the HQ) is never changed; nothing is deleted or merged.
-- DRY RUN BY DEFAULT: prints the report and rolls back. Pass -v apply=1 to commit.
-- Idempotent: a second apply creates 0 territories and links 0 rows. Rows already linked are kept.
-- Fuzzy matches (Bardhaman vs Burdwan, typos) are only LISTED for review, never merged: fix the
-- source city (masters edit or re-import), then re-run.
-- Run:  psql "$URL" -v slug=arighna -v company_id=<uuid> [-v apply=1] -v ON_ERROR_STOP=1 -f 2026-10-28-territory-city-backfill.sql
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

-- Source rows: live doctors/chemists with their HQ and city.
CREATE TEMP TABLE _src ON COMMIT DROP AS
SELECT 'doctor'::text AS kind, d.id, d.territory_id AS hq_id, d.city, ariforce_city_key(d.city) AS key,
       d.city_territory_id
FROM doctors d WHERE d.company_id = :'company_id' AND d.deleted_at IS NULL
UNION ALL
SELECT 'chemist', c.id, c.territory_id, c.city, ariforce_city_key(c.city), c.city_territory_id
FROM chemists c WHERE c.company_id = :'company_id' AND c.deleted_at IS NULL;

\echo '== 1. Rows whose territory_id is not an HQ (skipped; city stays unlinked)'
SELECT t.code, t.level::text, s.kind, count(*) FROM _src s JOIN territories t ON t.id = s.hq_id
WHERE t.level::text <> 'headquarter' GROUP BY 1, 2, 3 ORDER BY 1, 3;

\echo '== 2. Blank city per HQ (left unlinked)'
SELECT t.code AS hq, s.kind, count(*) FROM _src s JOIN territories t ON t.id = s.hq_id
WHERE s.key IS NULL GROUP BY 1, 2 ORDER BY 1, 2;

CREATE TEMP TABLE _city ON COMMIT DROP AS
SELECT s.hq_id, h.code AS hq_code, h.path AS hq_path, s.key,
       count(*) AS n,
       array_agg(DISTINCT btrim(s.city)) AS spellings,
       mode() WITHIN GROUP (ORDER BY btrim(s.city)) AS top_spelling
FROM _src s JOIN territories h ON h.id = s.hq_id AND h.level::text = 'headquarter' AND h.deleted_at IS NULL
WHERE s.key IS NOT NULL GROUP BY 1, 2, 3, 4;

\echo '== 3. Cities per HQ (key, rows, raw spellings merged by normalisation only)'
SELECT hq_code, key, n, spellings FROM _city ORDER BY hq_code, key;

\echo '== 4. NEAR DUPLICATES for human review (same HQ; same key without vowels/h, or same first 4 letters). NOT merged.'
SELECT a.hq_code, a.key AS city_a, a.n AS n_a, b.key AS city_b, b.n AS n_b
FROM _city a JOIN _city b ON a.hq_id = b.hq_id AND a.key < b.key
WHERE translate(a.key, 'aeiouhy ', '') = translate(b.key, 'aeiouhy ', '')
   OR left(replace(a.key, ' ', ''), 4) = left(replace(b.key, ' ', ''), 4)
ORDER BY 1, 2, 4;

\echo '== 5. Same city key under several HQs (fine by design; listed for awareness)'
SELECT key, array_agg(hq_code ORDER BY hq_code) AS hqs FROM _city GROUP BY key HAVING count(*) > 1 ORDER BY key;

-- Create missing city territories. Code: <HQ code>-<KEY> (spaces -> '-'), max 32 chars; if that
-- code is already taken by another territory a short id suffix is used. Path follows the HQ's
-- convention: code-based segment when the HQ's own last segment is not its id, else the new id.
CREATE TEMP TABLE _new ON COMMIT DROP AS
SELECT c.*, gen_random_uuid() AS id,
       left(c.hq_code || '-' || upper(replace(c.key, ' ', '-')), 32) AS code0
FROM _city c
WHERE NOT EXISTS (SELECT 1 FROM territories t WHERE t.company_id = :'company_id' AND t.parent_id = c.hq_id
                  AND t.city_key = c.key AND t.deleted_at IS NULL);
UPDATE _new n SET code0 = left(n.code0, 23) || '-' || left(n.id::text, 8)
WHERE EXISTS (SELECT 1 FROM territories t WHERE t.company_id = :'company_id' AND t.code = n.code0)
   OR (SELECT count(*) FROM _new m WHERE m.code0 = n.code0) > 1;
INSERT INTO territories (id, company_id, parent_id, level, code, name, path, city, city_key)
SELECT n.id, :'company_id', n.hq_id, 'territory', n.code0, initcap(n.top_spelling),
       n.hq_path || '.' || CASE WHEN split_part(n.hq_path, '.', -1) = n.hq_id::text THEN n.id::text
                               ELSE regexp_replace(n.code0, '[^A-Za-z0-9]', '_', 'g') END,
       initcap(n.top_spelling), n.key
FROM _new n;
SELECT count(*) AS territories_created FROM _new;

-- Link rows that are still unlinked (never overwrite an existing city_territory_id).
WITH m AS (
  SELECT s.id, t.id AS tid FROM _src s
  JOIN territories t ON t.company_id = :'company_id' AND t.parent_id = s.hq_id AND t.city_key = s.key
       AND t.deleted_at IS NULL
  WHERE s.kind = 'doctor' AND s.city_territory_id IS NULL)
UPDATE doctors d SET city_territory_id = m.tid FROM m WHERE d.id = m.id;
WITH m AS (
  SELECT s.id, t.id AS tid FROM _src s
  JOIN territories t ON t.company_id = :'company_id' AND t.parent_id = s.hq_id AND t.city_key = s.key
       AND t.deleted_at IS NULL
  WHERE s.kind = 'chemist' AND s.city_territory_id IS NULL)
UPDATE chemists c SET city_territory_id = m.tid FROM m WHERE c.id = m.id;

\echo '== 6. After: linked / unlinked, and checks (each city sits under the row''s HQ)'
SELECT 'doctors' AS t, count(city_territory_id) AS linked, count(*) - count(city_territory_id) AS unlinked
FROM doctors WHERE company_id = :'company_id' AND deleted_at IS NULL
UNION ALL SELECT 'chemists', count(city_territory_id), count(*) - count(city_territory_id)
FROM chemists WHERE company_id = :'company_id' AND deleted_at IS NULL;
SELECT count(*) AS bad_links FROM (
  SELECT d.id FROM doctors d JOIN territories t ON t.id = d.city_territory_id WHERE t.parent_id <> d.territory_id
  UNION ALL
  SELECT c.id FROM chemists c JOIN territories t ON t.id = c.city_territory_id WHERE t.parent_id <> c.territory_id) x;

\if :apply
  COMMIT;
  \echo 'APPLIED'
\else
  ROLLBACK;
  \echo 'DRY RUN: rolled back. Re-run with -v apply=1 to commit.'
\endif
-- ROLLBACK SQL (run separately if needed; removes only what this script created):
-- BEGIN; SELECT set_config('app.current_company_id', '<uuid>', true);
-- UPDATE doctors SET city_territory_id = NULL WHERE company_id = '<uuid>' AND city_territory_id IS NOT NULL;
-- UPDATE chemists SET city_territory_id = NULL WHERE company_id = '<uuid>' AND city_territory_id IS NOT NULL;
-- DELETE FROM territories WHERE company_id = '<uuid>' AND level = 'territory' AND city_key IS NOT NULL;
-- COMMIT;
