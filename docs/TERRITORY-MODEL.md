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

| Thing                 | Name                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Level value           | `territory_level` = `'territory'` (child of `headquarter`)                                                                                 |
| Normalised key column | `territories.territory_key`                                                                                                                |
| Key function          | `ariforce_territory_key(text)`: lower case, non-alphanumerics -> one space, trimmed, blank -> null                                         |
| Unique business key   | `territories_hq_territory_key_uq` on `(company_id, parent_id, territory_key)`, live rows                                                   |
| Link on masters       | `doctors.local_territory_id`, `chemists.local_territory_id`, `stockists.local_territory_id` (nullable FK, indexes `*_local_territory_idx`) |
| HQ link (unchanged)   | `doctors/chemists/stockists.territory_id`                                                                                                  |
| Raw source text       | `doctors.city`, `chemists.city`: raw imported data, names kept as is                                                                       |

- `local_territory_id` was chosen because `territory_id` already means the HQ; renaming that would touch scope, KPIs, SFC and the importer.
- Territory code: `<HQ code>-<KEY>` (32 max, id suffix on clash). Never matched by name alone.
- People are never assigned a `territory`: `assignableTerritoryLevels` returns `PEOPLE_TERRITORY_LEVELS` (422 `TERRITORY_LEVEL_INVALID`).

## Data steps (lead, see `packages/db/scripts/data-fixes/README.md`)

1. Apply migration `0042_territory_level`.
2. Durgapur only: `2026-10-28-durgapur-territory-text.sql` fills blank `city` from a session staging relation loaded from a CSV kept outside the repo.
3. `2026-10-28-territory-backfill.sql` (dry run first): creates territories per HQ from `city` (or an optional per-row mapping relation `-v map=`), links `local_territory_id`, lists blanks (e.g. Bankura) and near duplicates for review. Fuzzy matches are never merged.

## Impact

| Area                        | Impact                                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Visibility (BM/ABM)         | None: still the HQ subtree / reporting line. Optional later: filter lists by city.                                                                      |
| Territory pickers           | `GET /v1/territories` can now return `level: 'territory'` rows (widened enum: web must handle or filter); `assignableForRole` never returns them.       |
| Masters                     | Not yet exposed: next step adds `localTerritoryId` to doctor/chemist/stockist DTOs, filters and import, and creates/links the territory on create/edit. |
| SFC                         | Unchanged (per employee + HQ, From/To text). The DCR redesign may key routes by city (see Part 2).                                                      |
| KPIs, approvals, allowances | Unchanged (keyed on HQ).                                                                                                                                |
| Stockists                   | Not included (stockists usually serve an HQ); question open.                                                                                            |

## DCR band and Work With (design note, no schema change)

Band = the existing `sfc_routes.category` (no new column). The SFC importer stores it via
`normCategory()` (`apps/api/src/sfc/sfc-import.ts`: trimmed, upper case, spacing around `/` unified);
the API accepts free text up to 40 chars. Band is derived by mapping a key = category upper-cased with
every non-alphanumeric removed:

| Category values seen (6 SFC sheets) and variants      | Key                           | Band                                                                                        |
| ----------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------- |
| `HQ`, `H.Q.`, `hq`                                    | `HQ`                          | `hq`                                                                                        |
| `EX`, `EX HQ`, `EX-HQ`, `EXHQ`, `ex hq`               | `EX`, `EXHQ`                  | `ex_hq`                                                                                     |
| `OS`, `O/S`, `OUT STATION`, `OUTSTATION`, `OUT EX HQ` | `OS`, `OUTSTATION`, `OUTEXHQ` | `outstation`                                                                                |
| `EX / OS` (2 rows)                                    | `EXOS`                        | ambiguous: no band; route offered for both ex_hq and outstation, or fixed in SFC (question) |
| `MEETING` (16 rows)                                   | `MEETING`                     | not a field band: never matched for Field DCR (meeting routes; question)                    |
| null / blank / anything else                          |                               | unknown: no band, not matched, listed in an SFC data report                                 |

The band of a field DCR comes from its work type (`FIELD_HQ` hq, `FIELD_EXHQ` ex_hq, `FIELD_OUT`
outstation, `work_types.allowance_band`); an SFC route matches when its mapped band equals it. Unknown
values never get invented rates.

Work With: anyone can work with anyone (no hierarchy/HQ restriction); stored as today on calls
(`dcr_calls.joint_work_user_ids`) and not part of the SFC match key.
