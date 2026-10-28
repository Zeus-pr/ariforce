# Territory model: HQ vs territory (city)

Status: proposal + additive schema (migration 0042, `feat/territory-city-split`). Nothing existing changes meaning.

## Today (findings)

- `territories` (`packages/db/src/schema/tenancy.ts`): one tree, levels `national > zone > region > area > headquarter`, `path` = parent path + `.` + segment (code-based in production), unique `(company_id, code)`. Already has `city`/`state` columns (unused for HQs).
- People: `user_territories` holds HQs (BM: headquarter only via `assignableTerritoryLevels`, `packages/contracts/src/schemas/territories.ts`; enforced in `team.service.ts assertTerritoryLevels`). Scope = path subtree of the user's territories (`TenantService.scope`), so ABM on HQ-BURDWAN (area) sees both Burdwan HQs.
- Masters: `doctors/chemists/stockists.territory_id` NOT NULL = the HQ; city is free text `city` (the shared `contact()` columns, `masters.ts`), searchable in `master-defs.ts`. Raw import rows are kept in `import_rows.raw` (jsonb); the importer (`apps/api/src/masters/imports.service.ts`, `packages/contracts/src/import/templates.ts`) maps `territory` code -> HQ and copies `city` as text. There is no staging table and no HQ-name list in the repo: which 3 other HQ Excels were loaded is only visible in the real DB (`import_jobs`/`import_rows`), which I did not query.
- SFC (`sfc_routes.hq_territory_id`, `sfc.service.ts`) and allowances (`allowances.engine.ts`) filter `level = 'headquarter'`; From/To are text.
- DCR: `dcrs.territory_ids uuid[]` validated by scope (`dcr.service.ts`); tour plans similar. KPI view `kpi_user_doctor_list` (0041) joins `doctors.territory_id` to the user's subtree.

## Model (0042)

- New level `territory` (city), child of an HQ, in the same `territories` table (same path/scope machinery; subtree of an HQ now includes its cities).
- Business key: `territories.city_key = ariforce_city_key(city)` (lower case, non-alphanumerics -> one space, trimmed) with unique index `(company_id, parent_id, city_key)` for live rows. Never name alone. Code: `<HQ code>-<KEY>` (32 max, id suffix on clash).
- `doctors.city_territory_id`, `chemists.city_territory_id`: nullable FK, additive. `territory_id` stays the HQ, so scope, KPIs, SFC, allowances, approvals and existing clients are unchanged.
- People are never assigned a `territory`: `assignableTerritoryLevels` excludes it for every role (422 `TERRITORY_LEVEL_INVALID`).
- Backfill: `packages/db/scripts/data-fixes/2026-10-28-territory-city-backfill.sql` (dry run default, `-v apply=1` to commit, idempotent). Reports non-HQ rows, blanks, spellings merged by normalisation, near duplicates (same consonants or same first 4 letters) for human review. Fuzzy matches and aliases (Bardhaman/Burdwan) are never auto-merged.

## Impact

| Area                        | Impact                                                                                                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Visibility (BM/ABM)         | None: still the HQ subtree / reporting line. Optional later: filter lists by city.                                                                                    |
| Territory pickers           | `GET /v1/territories` can now return `level: 'territory'` rows (widened enum: web must handle or filter); `assignableForRole` never returns them.                     |
| Masters                     | Not yet exposed: next step adds `cityTerritoryId` to doctor/chemist DTOs, filters, import (`territory` = HQ code + `city`) and creates/links the city on create/edit. |
| SFC                         | Unchanged (per employee + HQ, From/To text). The DCR redesign may key routes by city (see Part 2).                                                                    |
| KPIs, approvals, allowances | Unchanged (keyed on HQ).                                                                                                                                              |
| Stockists                   | Not included (stockists usually serve an HQ); question open.                                                                                                          |
