-- ONE-OFF DATA FIX, run by lead as DB owner via the migration executor. NOT a migration.
-- DO NOT run from the app or CI.
-- Purpose: meeting sub-types (contract #121). Meeting details.title becomes a closed list
-- ('Cycle Meeting' | 'Review Meeting'). Old rows hold free text. This rewrites ONLY titles that
-- clearly say one of them (contain "cycle" but not "review", or "review" but not "cycle",
-- case-insensitive) to the exact label. Everything else is left as is (reads tolerate it).
-- The old text is kept in details.legacyTitle (never overwritten), so nothing is lost.
-- Covers dcrs.details and tour_plan_items.plan->'details' (kind = 'meeting' only), all companies.
-- DRY RUN BY DEFAULT (report + ROLLBACK); -v apply=1 commits. Re-runnable: a second apply changes 0
-- (rewritten titles are exact labels and no longer match).
-- Run:  psql "$URL" [-v apply=1] -v ON_ERROR_STOP=1 -f 2026-11-04-meeting-title-normalise.sql
\if :{?apply}
\else
  \set apply 0
\endif
\set ON_ERROR_STOP 1
BEGIN;
CREATE TEMP TABLE _mt_map ON COMMIT DROP AS
  SELECT 'dcr'::text AS src, id, details->>'title' AS old_title,
         CASE WHEN details->>'title' ~* 'cycle' THEN 'Cycle Meeting' ELSE 'Review Meeting' END AS new_title
    FROM dcrs
   WHERE details->>'kind' = 'meeting'
     AND details->>'title' NOT IN ('Cycle Meeting', 'Review Meeting')
     AND ((details->>'title' ~* 'cycle') <> (details->>'title' ~* 'review'))
  UNION ALL
  SELECT 'tp_item', id, plan->'details'->>'title',
         CASE WHEN plan->'details'->>'title' ~* 'cycle' THEN 'Cycle Meeting' ELSE 'Review Meeting' END
    FROM tour_plan_items
   WHERE plan->'details'->>'kind' = 'meeting'
     AND plan->'details'->>'title' NOT IN ('Cycle Meeting', 'Review Meeting')
     AND ((plan->'details'->>'title' ~* 'cycle') <> (plan->'details'->>'title' ~* 'review'));

-- Report: what would change, and what stays legacy text.
SELECT src, old_title, new_title, count(*) AS rows FROM _mt_map GROUP BY 1, 2, 3 ORDER BY 1, 2;
SELECT 'dcr' AS src, details->>'title' AS stays_legacy, count(*) AS rows
  FROM dcrs
 WHERE details->>'kind' = 'meeting'
   AND details->>'title' NOT IN ('Cycle Meeting', 'Review Meeting')
   AND id NOT IN (SELECT id FROM _mt_map WHERE src = 'dcr')
 GROUP BY 2
UNION ALL
SELECT 'tp_item', plan->'details'->>'title', count(*)
  FROM tour_plan_items
 WHERE plan->'details'->>'kind' = 'meeting'
   AND plan->'details'->>'title' NOT IN ('Cycle Meeting', 'Review Meeting')
   AND id NOT IN (SELECT id FROM _mt_map WHERE src = 'tp_item')
 GROUP BY 2
 ORDER BY 1, 2;

UPDATE dcrs d
   SET details = d.details
       || jsonb_build_object('title', m.new_title)
       || CASE WHEN d.details ? 'legacyTitle' THEN '{}'::jsonb
               ELSE jsonb_build_object('legacyTitle', m.old_title) END
  FROM _mt_map m
 WHERE m.src = 'dcr' AND m.id = d.id;
UPDATE tour_plan_items t
   SET plan = jsonb_set(t.plan, '{details}', (t.plan->'details')
       || jsonb_build_object('title', m.new_title)
       || CASE WHEN t.plan->'details' ? 'legacyTitle' THEN '{}'::jsonb
               ELSE jsonb_build_object('legacyTitle', m.old_title) END)
  FROM _mt_map m
 WHERE m.src = 'tp_item' AND m.id = t.id;
SELECT (SELECT count(*) FROM _mt_map WHERE src = 'dcr') AS dcrs_rewritten,
       (SELECT count(*) FROM _mt_map WHERE src = 'tp_item') AS tp_items_rewritten;
\if :apply
  COMMIT;
  \echo 'APPLIED'
\else
  ROLLBACK;
  \echo 'DRY RUN: rolled back. Re-run with -v apply=1 to commit.'
\endif
-- ROLLBACK (after apply): restore from legacyTitle, e.g.
--   UPDATE dcrs SET details = (details - 'legacyTitle') || jsonb_build_object('title', details->>'legacyTitle')
--    WHERE details ? 'legacyTitle';
-- and the same on tour_plan_items.plan->'details'.
