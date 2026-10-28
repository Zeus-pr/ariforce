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

| 6 | `2026-10-28-territory-city-backfill.sql` | Dry run unless `-v apply=1` | Creates city `territory` rows under each HQ from doctor/chemist `city`, links `city_territory_id`; duplicate/near-duplicate report |

Script 6 needs migration 0042; test-run on a local DB with fake data only (dry run, apply, idempotent re-apply).

Migrations (0040 etc.) must be applied before 2. All four were test-run on a local fresh DB with
fake data as `ariforce_app`: first run, idempotent second run, abort paths, rollback, re-apply.
