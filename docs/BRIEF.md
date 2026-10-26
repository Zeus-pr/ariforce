# AriForce build brief (Phase 0 and website MVP)

Owner: Prajesh Choudhury. Lead: AriForce lead. Build: AriForce Architect (structure, API contracts, data model) and AriForce Dev (implementation).

## Scope now
Start with the WEBSITE (manager/admin portal plus rep web views). Native Android field app is a parallel track later on the same API. Plan: https://cursor.com/canvas/store-b035eb90-ef8d-4e89-af22-3f3290abc909/07dfef32-d865-4ac7-b4a6-b07a568c3c8b

## Hard rules
1. Everything on the SSD `/Volumes/Prajesh_ext_512/AriForce`. Any library, package-manager cache or store goes on the SSD too (see `.npmrc`, set `npm_config_cache`, pnpm store dir, `COREPACK_HOME`, `XDG_CACHE_HOME` under `/Volumes/Prajesh_ext_512/.cache-ariforce`). Never install into the internal disk or `~`.
2. Monorepo, pushable to the new GitHub repo `ariforce` (private).
3. Don't reinvent the wheel. Use existing free UI collections and snippets: shadcn/ui, React Bits, Forge UI, UI Lora, Magic UI, Aceternity UI, 21st.dev, etc. Check license of each snippet and note it in `docs/UI-SOURCES.md`.
4. Font: Google Sans, from `/Volumes/Prajesh_ext_512/Google_Sans` (variable TTFs plus `static/`). Copy into `apps/web/public/fonts` and load with `next/font/local` or `@font-face`.
5. Knowledge and skills: use the CUTLY repo (`/Volumes/Prajesh_ext_512/CUTLY`, plus `cutly-expo58`, `cutly-customer-web`, `cutly-ops`) for patterns, docs (ARCHITECTURE.md, DESIGN.md, RULES.md, PRD.md) and code. Use the skills in `CUTLY/.agents/skills`: `impeccable`, `emil-design-eng` (Emil Kowalski), `design-taste-frontend`, `high-end-visual-design`, `minimalist-ui`, `animate`, `animation-performance`, `pick-ui-library`, `anti-slop`, `brandkit`, `improve-animations`, `review-animations`.
6. Work through GitHub issues and the project board. One branch per issue, PRs into `main`.

## First deliverable: animated splash
On open the site shows a full white screen with the logo (`brand/ariforce-logo.png`) centered and the text "AriForce" below it. After a short beat the logo animates smoothly (shared-element style, transform only, spring or ease-out) into the top-left corner, where it becomes the real header logo of the actual page, and the page fades in. Respect `prefers-reduced-motion`. Show once per session.

## Stack (from the plan, web track)
pnpm + Turborepo, TypeScript, Next.js + Tailwind + shadcn/ui, NestJS + Drizzle API, PostgreSQL + PostGIS (India region), better-auth with own RBAC, `company_id` on every row with Postgres RLS. Architect confirms or adjusts in an ADR.
