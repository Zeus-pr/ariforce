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
4. **Attendance is caller-only in the mock.** `GET /v1/attendance` builds days only from the caller's own check-ins and labels every day with `me.name` ("Demo Director" even when signed in as a BM). For the approver team view we need: mock users per role (so `userId`/`userName` match the signed-in mock user), team rows for `userId`/`territoryId` filters, and absent/leave rows for people with no check-ins. Also no `GET /v1/users` (team list) to pick a person.
5. **Check-in identity.** The mock attributes check-ins to `fx.me` (director) regardless of the session; the web has no way to send the mock user. Needs auth-backed mock or an `x-mock-user` header.
6. **Tour plan copy is a stub.** `POST /v1/tour-plans/{month}/copy` returns an empty plan whatever `fromMonth`/`fromStp` say, and there is no endpoint to read or edit the STP (standard plan) itself.
7. **"Every date needs an entry" is client-only.** `/submit` accepts a plan with missing dates; the rule should live on the server (422 with the missing dates).
8. **Approvals are not scoped.** The mock returns every pending approval to any caller and lets the requester approve their own plan; `mine=to_decide` is not applied.
9. Specialties and categories are read-only (no create in Masters by design).
