# Excel / CSV import

Master data arrives as Excel today, so import is a first-class feature. The web wizard parses
`.xlsx`/`.csv` in the browser, maps columns to the templates below, and calls
`POST /v1/{entity}/import` (contracts: `ImportRequest`, `ImportJob`, `ImportRowResult`).
Importable: `doctors`, `chemists`, `stockists`, `products`, `divisions`, `territories`,
`product-hq-mappings` (users: later).

**Row format (one format, gap #1):** each row is an object keyed by the snake_case template columns
below, with masters referenced by **code** (`territory_code`, `division_code`, …). The mapper lives in
`@ariforce/contracts` (`mapImportRow`, `duplicateKeys`) and is run by both the real API and the MSW mock.
Accepted aliases, so a client can reuse the create body: camelCase keys (`territoryCode`,
`registrationNo`), header spacing/case (`Territory Code`), `*_id` UUIDs instead of codes
(`territory_id` / `territoryId`), and `location: {lat, lng}` / `centroid: {lat, lng}`. `Y`/`N`
(also yes/no/true/false/1/0) for booleans; numbers may contain thousands separators. Codes are
case-insensitive; a territory code outside the caller's hierarchy counts as unknown. Errors name the
template column (`territory_code`, not `territoryId`).

## Flow

1. Upload the source file to R2 for audit (gap #2): `POST /v1/files/upload-url` with
   `purpose: "import_source"` and `contentType` `text/csv` or the `.xlsx` type (needs `imports:write`),
   PUT the bytes, then pass the returned `fileKey` in every import request for that sheet. Parse it
   client-side.
2. **Dry run** (`dryRun: true`, the default): every row is validated with the entity's create schema,
   codes are resolved (territory, specialty, category, division, product), duplicate rules run. Nothing
   is written to the master tables; the job and its row results are stored (`import_jobs`/`import_rows`)
   as evidence. Response `200`. The response is a preview with per-row `status` (`valid` / `duplicate` / `error`),
   `errors[] {column, code, message}`, `duplicateOf` and `duplicateRule`.
3. User fixes the sheet or picks `onDuplicate` (`skip` | `update` | `error`), then re-posts with
   `dryRun: false` and the same `Idempotency-Key` header. Rows become `created` / `updated` /
   `skipped` / `error` (response `201`). Valid rows are saved even if others fail (one savepoint per
   row); the job is audited (`import.apply`, dry runs `import.dry_run`). Replaying the same
   `Idempotency-Key` + `dryRun` returns the stored job; reusing it for another entity or `onDuplicate`
   is `409 IDEMPOTENCY_CONFLICT`. `onDuplicate: update` is not supported for territories (skipped).
4. `GET /v1/imports/{id}` returns the job and per-row results (downloadable as an error report).

Limits: 5,000 rows per request (split larger sheets), header row required, UTF-8 CSV, dates as
`YYYY-MM-DD`, empty cell = null. Permissions: `imports:write` (Director, System Admin); field users add
single records instead.

## Duplicate rules (#26)

Single doctor creates (`POST /v1/doctors`) use the same doctor rules: registration no. → `409 DOCTOR_DUPLICATE`, name + pincode → `409 DOCTOR_POSSIBLE_DUPLICATE` (overridable). See docs/DOCTOR-APPROVAL.md.

| Entity                 | Rule order                                                                |
| ---------------------- | ------------------------------------------------------------------------- |
| Doctors                | `registration_no` (case-insensitive), then name (without "Dr.") + pincode |
| Chemists, stockists    | GSTIN, then drug licence no., then name + pincode                         |
| Products               | product code                                                              |
| Divisions, territories | code                                                                      |
| Any                    | the same key twice in one file → `in_file` error on the later row         |

## Column templates

Required columns in **bold**. Codes refer to existing masters (import those first: territories →
divisions → products → product_hq → specialties/categories → doctors/chemists/stockists).

### territories

**code**, **name**, **level** (`national`/`zone`/`region`/`area`/`headquarter`), **parent_code** (blank for national), centroid_lat, centroid_lng

### divisions

**code**, **name**, active (`Y`/`N`, default Y)

### products

**code**, **name**, **division_code**, brand, composition, pack_size, form (`tablet`/`capsule`/`syrup`/`injection`/`cream`/`drops`/`other`), mrp, ptr, pts, is_sample (`Y`/`N`), active

### product_hq (division/product promoted in an HQ)

**hq_code** (territory of level headquarter), **division_code**, product_code (blank = whole division)

### doctors

**name**, **territory_code**, qualification, specialty_code, category_code (A/B/C), registration_no, address_line, city, state, pincode (6 digits), lat, lng, phone

### chemists / stockists

**name**, **territory_code**, gstin, drug_license_no, address_line, city, state, pincode, lat, lng, phone

### users

**employee_code**, **name**, **email**, **role** (`business_manager` … `director`, or `system_admin`), **territory_codes** (`;`-separated), manager_employee_code (blank for Director / System Admin)

## Territory link import

`POST /v1/imports/territory-links` links existing doctors/chemists to territories under their HQ
(rows `hq_code, entity, name_key, territory_text`), creating missing territories. Same body fields
as above (`dryRun` default true, `fileKey`, `fileName`, `rows` max 5,000) plus `onLinked`
(`keep` | `replace`); response `TerritoryLinkImportResult` (200 dry run, 201 applied) with per-row
`status` (`linked` / `already_linked` / `skipped` / `unmatched` / `error`) and `reason`. Not stored
as an import job (idempotent by design). CLI for a CSV kept outside the repo:

```
source scripts/env.sh && cd apps/api
DATABASE_URL=... node_modules/.bin/tsx scripts/import-territory-links.mts --company <slug> --file /path/x.csv          # dry run
DATABASE_URL=... node_modules/.bin/tsx scripts/import-territory-links.mts --company <slug> --file /path/x.csv --apply  # write
```

Rules: docs/TERRITORY-MODEL.md.

## Data model

`import_jobs` / `import_rows` (migration 0007). Company-wide roles can read any job via
`GET /v1/imports/{id}`; other users only their own. Territory imports compute `path` from
`parent_code` (a parent may be created earlier in the same file).
