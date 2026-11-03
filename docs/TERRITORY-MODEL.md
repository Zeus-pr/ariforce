# Territory model: HQ vs territory

Status: proposal + additive schema (migration 0042, `feat/territory-city-split`). Nothing existing changes meaning.

## Today (findings)

- `territories` (`packages/db/src/schema/tenancy.ts`): one tree, levels `national > zone > region > area > headquarter`, `path` = parent path + `.` + segment (code-based in production), unique `(company_id, code)`. Already has `city`/`state` columns (unused for HQs).
- People: `user_territories` holds HQs (BM: headquarter only via `assignableTerritoryLevels`, `packages/contracts/src/schemas/territories.ts`; enforced in `team.service.ts assertTerritoryLevels`). Scope = path subtree of the user's territories (`TenantService.scope`), so ABM on HQ-BURDWAN (area) sees both Burdwan HQs.
- Masters: `doctors/chemists/stockists.territory_id` NOT NULL = the HQ; city is free text `city` (the shared `contact()` columns, `masters.ts`), searchable in `master-defs.ts`. Raw import rows are kept in `import_rows.raw` (jsonb); the importer (`apps/api/src/masters/imports.service.ts`, `packages/contracts/src/import/templates.ts`) maps `territory` code -> HQ and copies `city` as text. There is no staging table and no HQ-name list in the repo: which 3 other HQ Excels were loaded is only visible in the real DB (`import_jobs`/`import_rows`), which I did not query.
- SFC (`sfc_routes.hq_territory_id`, `sfc.service.ts`) and allowances (`allowances.engine.ts`) filter `level = 'headquarter'`; From/To are text.
- DCR: `dcrs.territory_ids uuid[]` validated by scope (`dcr.service.ts`); tour plans similar. KPI view `kpi_user_doctor_list` (0041) joins `doctors.territory_id` to the user's subtree.

## Model (0042)

Names: the tree level is `territory` (a unit under an HQ). HQ stays HQ (`headquarter`).

| Thing                 | Name                                                                                                                                                                                                 |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Level value           | `territory_level` = `'territory'` (child of `headquarter`)                                                                                                                                           |
| Normalised key column | `territories.territory_key`                                                                                                                                                                          |
| Key function          | `ariforce_territory_key(text)`: lower case, non-alphanumerics -> one space, trimmed, blank -> null                                                                                                   |
| Unique business key   | `territories_hq_territory_key_uq` on `(company_id, parent_id, territory_key)`, live rows                                                                                                             |
| Link on masters       | `doctors.local_territory_id`, `chemists.local_territory_id`, `stockists.local_territory_id` (nullable FK, indexes `*_local_territory_idx`); the stockist column exists (0042, applied) but is unused |
| HQ link (unchanged)   | `doctors/chemists/stockists.territory_id`                                                                                                                                                            |
| Raw source text       | `doctors.city`, `chemists.city`: raw imported data, names kept as is                                                                                                                                 |

- `local_territory_id` was chosen because `territory_id` already means the HQ; renaming that would touch scope, KPIs, SFC and the importer.
- Territory code: `<HQ code>-<KEY>` (32 max, id suffix on clash). Never matched by name alone.
- People are never assigned a `territory`: `assignableTerritoryLevels` returns `PEOPLE_TERRITORY_LEVELS` (422 `TERRITORY_LEVEL_INVALID`).

## Data steps (lead, see `packages/db/scripts/data-fixes/README.md`)

1. Apply migration `0042_territory_level`.
2. Durgapur only: `2026-10-28-durgapur-territory-text.sql` fills blank `city` from a session staging relation loaded from a CSV kept outside the repo.
3. `2026-10-28-territory-backfill.sql` (dry run first): creates territories per HQ from `city` (or an optional per-row mapping relation `-v map=`), links `local_territory_id`, lists blanks (e.g. Bankura) and near duplicates for review. Fuzzy matches are never merged.

## Decisions (Prajesh, 2026-10-28)

- Doctors/chemists stay keyed to the HQ (`territory_id`); the territory is the extra link `local_territory_id`.
- No alias list (data is clean); a territory under one HQ may carry another town's name (e.g. one under Bankura) and stays there.
- Near-duplicate report kept for later imports; never auto-merge.
- Blank source text stays unlinked (counted in the report).
- BMs filter by HQ only.
- Stockists: later.

