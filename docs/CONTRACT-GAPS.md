# Contract gaps (web)

Against the contracts on `feat/roles-hierarchy` (merged locally into the web branches). Nothing here is invented in the UI; where a gap blocks a feature, the screen says so.

## Closed by feat/contracts-gaps / feat/roles-hierarchy

- Lists: `sort`, `includeTotal`, `q`, filters (territory / specialty / category) are used by Masters; the pager shows real totals.
- Territories paginate past 200; the lookups page through every cursor.
- Import: `POST /v1/{doctors|chemists|stockists}/import` dry run then save, with `onDuplicate`; per-row results shown.
- Roles: the web uses the contract `ROLE_KEYS` / `HIERARCHY_ROLE_KEYS` directly.

## Open

1. **Import row keys.** `docs/IMPORT.md` says rows are keyed by template columns (`territory_code`, `specialty_code`, snake_case). The mock validates rows with the entity _create_ schema (camelCase, ids). The web currently sends create-schema rows (ids resolved client-side) because that is what the mock accepts. Please pick one and align docs + mock.
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
{
  "q": "sen",
  "groups": [
    {
      "group": "doctors",
      "total": 3,
      "items": [
        {
          "id": "…",
          "name": "Dr. A. Sen",
          "code": "D-001",
          "subtitle": "General Physician · Kolkata"
        }
      ]
    },
    {
      "group": "users",
      "total": 1,
      "items": [
        { "id": "…", "name": "…", "code": "E-104", "subtitle": "Regional Business Manager" }
      ]
    }
  ]
}
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

## #39 TA/DA allowances (web)

- `GET /v1/allowance-places` and `/v1/allowance-rates` return the full list (`{ items }`) with no paging. The web settings page filters on the server (`q`, `band`, `includeInactive`) but cannot page; fine for a rate card and per-HQ fare chart, revisit if places grow past a few hundred.
- `DELETE /v1/allowance-places/{id}` is a soft delete in the API (docs/TADA.md) but a hard delete in the MSW mock, so "Show removed places" is only meaningful against the real API.
- The mock draft treats every past non-Sunday as an HQ day and never returns `place_required`, so the place picker in "Add allowances" is covered by code path only, not mock e2e.
- Mock rates start empty per page load; e2e adds a rate and navigates in-app to keep MSW state.

## #26 doctor approval — pickers (web)

- DCR and Tour Plan pickers search `/v1/doctors|chemists|stockists` server-side (`q`, `territoryId` incl. descendants, cursor paging); scope comes from the API.
- The mock has no doctor rejection flow (all fixtures `approved`, POST gives `pending`), so "rejected = disabled in the DCR picker" and the 422 `details.doctorIds` message are verified by code path only.
- The web mock-permission guard blocks master writes by role, so e2e seeds pending doctors from a Director session with an RBM `x-mock-user` header.
- Territory choice for the day stays a dropdown of the user's own HQs (already scoped and short; type-ahead works); the outlet picker has a Region / HQ filter over all territories in scope.

## Exceptions (web)

- Mock `/v1/me` is not persona-scoped by the x-mock-user middleware; the Exceptions detail sends `x-mock-user` explicitly (mock only) to decide subject vs manager actions. Real mode uses the session.

## Real API read-only check (2026-10-27, :3200 → :4000, no login available)

- No non-admin credentials were available, and accounts must not be created, so only unauthenticated GETs were run.
- Every route the web uses returns 401 with `{"error":{"code":"UNAUTHENTICATED","message":"Sign in required"}}` (JSON): /v1/me, /v1/doctors (incl. ?approvalStatus=pending), /v1/chemists, /v1/territories, /v1/allowance-rates, /v1/allowance-places, /v1/notifications, /v1/notifications/unread-count, /v1/products, /v1/exceptions, /v1/exceptions/summary, /v1/exception-rules. Unknown routes return 404 NOT_FOUND, so all of these are mounted. This matches the contract's error envelope.
- `/health` is not under that path (404); not used by the web.
- Still unverified against real data: response bodies (approvalStatus values, pagination cursors, the TA/DA, notification, price and exception shapes). This needs a seeded non-admin login.

## Approvals review and rejection reasons (approver detail view)

Built only from endpoints that exist; nothing is faked. Gaps for the API:

- Tour plan: no `GET /v1/tour-plans/{id}`. The approver lists `GET /v1/tour-plans?userId=<submitter>` and picks `subjectId`. No plan-level submitter note (only per-entry `notes`).
- Doctors: no `ids=` batch filter on `GET /v1/doctors`, so planned-doctor names cost one `GET /v1/doctors/{id}` each.
- Rejecter name: `decidedBy` is an id only on Approval, TourPlan, LeaveRequest and ExpenseClaim; no `decidedByName`. UI shows "Rejected: <reason>, <date>" and adds "by <name>" only where a name exists (notifications: `data.actorName`).
- Doctor: schema has no decision/rejection fields; the reason is read from `GET /v1/approvals?subjectType=doctor&status=rejected&mine=requested`.
- Notifications: templates exist for `leave.*` and `expense.*` (data carries `comment` + `actorName`); none for tour plan or doctor rejection.
- Reject comment: required, max 1000 (ApprovalDecision, LeaveDecision, ExpenseDecision); the UI enforces the same.
- Approver read access to a subordinate's leave request, claim and doctor depends on API scoping; unverified without a real login.

