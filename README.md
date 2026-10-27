# AriForce

Pharma sales-force automation (CRM, field force) for Arighna Pharmaceutical. Website first; the Android field app runs as a parallel track on the same API. See `docs/BRIEF.md`.

Everything for this project (code, dependencies, caches, build output) lives on the external SSD `/Volumes/Prajesh_ext_512`. **Always `source scripts/env.sh` before installing or building.**

## Layout

| Path                 | What                                                                 |
| -------------------- | -------------------------------------------------------------------- |
| `apps/web`           | Next.js (App Router) + Tailwind v4 + shadcn/ui: manager/admin portal |
| `apps/api`           | NestJS REST API (`/v1`), OpenAPI at `/openapi.json`                  |
| `packages/contracts` | Zod schemas, OpenAPI document, typed client, MSW mocks               |
| `packages/db`        | Drizzle schema, SQL migrations (RLS, audit), seed                    |
| `packages/ui`        | Shared shadcn/ui components and tokens                               |
| `packages/config`    | Shared tsconfig / ESLint / Prettier                                  |
| `docs/`              | Brief, ADRs, data model, RBAC, API conventions, setup                |

## Quick start

```bash
cd /Volumes/Prajesh_ext_512/AriForce
source scripts/env.sh
pnpm install
pnpm dev          # web on :3000, api on :4000
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Full setup (Postgres, migrations, seed): [`docs/SETUP.md`](docs/SETUP.md). Forgot password and invite email: [`docs/AUTH-PASSWORD-RESET.md`](docs/AUTH-PASSWORD-RESET.md). Contributing: [`CONTRIBUTING.md`](CONTRIBUTING.md).
