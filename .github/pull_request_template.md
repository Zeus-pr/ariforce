## What

<!-- Short summary -->

Closes #

## Depends on

<!-- Stacked PRs, or "none" -->

## Checklist

- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` pass locally (with `source scripts/env.sh`)
- [ ] Contracts/OpenAPI regenerated if the API changed
- [ ] Migrations generated; new tenant tables have `company_id` + RLS
- [ ] No secrets, nothing outside the SSD
- [ ] Third-party UI snippets noted in `docs/UI-SOURCES.md`
