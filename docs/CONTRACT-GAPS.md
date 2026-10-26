# Contract gaps (web)

Against the contracts on `feat/roles-hierarchy` (merged locally into the web branches). Nothing here is invented in the UI; where a gap blocks a feature, the screen says so.

## Closed by feat/contracts-gaps / feat/roles-hierarchy
- Lists: `sort`, `includeTotal`, `q`, filters (territory / specialty / category) are used by Masters; the pager shows real totals.
- Territories paginate past 200; the lookups page through every cursor.
- Import: `POST /v1/{doctors|chemists|stockists}/import` dry run then save, with `onDuplicate`; per-row results shown.
- Roles: the web uses the contract `ROLE_KEYS` / `HIERARCHY_ROLE_KEYS` directly.

## Open
1. **Import row keys.** `docs/IMPORT.md` says rows are keyed by template columns (`territory_code`, `specialty_code`, snake_case). The mock validates rows with the entity *create* schema (camelCase, ids). The web currently sends create-schema rows (ids resolved client-side) because that is what the mock accepts. Please pick one and align docs + mock.
2. **Import file audit.** The wizard does not upload the source file to R2 yet (`fileId` is optional); will wire `/v1/files/upload-url` once the mock supports PUT to the presigned URL.
3. **KPI endpoints** for the dashboard (still mock data in the web).
4. Specialties and categories are read-only (no create in Masters by design).