## Territory link import (built, `feat/territory-importer`)

`POST /v1/imports/territory-links` (Director / System Admin: `imports:write` + `territories:write` +
`masters:write`, company-wide) and the CLI `apps/api/scripts/import-territory-links.mts` run the same
code (`apps/api/src/masters/territory-links.ts` + the pure planner
`packages/contracts/src/import/territory-links.ts`, also used by the MSW mock). Dry run by default.

Row: `hq_code`, `entity` (`doctor` | `chemist`), `name_key`, `territory_text` (camelCase / sheet
headers accepted). Per row:

1. HQ by code (case-insensitive, live, level `headquarter`); else `unmatched` `unknown_hq` /
   `not_headquarter`.
2. Territory text -> key (same rule as `ariforce_territory_key`); blank -> `skipped` `blank_territory`.
3. Doctor/chemist under exactly that HQ whose name key matches (lower case, leading "Dr." dropped,
   non-alphanumerics -> one space; the durgapur data-fix rule). 0 -> `unmatched` `no_match`; more than
   one -> `unmatched` `ambiguous` (`candidateIds`). Never matched across HQs.
4. Territory under the HQ with that key is reused, else created once per run (level `territory`,
   code `<HQ code>-<KEY>`, 32 max, id suffix on a code clash; path follows the HQ convention;
   `ON CONFLICT DO NOTHING` on the business key). Only created when a row will link to it.
5. `local_territory_id` set (`linked`); same target already -> `already_linked`; a different existing
   link is kept (`skipped` `linked_elsewhere`) unless `onLinked: replace`.

In-file checks: same HQ + entity + name with different territories -> `error` `conflict_in_file`
(all such rows); exact repeats -> `skipped` `duplicate_in_file`. Near duplicates (backfill rule) are
listed, never merged. Re-running a file changes nothing. Audit: `territory.import_create` per
territory, `territory_links.apply` with the linked ids per entity (rollback marker), dry runs via the
endpoint `territory_links.dry_run`. Not stored in `import_jobs`. Against a shared/production DB use the
CLI's `--read-only` (one `SET TRANSACTION READ ONLY` transaction, verified, always rolled back; works
through the Supabase transaction pooler, where `PGOPTIONS` is ignored).

DTOs: `Doctor.localTerritoryId`, `Chemist.localTerritoryId` (nullable, read-only; cleared when the
HQ `territoryId` changes on PATCH). List filter `localTerritoryId=<id>` or `none` on
`GET /v1/doctors` and `GET /v1/chemists`. Stockists: still later (not in the DTO).

Still open: the doctors/chemists Excel import (`POST /v1/doctors/import`) does not take a territory
column yet; load masters first, then run the link import.

## Impact

| Area                        | Impact                                                                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Visibility (BM/ABM)         | None: still the HQ subtree / reporting line. Optional later: filter lists by city.                                                                |
| Territory pickers           | `GET /v1/territories` can now return `level: 'territory'` rows (widened enum: web must handle or filter); `assignableForRole` never returns them. |
| Masters                     | `localTerritoryId` on doctor/chemist DTOs + list filter; set by the territory link import (read-only on create/edit; cleared on HQ change).       |
| SFC                         | Unchanged (per employee + HQ, From/To text). The DCR redesign may key routes by city (see Part 2).                                                |
| KPIs, approvals, allowances | Unchanged (keyed on HQ).                                                                                                                          |
| Stockists                   | Column in 0042 (applied), unused; linking later.                                                                                                  |

## DCR band and Work With

SFC category is a fixed enum `ex` | `hq` | `os` mapped to the DCR band `ex_hq` / `hq` / `outstation`;
legacy text is converted by a data fix. Change list and misfit proposals: `docs/DCR-REDESIGN-DESIGN.md`.
Meeting never uses SFC. Work With: anyone; recorded, not part of the SFC match (HQ + band: the filer's own routes on that HQ, else the HQ's routes; see DCR-REDESIGN-DESIGN.md).
