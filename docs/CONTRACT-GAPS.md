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
3. ~~KPI endpoints~~ Closed by feat/import-kpis: the dashboard reads `GET /v1/kpis` and `GET /v1/kpis/products`.
4. **Attendance is caller-only in the mock.** `GET /v1/attendance` builds days only from the caller's own check-ins and labels every day with `me.name` ("Demo Director" even when signed in as a BM). For the approver team view we need: mock users per role (so `userId`/`userName` match the signed-in mock user), team rows for `userId`/`territoryId` filters, and absent/leave rows for people with no check-ins. Also no `GET /v1/users` (team list) to pick a person.
5. **Check-in identity.** The mock attributes check-ins to `fx.me` (director) regardless of the session; the web has no way to send the mock user. Needs auth-backed mock or an `x-mock-user` header.
6. **Tour plan copy is a stub.** `POST /v1/tour-plans/{month}/copy` returns an empty plan whatever `fromMonth`/`fromStp` say, and there is no endpoint to read or edit the STP (standard plan) itself.
7. **"Every date needs an entry" is client-only.** `/submit` accepts a plan with missing dates; the rule should live on the server (422 with the missing dates).
8. **Approvals are not scoped.** The mock returns every pending approval to any caller and lets the requester approve their own plan; `mine=to_decide` is not applied.
9. **DCR vs tour plan is client-only.** `PUT /v1/dcrs` never sets `tourPlanId` and does not require `deviationReason` when the day differs from the approved plan (#22); the web enforces both. No day-lock cut-off in the mock (#23).
10. **DCR call ↔ visit check-in.** `DcrCall.checkInId` exists but there is no way to list today's unlinked visit check-ins for a doctor; the web sends `null`. POB lines are not captured in the UI yet.
11. Specialties and categories are read-only (no create in Masters by design).
12. **KPI product names are placeholders.** The contract mock's product fixtures have 2 fake products ("Atorvastatin 10 mg", "Paracetamol 650 mg"), so the product KPI table shows them. The web's own pickers use a local mock seed of Arighna's 101 real products (`apps/web/src/mocks/product-seed.ts`); the mock fixtures should be seeded from the same sheet.
13. **KPI targets mostly null.** Only achievement KPIs return a target (100). Cards show "No target set" for the rest; targets per KPI/role need a source (#49).
14. **No period comparison.** `KpiReport` has no previous-month / last-year values, so the cards show no trend.
15. **No exceptions feed (#29, #56).** `/exceptions` runs fixed rules in the browser over KPIs (byUser/self), attendance, visit check-ins (`inFence=false`), DCRs, next month's tour plan and pending approvals, paged through the shared table with an in-memory source. A server feed (`GET /v1/exceptions` with severity/type/user filters and cursor paging) would let it page server-side and see the whole team's DCRs/check-ins (the mock returns only the caller's). Earlier note: The "Needs attention" list derives missed-doctor and DCR-compliance items from `rollup=byUser` with placeholder thresholds (30% missed, 90% DCR; to confirm with Arighna). Geofence breaches, late DCRs and sample stock have no contract and stay labelled sample data (`apps/web/src/mocks/dashboard.ts`).
16. **No hierarchy scope endpoint.** Nothing returns the caller's position (region/area/territory chain) for a breadcrumb; the dashboard shows a role scope label ("Whole company" / "Your team" / "Your own numbers") instead. `byUser` also returns the same two demo rows for any caller.

17. **Hierarchy drill-down (#31) has no people per territory.** `/team` walks `/v1/territories` (parent chain for the breadcrumb, children via `rollup=byTerritory&territoryId=`) and at the lowest level lists people with `rollup=byUser&territoryId=`, which the mock ignores (same two demo BMs everywhere). Users carry no territory/manager link in `/v1/users`, so the real reporting line (ABM → BMs) can't be drawn; the drill follows territories. Fixtures have one child per level (India › East Zone › West Bengal › Kolkata North). Export is client-side (current view only); a server export (`GET /v1/kpis/export?format=xlsx|pdf`) would be needed for scheduled/emailed reports.
18. **Doctor 360 (#34).** No `GET /v1/doctors/{id}` (the page reads the list and picks by id; fails past 200 doctors) and no per-doctor visit history: visits are rebuilt from the caller's `/v1/dcrs` calls (`outletKind=doctor`) plus visit `/v1/check-ins`, last 90 days, so a manager can't see a doctor's visits by their team. A `GET /v1/doctors/{id}/activity` (visits, detailing, samples, POB, by any rep) would close this. The monthly sample cap per doctor has no contract; the page uses a placeholder of 10, labelled "to confirm with Arighna". When no calls are recorded the visit history is generated sample data, labelled "Sample visit history".
19. **Coverage and Sales/Targets (#49).** `/coverage` and `/sales` use `/v1/kpis` (headline rollup, `byUser` for managers, `byTerritory` under the top territory for the Director, six monthly calls for the trend; a `from/to` series rollup would make that one call). Gaps: (a) sales KPIs carry no target amount (`target` is 100 on achievement %, null on values), so target amounts are implied as value × 100 ÷ achievement %; (b) no product/brand grain for sales, so "By brand" is labelled sample data; (c) no coverage by doctor category, so that breakdown is labelled sample data; (d) the mock returns the same numbers every month.
20. **Reports pack (#55).** `/reports` (field activity, doctor coverage, sales and targets, product detailing) is built from `/v1/kpis` and `/v1/kpis/products`, exported client-side to .xlsx/PDF for the current month and scope. No server report/export endpoint (scheduled or emailed reports, date ranges beyond a month, custom columns) and no audit of who exported what.

## 21. My Team: org tree and employee management (local adapter)

The Architect branches (feat/api-1…6, roles-dh-accountant) have `GET /v1/users`, `Me.managerId` and `employeeCode`, but no tree or create endpoints. The page runs on a typed, clearly labelled local adapter (`src/lib/team-adapter/`, in-memory sample org of West Bengal HQs, fake phones/emails) that is the only file to swap. Needed:

- `GET /v1/org/tree` – caller's subtree: id, name, role, employeeCode, phone, email, hqId, managerId, active.
- `GET /v1/org/unassigned?cursor=` – people with no reporting manager, visible to the caller.
- `GET /v1/hqs` – HQs (id, name, city, state) within the caller's subtree.
- `POST /v1/employees` – name, phone, email, role, hqId, managerId. Server must enforce: role strictly below the caller; HQ and manager inside the caller's subtree; manager senior to the role; unique email.
- `PATCH /v1/employees/{id}` – edit, move (managerId/hqId), deactivate/reactivate (`active`). Server must reject cycles and self-edits.

No payroll fields (PAN, bank, CTC, salary) in any of these, by owner decision.

**Update (feat/20-real-api):** the Architect's `GET /v1/team`, `POST /v1/employees`, `PATCH /v1/employees/{id}` and `POST /v1/team/{id}/manager` now back My Team in real mode (`lib/team-adapter/api-adapter.ts`). Mock mode keeps the local adapter. Still missing: a list of HQs/territories inside the caller's subtree for the create form beyond those already on tree nodes.

## 22. Chemists, stockists and placeholder doctors

- **No city filter.** Masters lists accept `territoryId` (subtree), `specialtyId`, `categoryId`, `q`, `sort`, `cursor`. The pages only offer those; a `city` param is needed for the requested city filter.
- **No placeholder filter.** "No Doc" placeholder doctors get a muted "Placeholder" tag, but hiding them by default and a "Show placeholders" toggle need a server flag (`isPlaceholder` on the row and `includePlaceholders=false` default on the list). Filtering in the browser would break server paging and totals, so it is not done.
- **No Products master.** No products list/CRUD endpoint, so there is no Products nav entry.
- **Masters write rule.** The API's DEFAULT_ROLE_PERMISSIONS still gives `masters:write` to BM; the web follows the new RBM+ rule (docs/PERMISSIONS.md) and shows the API's 403 if they disagree.

## 23. Sign-up requests (now on the real contract, feat/signup-requests c067e17)

The web uses `POST /v1/auth/sign-up-request`, `GET /v1/signup-requests?status=`, `POST /v1/signup-requests/{id}/approve|reject` and the sign-in 403 codes exactly as in docs/SIGNUP.md. Remaining gaps:

- **List has no `q`, cursor or total.** The approvals page shows Pending / Approved / Rejected tabs with the full list; add `q`, `cursor`, `limit` if lists grow.
- **Resolved (feat/signup-visibility 787e450): sign-up pickers.** The form now loads `GET /v1/auth/sign-up-options` (mock and real) for the optional HQ and manager pickers; managers show only for roles that take one and only above the requested level. If the call fails (429/503/network) the pickers hide and the form still sends `territoryId`/`managerId` as null. The approve dialog pre-ticks the requested HQ only when it is in the approver's `GET /v1/territories` scope.
- **Turnstile site key not exposed.** The web sends no `turnstileToken`; if `TURNSTILE_SECRET` is set on the API, real sign-ups get 403 CAPTCHA_FAILED until a `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is agreed.
- **Approve dialog territory list** uses `GET /v1/territories` (the reviewer's scope); manager candidates come from the team tree. The API stays the authority (403/422).

## 24. Global search: proposed `GET /v1/search?q=`

The top-bar palette (Cmd/Ctrl+K) works today by fanning out to the list endpoints (`GET /v1/{doctors,chemists,stockists,users,products}?q=&limit=5`, up to 5 requests per keystroke after a 200 ms debounce). It sits behind `apps/web/src/lib/search/adapter.ts`; one endpoint would replace `fetchGroups` only.

**Request:** `GET /v1/search?q=<2..100 chars>&limit=<1..10, default 5>&groups=doctors,chemists,stockists,users,products` (optional subset). Requires `me:read`; each group is gated by its own read permission (`masters:read`, `stockists:read`, `users:read`, `products:read`) and silently omitted when missing, never 403 for the whole call.

**Scoping:** the same territory-subtree scoping as the list endpoints (users: own subtree; System Admin company-wide). No deleted rows. Matches name and code (users: name, employeeCode), case- and accent-insensitive, prefix matches ranked first.

**Response 200:**
```json
{ "q": "sen",
  "groups": [
    { "group": "doctors", "total": 3, "items": [ { "id": "…", "name": "Dr. A. Sen", "code": "D-001", "subtitle": "General Physician · Kolkata" } ] },
    { "group": "users", "total": 1, "items": [ { "id": "…", "name": "…", "code": "E-104", "subtitle": "Regional Business Manager" } ] }
  ] }
```
Groups in a fixed order; empty groups omitted; `total` capped (e.g. 100) so the UI can say "All N matching". No emails or phone numbers in items. Errors: 422 (q too short or long), 429 RATE_LIMITED. Pages/navigation stay client-side (from the role's nav).

**Also missing:** a products page in the web. Product hits open Sales by brand (`/sales`) for roles that can see it; roles without it (System Admin) get no Products group.

## 25. Expense claims list has no paging or search (feat/52-expense-claims ddcb66e)

`GET /v1/expense-claims` filters on the server by `month`, `status` and `userId` but has no `cursor`/`limit`/`total` and no `q`. The web filters by month + status on the server and shows the whole month's list; an approver with a large team gets every claim for the month in one response. Ask: `cursor`, `limit` (default 50), `total`, and `q` (claimant name or employee code), same shape as the masters lists. "Team" also hides the viewer's own claims client-side; a `mine=to_decide` style filter (as on DCR/Tour Plan) would move that to the server.

## 26. Employee invites (resolved by feat/26-invite-gaps a575db1)

- **Bulk:** `POST /v1/employees/invite-bulk {employees: EmployeeCreate[1..200]}` creates and invites new people, one transaction per row. Web: My Team "Add several" (ABM and above) takes one person per line (name, email, optional phone) with a shared role and HQ, sends chunks of 200 and lists every row (invited / skipped `CONFLICT`·`DUPLICATE_IN_BATCH` / failed `VALIDATION`·`FORBIDDEN`·`INTERNAL`) with the summary and copyable links. "Invite all pending" still re-issues links for people who already exist (one `POST /v1/employees/{id}/invite` each); bulk would skip them as `CONFLICT`.
- **Password minimum 12** on both sides (`INVITE_PASSWORD_MIN`).
- **Distinct accept errors:** 404 `INVITE_INVALID`, 409 `INVITE_USED`, 410 `INVITE_EXPIRED` each get their own page state. 422 shows the server message. 429 shows "Too many attempts, try again in N seconds" (`Retry-After`, else `details.retryAfterSeconds`). 403 `ACCOUNT_SUSPENDED` shows the suspended message.
- Still applies: links are returned only with `INVITE_RETURN_LINK=true` (built from `WEB_ORIGIN`), and API CORS must allow the web origin for the sessionless `/v1/invites/accept`. For the 429 wait to come from the header, CORS must expose `Retry-After`; otherwise the web uses `details.retryAfterSeconds`.
- Live: the API on :4000 runs d6bbd5f. The web's real-mode writes stay stubbed in e2e. No open API change.

## 27. Tour plan submit rule (resolved by fix/tp-submit-any-day 0bb7b40, supersedes 36c29f5)

- Rule now: `POST /v1/tour-plans/{month}/submit` succeeds when at least one day has an entry. Partial months, past-only plans, and empty weekly-off or leave days are all fine. The only failure is 422 `EMPTY_PLAN` (no details). The old 422 VALIDATION with `missingDates` is gone.
- Web: Submit is enabled when the plan is editable and `hasPlannedDay(plan.days)`. The header shows an informational "N days planned" with no blocking count. "Fill unplanned days" is an optional helper that skips weekly offs (and, this month, past days). Past days stay clickable and editable. The "Weekly off" and "Past" labels are informational. A submit error shows the server message (`EMPTY_PLAN`). Nothing reads `missingDates` any more.
- `GET /v1/tour-plans/{month}/calendar`: the web uses `todayIST`/`weeklyOffDays`. `requiredDates` only drives the fill helper and labels.
- Live: the API on :4000 runs 7f2a55f, which includes this rule. No open API change.

## 75. Team member profile (feat/75-team-profile 8e6b0f9 + exceptions from feat/56-exceptions 5fdd41f)

- Web: `/team/members/{userId}` uses `GET /v1/team/members/{userId}/profile`, `/performance` (month/week), `/doctors` and `/chemists` (server-paged, `q`, `includeTotal`, load more) and `/export` (xlsx/pdf). The exceptions summary renders only when `exceptions` is non-null. Entry points: "Full profile" on a selected person in Team, and "View full profile" in the My Team sheet (real mode).
- No missing endpoints. One web-only note: mock-mode My Team runs on the local sample org, whose ids are not contract ids, so the sheet link is shown only in real mode.

## 40. POB / RCPA on DCR (web, against de138d4)
- No missing endpoints. The POB/RCPA product picker uses `GET /v1/products?limit=200` (active only); `GET /v1/rcpa/competitor-brands?q` feeds the brand autocomplete.
- Web never sends or computes `PobLine.value`; it shows the server value after save ("value after save" before).
- Nice-to-have (not blocking): a `q` search on `/v1/products` for companies with more than 200 active products.
