# Contract gaps found while building the web screens

The web app only calls endpoints in `packages/contracts` (PR #33). Where a screen needs more, it stops
at that point and the gap is listed here for the Architect. Nothing below is invented on the client.

## Lists (all tables) — owner rule: page, pageSize, query, sort, filters, total

| Need | v1 today | Ask |
| --- | --- | --- |
| Total row count | `{ items, nextCursor, serverTime }`, no total | Add `total` (or `totalEstimate`) to list responses, at least when `updatedSince` is absent |
| Page numbers | Cursor only | Either `page`/`pageSize` for web lists, or keep cursor and accept "Page N" with next/prev (current UI) |
| Sort | None | `sort=<field>` / `sort=-<field>` with an allow-list per resource (name, city, updatedAt, …) |
| Filters | None | `territoryId` (incl. descendants), `specialtyId`, `categoryId` on `/v1/doctors`; `territoryId` on chemists/stockists |
| Mock search/paging | MSW `list()` ignores `q` and `cursor`, always `nextCursor: null` | Make mocks honour `q`, `limit`, `cursor` so web can demo them |

## #8 Masters

- **Bulk import**: no endpoint. Wizard parses .xlsx/.csv, matches columns and validates each row with `DoctorCreate`/`ChemistCreate`/`StockistCreate`, then stops before saving. Ask: `POST /v1/{doctors|chemists|stockists}/import` taking up to 5,000 rows, `dryRun` flag, per-row result `{ row, status, errors, id }`, idempotency key; plus duplicate detection (name + pincode / registrationNo) per #26.
- **Territory/specialty/category lookup by code** for import: done client-side from list endpoints (limit 200). Fine for now; breaks past 200 territories.
- **Specialty / category masters CRUD**: read-only in v1 (no POST/PATCH). Issue #8 says "categories, specialty" admin; needs write endpoints.
- **Geo-tag** (`location`) editing: field exists; no map picker yet (#24).

## #9 Attendance — blocked

No attendance resources in v1. Needs: `AttendanceDay` (punch-in/out time, location, accuracy, selfie ref), `CheckIn` (time, `{lat,lng}`, accuracy, doctor/chemist/stockist id, in-fence flag, distance), `GET /v1/attendance` and `GET /v1/check-ins` with date, user and territory filters, `POST /v1/check-ins` for the rep view, geofence radius setting (#24), and DPDP consent state (#36).

## #10 DCR — blocked

No DCR, tour-plan, work-type or product resources in v1. Needs: DCR + calls (doctor/chemist, products detailed, samples, POB), `GET /v1/tour-plans/{month}` approved plan for prefill, work types (#18), deviation reason (#22), day lock (#23).

## #11 Tour plan — blocked

Needs: tour plan month + day entries (work type, territories/patches, planned doctors, multi-session #21), submit, manager approve/reject with comment (#17 approval engine), STP → MTP copy (#20).
