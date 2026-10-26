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

`apps/web/e2e/permissions-evidence.mjs` (Chromium and WebKit): BM and ABM see no write controls, get a read-only detail, get 403 from the mock API and are redirected away from `/masters/doctors/import`; RBM sees Add, Import, the edit form and the import page.

## Sign-up requests

`canReviewSignups(role)` in `lib/permissions.ts`: System Admin, or Area Business Manager and above. The `/sign-up-requests` nav item and route guard use it. `reviewableRoles(viewer)` (lib/signup) limits rows and approve options to roles below the viewer; System Admin sees all, including Distribution Head and Accountant. `/sign-up` is public (no redirect when signed out).