### Resolved by feat/approvals-detail (e757379), adopted in web

- RESOLVED: approver detail → `GET /v1/approvals/{id}` (ApprovalDetail.subject; `null` shown as "details not visible to you").
- RESOLVED: `GET /v1/tour-plans/{id}` (used for `/tour-plans?plan=<id>` deep links); `submitterNote` shown to the approver.
- RESOLVED: rejecter name/date → `rejectionReason`, `rejectedBy {id,name}`, `rejectedAt` on TourPlan, LeaveRequest, ExpenseClaim, Doctor; UI shows "Rejected: <reason>, by <name>, <date>".
- RESOLVED: tour_plan/doctor approved/rejected notifications (deep links added; rejection text prefers `data.reason`).
- RESOLVED: `GET /v1/doctors?ids=` exists; the approver view no longer needs it (names come resolved in ApprovalDetail). Doctor 360 now uses `GET /v1/doctors/{id}`.
- `REJECTION_REASON_REQUIRED` shown as "Give a reason to reject this request."; sign-up reject now requires a reason (max 500).
- Open: rejected sign-up applicants cannot read their reason (API does not support it).

## Real API read-only findings (2026-10-27, test sysadmin, 1 sign-in, 0 writes, API d82dd05)

- Match the contract: /v1/me, notifications (+unread-count), products, price-history, doctors (incl. rejection fields), doctors?ids, chemists, territories, approvals, allowance rates/places.
- GAP: GET /v1/admin/products has no schema in packages/contracts (the web reads it untyped). Needs an AdminProduct schema + openapi entry.
- DATA: all 101 products have no PTR (missingPtr=true returns 101, false returns 0). Price history is empty ("No price changes yet").
- GAP: /v1/exceptions, /v1/exceptions/summary and /v1/exception-rules return 403 for system_admin (no field:read). Web now hides /settings/exception-rules and its nav entry unless the role has both settings:write and field:read (476add8). Decide on the API side whether sysadmin should get field:read or keep rules elsewhere.
- Not verified: approver views (TP submissions, approvals detail) on real data. This needs a BM/approver test login.

## #86 Tour plan per-day submissions (web, against 35022cd)

- Adopted: day status/submissionId, submissions[], month aggregate, submit {submitterNote?, dates?}, DAY_LOCKED (details.dates), EMPTY_PLAN, calendar days[], approval subject.submission + submission-only days, Approval.subjectId = submission id.
- Mock follows the contract. Open question: should plan-level rejectionReason/rejectedBy still be set? The web reads per-submission fields and only falls back to the plan-level ones.

## System Admin invites (feat/sysadmin-invite-any acf486a, merged a5406bf)

Adopted in web `/admin/invites`. Still open, by design or not yet in the API:

- No endpoint to cancel a link on its own; sending a new link cancels the earlier one.
- No endpoint lists invites; the pending list is `GET /v1/users?status=invited` (+ `inviteStatus`/`inviteExpiresAt`).
- Links are shown only when the API returns `inviteUrl` (`INVITE_RETURN_LINK=true`, non-production); otherwise the screen says the invite was emailed.
- HQ edit from this screen is not built: `PATCH /v1/employees/{id}` needs `version`, and `UserSummary` (`GET /v1/users`) does not carry it; `GET /v1/team` is not a picker for System Admin.
- The server does no territory-level check; the web limits Business Managers to HQ-level territories.
- Mock: `/v1/employees*` requests now carry the mock session (`x-mock-user`), so mock create/invite rules match the signed-in role.

## System Admin People (feat/sysadmin-people 310ae1c, merged f4e38c1)

Adopted in web `/admin/people`. Open items:

- No `GET /v1/users/{id}`; after a save or a conflict the web re-reads the person with `GET /v1/users?q=<email>` and matches the id.
- No `inviteStatus` filter on `GET /v1/users`, so "invite expired" is shown per row only, not as a filter.
- `lastActiveAt` exists but the list doesn't show it yet; there is no `lastLoginAt`.
- Territory level is not checked server-side; the web limits Business Managers to HQ-level territories.
- The web edits one territory per person (the primary); a territory change replaces the list with that one.
- Mock: added `MANAGER_RANK` and `REPORTS_OUTRANK` (with `details.userIds`) to the PATCH mock, and `primaryRole`, `rank`, `managerName`, `territories[]`, `version` and a subtree `territoryId` filter to the `/v1/users` mock, to match the API. The mock caps `limit` at 200 instead of returning 422.

## SFC (adopted origin/feat/sfc-routes, merged 2fcb049)

The web now uses the Architect contract (docs/SFC.md, `packages/contracts/src/schemas/sfc.ts`) through `apps/web/src/lib/sfc/adapter.ts`. The web-local MSW mock (`lib/sfc/mock-handler.ts`) uses the same paths and shapes with the Burdwan fixtures. What changed from the earlier web assumptions:

