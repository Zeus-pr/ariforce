# Web permissions: masters

One helper drives everything: `canWriteMasters(role)` in `apps/web/src/lib/permissions.ts`.

| Roles | Masters (doctors, chemists, stockists) |
|---|---|
| Regional Business Manager, Zonal Business Manager, Sales Manager, General Manager, Vice President, Director, System Admin | Read and write: add, edit, import, remove |
| Area Business Manager, Business Manager | Read only |
| Distribution Head, Accountant (non-ladder, rank 0) | No masters write |

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

`canReviewSignups(role)` in `lib/permissions.ts`: System Admin, or Area Business Manager and above. The `/sign-up-requests` nav item and route guard use it. `grantableRoles(viewer)` (lib/signup) uses contracts `assignableRoles(rank)`: managers grant hierarchy roles below their own; only System Admin grants Distribution Head and Accountant. Approve needs at least one territory for hierarchy roles; Director, Distribution Head and Accountant get no manager picker. The API remains the authority (403 outside authority or own request, 409 already decided). `/sign-up` is public (no redirect when signed out).

## Routes (Oct 27)

Doctors, Chemists and Stockists are standalone pages at `/doctors`, `/chemists`, `/stockists` (import at `/{kind}/import`, writers only). Same layout: entity title, search, filters, Import + Add (RBM+ and System Admin), table. Old `/masters`, `/masters/{kind}` and `/masters/{kind}/import` redirect (307, query kept) via next.config.ts. The Administration "Master Data" item is gone; System Admin sees the three pages under Business. On /doctors a row opens the doctor profile; writers get Edit there.

## Invite people (System Admin)

`/admin/invites`, nav entry "Invite people" in the Administration section. Shown only to `system_admin` with `users:write` (the API's `isAdmin`); every other role gets no nav entry and the route guard sends them home.

- Existing employee: server-side search over `GET /v1/users?q=` (company-wide for System Admin). Shows name, code, email, role, HQ, manager and status. The link goes to the saved email via `POST /v1/employees/{id}/invite`. People who already signed in (`hasLogin`, or a 409 from the API) get a plain "already joined" note instead of a link.
- New person: name, email, phone, any role (including System Admin, Distribution Head, Accountant), HQ (Business Manager: HQ-level territories only, including empty HQs) or territory (other sales roles), optional manager who outranks the role. Directors and functional roles have no manager; functional roles have no territory. "Add several" sends rows through `POST /v1/employees/invite-bulk` with per-row results.
- After sending: a copyable link (when the API returns one), and a "Waiting to join" list from `GET /v1/users?status=invited` with "Send new link" per person and "Invite all pending". A new link cancels the old one; there is no separate cancel.
- Director's My Team invite flow is unchanged.

Evidence: `apps/web/e2e/admin-invites-evidence.mjs` (Chromium and WebKit, 36 checks each).
