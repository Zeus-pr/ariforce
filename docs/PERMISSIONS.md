# Web permissions: masters

One helper drives everything: `canWriteMasters(role)` in `apps/web/src/lib/permissions.ts`.

| Roles | Masters (doctors, chemists, stockists) |
|---|---|
| Regional Business Manager, Zonal Business Manager, Sales Manager, General Manager, Vice President, Director, System Admin | Read and write: add, edit, import, remove |
| Area Business Manager, Business Manager | Read only |
| Distribution Head, Accountant | Retired from the web: not offered anywhere, no portal access; an API user with only these roles is signed out with "Your role does not have access to this portal." Elsewhere they show as "Other role". |

Rule: `isSystemAdmin(role) || roleLevel(role) >= roleLevel('regional_business_manager')`. This matches the API rule the Architect is shipping (403 for ABM/BM on masters writes).

## What read-only roles see

- No Add, Import, Save or Remove controls are rendered at all (no greyed-out buttons).
- Clicking a row opens a details sheet (a plain list of fields with a Close button), not an edit form.
- `/doctors` shows an Import / "Add or edit" entry for writers only.
- Route guard (`GUARDS` in `lib/nav.ts`, `WRITE_ROUTES` in `lib/permissions.ts`): `/masters/{doctors,chemists,stockists}/import` redirects read-only roles to their home. Add and edit are sheets on the list page, not routes, so there are no other write routes to block.
- If the API still answers 403 (for example, stale role), the form shows the API's message instead of failing silently.

## Mock mode

`lib/mock-permissions.ts` adds MSW handlers in front of the contract mocks: POST/PATCH/DELETE on `/v1/{doctors,chemists,stockists}` and their `/import` return `403 FORBIDDEN` when the mock session role (preview role if set) is ABM or BM. Mock users `bm@` and `abm@` are read-only; `rbm@` and above write.

## Evidence

`apps/web/e2e/permissions-evidence.mjs` (Chromium and WebKit): BM and ABM see no write controls, get a read-only detail, get 403 from the mock API and are redirected away from `/doctors/import`; RBM sees Add, Import, the edit form and the import page.

## Sign-up requests

`canReviewSignups(role)` in `lib/permissions.ts`: System Admin, or Area Business Manager and above. The `/sign-up-requests` nav item and route guard use it. `grantableRoles(viewer)` (lib/signup) uses contracts `assignableRoles(rank)`: managers grant hierarchy roles below their own; Distribution Head and Accountant are not offered. Approve needs at least one territory for hierarchy roles; Director gets no manager picker. The API remains the authority (403 outside authority or own request, 409 already decided). `/sign-up` is public (no redirect when signed out).

## Routes (Oct 27)

Doctors, Chemists and Stockists are standalone pages at `/doctors`, `/chemists`, `/stockists` (import at `/{kind}/import`, writers only). Same layout: entity title, search, filters, Import + Add (RBM+ and System Admin), table. Old `/masters`, `/masters/{kind}` and `/masters/{kind}/import` redirect (307, query kept) via next.config.ts. The Administration "Master Data" item is gone; System Admin sees the three pages under Business. On /doctors a row opens the doctor profile; writers get Edit there.

## Invite people (System Admin)

`/admin/invites`, nav entry "Invite people" in the Administration section. Shown only to `system_admin` with `users:write` (the API's `isAdmin`); every other role gets no nav entry and the route guard sends them home.

- Existing employee: server-side search over `GET /v1/users?q=` (company-wide for System Admin). Shows name, code, email, role, HQ, manager and status. The link goes to the saved email via `POST /v1/employees/{id}/invite`. People who already signed in (`hasLogin`, or a 409 from the API) get a plain "already joined" note instead of a link.
- New person: name, email, phone, any portal role (including System Admin; Distribution Head and Accountant are not offered), HQ (Business Manager: HQ-level territories only, including empty HQs) or territory (other sales roles), optional manager who outranks the role. Directors and functional roles have no manager; functional roles have no territory. "Add several" sends rows through `POST /v1/employees/invite-bulk` with per-row results.
- After sending: a copyable link (when the API returns one), and a "Waiting to join" list from `GET /v1/users?status=invited` with "Send new link" per person and "Invite all pending". A new link cancels the old one; there is no separate cancel.
- Director's My Team invite flow is unchanged.

Evidence: `apps/web/e2e/admin-invites-evidence.mjs` (Chromium and WebKit, 36 checks each).

## People (System Admin)

`/admin/people`, nav entry "People" next to "Invite people". Same gate: `system_admin` with `users:write`; everyone else gets no entry and is sent home.

- List: `GET /v1/users` with server-side search (name, code, email), role, status, HQ (`territoryId`, whole subtree) and sign-in (`hasLogin`) filters, sorted by name, 50 per page with "Show more" (cursor). Columns: name, code, email, role, HQ, manager (`managerName`), status, sign-in. Your own row is marked "You".
- Edit sheet: name, email (only while the person has no login; read-only after), phone, employee code, designation, joined date, role (any), status (Suspend / Reactivate for active or suspended people; invited people become active by accepting), HQ picker (Business Manager: HQ-level only, empty HQs included; other sales roles: non-HQ levels), manager picker (only people who outrank the role). Directors have no manager; functional roles and System Admin have no HQ and no manager.
- Your own record can't be saved here (the API returns 403); the sheet says so.
- Confirm dialog before a role change or suspension (warns they are signed out on every device), reactivation, an HQ change (applies from their next action) and a manager change (their requests waiting for first approval move to the new manager).
- Errors in plain words: version conflict (latest record is reloaded), email locked or taken, employee code taken, reporting loop, manager doesn't outrank the new role (pick a new manager with the role), direct reports would outrank the new role (their names are listed), last System Admin, 403, 404 (list refreshes), 422, 429.
- My Team's edit (`PATCH /v1/employees/{id}` for non-admins) sends only name, phone, role, territory, manager and status, never email or employee code.

Evidence: `apps/web/e2e/admin-people-evidence.mjs` (Chromium and WebKit, 76 checks each).

## SFC (/sfc)

Replaces the old TA/DA rates page (`/settings/allowances`, removed). Nav entry and route guard: Area Business Manager and above, Director, System Admin (`roleLevel >= 2 || isSystemAdmin`). Business Managers get no entry and are redirected home. HQ list is scoped by the API (`GET /v1/sfc/hqs`); in the mock a Burdwan ABM sees only Burdwan Area (Anamoy and Bmch HQs), RBM and above see all. Editing follows the API's `canEdit` per sheet: ABM to VP edit people below them, Director everyone except self, System Admin everyone; a sheet with `canEdit: false` opens read-only with a notice. DA is a money amount (0 to 1,00,000, 2 decimals, or blank). The rate per km is one company setting. The API is the authority: 403/404/409/422/429 are shown as plain messages.

## Paying expense claims

`canPayExpenses(role)` in `lib/permissions.ts`: Director and System Admin only. They get the "To pay" list and the "Mark paid" step on approved claims (payment reference required). Everyone else, including the approving ABM and the claim owner, sees no pay button. System Admin gets the Expenses nav entry for this. The API still needs to grant pay to these roles (docs/CONTRACT-GAPS.md, "Paying expense claims"). Evidence: `e2e/expenses-evidence.mjs` (Director pays on desktop, System Admin on mobile, ABM/BM have no button) and `e2e/permissions-evidence.mjs`.

## Public pages

`/sign-in`, `/sign-up`, `/invite` and `/forgot-password` need no session (auth-boot `pub` list). SFC is never a landing page: `homeFor` skips it.