- Paths: the sheet is `GET/PUT /v1/sfc/employees/{userId}/routes` (was `/v1/sfc/{userId}`); employees are listed with `?territoryId=` (was `hqId`).
- Concurrency: an opaque `etag` (409 `VERSION_CONFLICT` returns `details.etag`), not a numeric `version`. The PUT also sends `hqTerritoryId`.
- HQs: `{ id, name, code, level, parentId, parentName, employeeCount, routeCount }`; `code` and the parent area can be null (the web groups those under "Other HQs").
- Rows: `oneWayKm` (0 to 2500, 2 decimals; was `distanceKm`), `travelMode` enum `bike|bus|train|bus_train|car|other|null` (AUTO dropped), `category` up to 40 chars or null, `da` money or null.
- DA is a NUMBER (owner decision): 0 to 1,00,000 in the web (contract allows up to 10,00,000), 2 decimals, blank = null. Numeric input, inline error, 422 errors point at the row.
- Rate: one company setting `GET/PUT /v1/sfc/settings { ratePerKm, version }` (2.95), not per HQ. The server computes amounts.
- Whole-table PUT, max 200 rows; omitted rows are soft-deleted. New rows are sent without an id. 422 `SFC_HQ_NOT_ASSIGNED` and `SFC_ROUTE_NOT_FOUND` have their own messages (the latter reloads the sheet).
- Who edits: the API returns `canEdit`. ABM to VP edit people below them but not their own sheet; Director edits everyone but self; System Admin edits everyone; BM reads only their own sheet. The web honours `canEdit` (read-only notice, inputs disabled). Gap vs the owner's "everyone who can see a sheet can edit": an ABM/RBM/Director viewing their OWN sheet gets it read-only from the API. The mock always returns `canEdit: true`.
- `/v1/allowance-*` is deprecated; the web no longer calls it.

## Paying expense claims (web gate; no Architect branch on origin)

- Owner decision: Director and System Admin mark approved claims paid; no other role sees the pay button. One helper: `canPayExpenses` / `EXPENSE_PAYERS` in `apps/web/src/lib/permissions.ts`, used by the expenses list ("To pay"), the claim view and the Expenses nav entry.
- Gap: the API (docs/RBAC.md) still ties `POST /v1/expense-claims/{id}/pay` and the approved-claims list to `finance:write` / `finance:read`, which only `accountant` has. Real mode will return 403 for Director/System Admin until the API grants those permissions (or a new `expenses:pay`) to them. System Admin also needs read access to approved claims company-wide.
- Mock: `lib/expenses/mock-pay.ts` adds `finance:read` + `finance:write` to the Director and System Admin mock personas at start-up.

## Retired roles (Distribution Head, Accountant)

- Removed from every web picker, filter, nav and mock persona. The contracts fixtures still contain "Demo Distribution Head" and "Demo Accountant" users (the contract's RoleKey is the Architect's), which the web shows as "Other role".
- Pay moved to Director and System Admin, see "Paying expense claims".

## Forgot password by email code: now the real contract (feat/auth-email-otp 23b635d)

The web uses `POST /v1/auth/password/forgot {email}` -> 200 `{ok,message}` (same answer always) and `POST /v1/auth/password/reset {email, code, password 12-128}` -> 200 `{ok}`, all sessions revoked, then sign-in. Errors: 400 PASSWORD_RESET_CODE_INVALID, 400 PASSWORD_RESET_CODE_EXPIRED (offer a new code), 403 PASSWORD_RESET_TOO_MANY_ATTEMPTS, 422 VALIDATION, 429 RATE_LIMITED (Retry-After). Code valid 10 minutes. The better-auth email-otp routes below are NOT used (404 on the real API). Mock code is 123456. The notes below are the old assumption, kept for history.

### (old) assumed contract

One thin layer: `apps/web/src/lib/password-reset/adapter.ts` (MSW mock in `lib/password-reset/mock-handler.ts`). Assumed better-auth email-OTP routes under the existing `/v1/auth` base:

- `POST /v1/auth/email-otp/send-verification-otp` `{ email, type: 'forget-password' }` -> 200 for every email (no account enumeration). The web always shows "If the account exists, we sent a code"; only 429 is surfaced.
- `POST /v1/auth/email-otp/reset-password` `{ email, otp, password }` -> 200; the API revokes every session of that user (web toast says so).
- Errors read from either `{ code, message }` (better-auth) or `{ error: { code, message } }`: `INVALID_OTP` (wrong), `OTP_EXPIRED`, `TOO_MANY_ATTEMPTS` (mock: 3 wrong codes, cleared by a new code), 400/422 password rule message, 429 with `Retry-After`.
- Code: 6 digits. Password minimum 12 (`INVITE_PASSWORD_MIN`) unless the API says otherwise. Resend cooldown 30 s is client-side only.
- To confirm: code lifetime, attempt limit, whether resend invalidates the old code, and that `revokeSessionsOnPasswordReset` is on.
