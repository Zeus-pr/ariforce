# Web environment: mock vs real API

All switching lives in `apps/web/src/lib/api.ts`.

| Variable | Values | Default | Meaning |
|---|---|---|---|
| `NEXT_PUBLIC_API_MODE` | `mock` \| `real` | `mock` | `mock` starts MSW in the browser with the contract mocks. `real` never loads MSW and calls the API. |
| `NEXT_PUBLIC_API_BASE_URL` | URL | `http://localhost:4000` | API origin. `NEXT_PUBLIC_API_URL` is still read as a fallback. |

Legacy: `NEXT_PUBLIC_API_MOCKING=disabled` also means real.

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

## Sign-up (mock)

Try it on :3000: Sign in page > "Request an account" > submit. Signing in with that email shows "Awaiting approval". Sign in as admin@ (or any ABM+) > Administration > Sign-up requests to approve or reject. Four seeded pending requests use `@example.test` emails. Mock data lives in this browser only (`af:mock-signups`). Real mode calls the assumed endpoints in CONTRACT-GAPS #23 and shows "not available on this server yet" on 404.
