# Excel / CSV import

Master data arrives as Excel today, so import is a first-class feature. The web wizard parses
`.xlsx`/`.csv` in the browser, maps columns to the templates below, and calls
`POST /v1/{entity}/import` (contracts: `ImportRequest`, `ImportJob`, `ImportRowResult`).

## Flow

1. Upload the source file to R2 (`/v1/files/upload-url`, kept for audit) and parse it client-side.
2. **Dry run** (`dryRun: true`, the default): every row is validated with the entity's create schema,
   codes are resolved (territory, specialty, category, division, product), duplicate rules run. Nothing
   is written. The response is a preview with per-row `status` (`valid` / `duplicate` / `error`),
   `errors[] {column, code, message}`, `duplicateOf` and `duplicateRule`.
3. User fixes the sheet or picks `onDuplicate` (`skip` | `update` | `error`), then re-posts with
   `dryRun: false` and the same `Idempotency-Key` header. Rows become `created` / `updated` /
   `skipped` / `error`. Valid rows are saved even if others fail; the job is audited (`import.apply`).
4. `GET /v1/imports/{id}` returns the job and per-row results (downloadable as an error report).

Limits: 5,000 rows per request (split larger sheets), header row required, UTF-8 CSV, dates as
`YYYY-MM-DD`, empty cell = null. Permissions: `imports:write` (Director, System Admin); field users add
single records instead.

## Duplicate rules (#26)

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

## Data model

Import jobs and rows are stored (`import_jobs`, `import_rows`) together with `divisions`, `products` and
`product_hq_mappings` in a new migration (0007+, not yet written). 0000-0003 stay untouched.
