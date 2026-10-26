# Contributing

- Work from a GitHub issue. **One branch per issue**: `feat/<issue>-<slug>`, `fix/<issue>-<slug>`, `docs/<issue>-<slug>`.
- Open a PR into `main` with `Closes #<issue>`. Never push to `main` directly.
- If your branch is stacked on another PR, say so in the PR description ("Depends on #N").
- Before pushing: `source scripts/env.sh && pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
- API changes: edit `packages/contracts`, then `pnpm -F @ariforce/contracts openapi` and commit `docs/api/openapi.json` (CI fails if stale).
- DB changes: edit `packages/db/src/schema`, then `pnpm -F @ariforce/db db:generate`; hand-written SQL (RLS, triggers) goes in a `--custom` migration.
- Every tenant table has `company_id` + RLS. No secrets in git.
- UI snippets from third-party collections: record source + license in `docs/UI-SOURCES.md`.
