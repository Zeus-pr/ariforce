# One-off data fixes

Not migrations. The lead runs each as the DB owner via the vetted executor, in a single transaction,
with `-v slug=<company slug> -v company_id=<company uuid>` (forced RLS needs the tenant GUC; the
script aborts if id and slug do not match). Each script prints before/after checks, is idempotent
(a second run changes 0 rows) and carries a commented rollback block. Run order:

| #   | Script                                             | Writes? | Purpose                                                                                              |
| --- | -------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------- |
| 1   | `2026-10-27-retired-role-holders-report.sql`       | No      | Lists users holding `distribution_head` / `accountant` and what depends on them                      |
| 2   | `2026-10-27-retire-functional-role-holders.sql`    | Yes     | Suspends login-less retired-role holders, revokes open invites, audits; aborts if more than 2        |
| 3   | `2026-10-27-territory-level-violations-report.sql` | No      | BMs on non-HQ territories, hierarchy users with no territory, tree-shape/path issues                 |
| 4   | `2026-10-27-burdwan-reparent.sql`                  | Yes     | HQ-BURDWAN -> `area`, parent of HQ-BURDWAN-BMCH and HQ-BURDWAN-ANAMOY; paths rebuilt; counts checked |
| 5   | `2026-10-27-territory-level-violations-report.sql` | No      | Re-run to confirm                                                                                    |

| 6 | `2026-10-28-durgapur-territory-text.sql` | Dry run unless `apply=1` | Fills blank `doctors/chemists.city` from session relation `tmp_territory_source` (CSV outside the repo) |
| 7 | `2026-10-28-territory-backfill.sql` | Dry run unless `-v apply=1` | Creates `territory` rows under each HQ from `city` (or `-v map=`), links `local_territory_id`; duplicate/near-duplicate report |

Order for 6-7: apply migration 0042 first, then 6, then 7 (dry run first each time). Test-run on a
local DB with fake data only.

CSV for 6 (header exact): `hq_code,entity,name_key,territory_text` (`entity` = doctor|chemist,
`name_key` = name as in the Excel, normalised by the script). Run:

```
psql "$URL" -v slug=arighna -v company_id=<uuid> -v ON_ERROR_STOP=1
=# CREATE TEMP TABLE tmp_territory_source (hq_code text, entity text, name_key text, territory_text text);
=# \copy tmp_territory_source FROM '/path/outside/repo/durgapur-territories.csv' CSV HEADER
=# \i packages/db/scripts/data-fixes/2026-10-28-durgapur-territory-text.sql      -- dry run
=# \set apply 1
=# \i packages/db/scripts/data-fixes/2026-10-28-durgapur-territory-text.sql      -- commit
```

Migrations (0040 etc.) must be applied before 2. All four were test-run on a local fresh DB with
fake data as `ariforce_app`: first run, idempotent second run, abort paths, rollback, re-apply.
