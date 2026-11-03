# Web environment: mock vs real API

All switching lives in `apps/web/src/lib/api.ts`.

| Variable                   | Values           | Default                 | Meaning                                                                                             |
| -------------------------- | ---------------- | ----------------------- | --------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_API_MODE`     | `mock` \| `real` | `mock`                  | `mock` starts MSW in the browser with the contract mocks. `real` never loads MSW and calls the API. |
| `NEXT_PUBLIC_API_BASE_URL` | URL              | `http://localhost:4000` | API origin.                                                                                         |

## Real mode behaviour

- Every request is sent with `credentials: 'include'` (better-auth session cookie).
- Sign-in posts `/v1/auth/sign-in/email`, then reads `GET /v1/me`; the highest sales role becomes the session role. Demo accounts and the mock note are hidden.
- Any 401 on a non-auth call clears the session and redirects to `/sign-in?next=<path>`.
- Lists page, search, sort and filter on the server (cursor paging).
- Lists show loading skeletons, an empty state, and an error with Retry.
- My Team uses `GET /v1/team`, `POST /v1/employees`, `PATCH /v1/employees/{id}` and `POST /v1/team/{id}/manager`.

## Run it

The API must allow the web origin: `WEB_ORIGIN=http://localhost:3000,http://localhost:3200`. Start the API as in `docs/RUN-LOCAL.md` (never against production from a laptop), then:

```sh
cd apps/web
NEXT_PUBLIC_API_MODE=real NEXT_PUBLIC_API_BASE_URL=http://localhost:4000 pnpm build
NEXT_PUBLIC_API_MODE=real NEXT_PUBLIC_API_BASE_URL=http://localhost:4000 pnpm exec next start -p 3200
```

`NEXT_PUBLIC_*` values are baked in at build time, so rebuild when switching. Port 3000 stays on mock mode.

Real-mode builds go to `apps/web/.next-real` (mock builds stay in `.next`), so set `NEXT_PUBLIC_API_MODE=real` for both `build` and `start`. Never run a second `next build` into the folder a running `next start` is serving: it deletes the chunks the open page asks for (500s), the page never hydrates and the splash stays up. `NEXT_DIST_DIR` overrides the folder.

Smoke test (fresh browser, bogus credential only, API up and simulated down): `BROWSER=chromium node e2e/real-smoke.mjs` (and `BROWSER=webkit`).

Failsafes: the splash overlay never takes clicks and is hidden after 4s by CSS and by the inline boot script even if no JS chunk loads; every real-mode API call times out after 8s; `app/error.tsx` and `app/global-error.tsx` show a retry instead of a blank or stuck page.

## Sign-up

Mock (:3000): Sign in page > "Request an account" > submit (password at least 12 characters). Signing in with that email shows "Awaiting approval". Sign in with the System Admin demo account (or any ABM and above) > Administration > Sign-up requests to approve or reject. Four seeded pending requests use `@example.test` emails. Mock requests live in this browser only (`af:mock-signups`, password as SHA-256 hash). Real mode (:3200) calls the contract endpoints in docs/SIGNUP.md; a 403 ACCOUNT_PENDING_APPROVAL / ACCOUNT_REJECTED on any data call signs out to `/sign-in?account=pending|rejected`. Evidence: `e2e/signup-evidence.mjs` (mock) and `e2e/signup-real-evidence.mjs` (real build, every write intercepted, nothing reaches the DB).

## Global search

Top bar (or Cmd/Ctrl+K; search icon on phones) opens a command palette. Groups: Doctors, Chemists, Stockists, Team, Products, Pages, each up to 5, only for groups the role can read and open (`searchableGroups(role)` in `lib/search/adapter.ts`). Doctors open their profile (`/doctors?id=`); chemists, stockists and team open the list filtered by `?q=`. 200 ms debounce; each keystroke aborts the previous requests (the API client now keeps the caller's abort signal alongside its 8 s timeout). Evidence: `e2e/search-evidence.mjs`.

### List search audit (Oct 27)

| Page                         | Search                   | Real mode                                                                                                                                                 |
| ---------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Doctors, Chemists, Stockists | DataTable + masterSource | Server: 300 ms debounce, `q` to API, back to page 1 (URL state)                                                                                           |
| My Team                      | Tree search              | **Fixed:** real mode now asks `GET /v1/users?q=` (250 ms debounce, abortable) and highlights those ids; mock still filters locally (name, code, HQ, city) |
| Exceptions                   | memorySource             | Client-side: no list endpoint (known gap)                                                                                                                 |
| Sign-up requests             | Status tabs              | No `q` in the contract (#23)                                                                                                                              |
| DCR product picker           | Local filter             | Picker inside a form, not a list page; products loaded once                                                                                               |
