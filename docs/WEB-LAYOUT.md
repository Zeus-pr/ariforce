# Web layout (apps/web + packages/ui + packages/config)

- **shadcn/ui components live in `packages/ui`** (`packages/ui/components.json`), exported as `@ariforce/ui`:
  - `@ariforce/ui/components/<name>` (e.g. `button`, `card`), `@ariforce/ui/lib/utils` (`cn`), `@ariforce/ui/hooks/<name>`, `@ariforce/ui/globals.css`.
  - Add components: `source scripts/env.sh && cd packages/ui && pnpm dlx shadcn@latest add <component>`. Record the source/license in `docs/UI-SOURCES.md`.
- **apps/web consumes packages/ui**: `transpilePackages: ['@ariforce/ui', '@ariforce/contracts']` in `next.config.ts`; `src/app/globals.css` imports `@ariforce/ui/globals.css` and `@source`s `packages/ui/src` so Tailwind sees its classes. App-only components go in `apps/web/src/components`.
- **packages/config** shares everything else:
  - tsconfig: `@ariforce/config/tsconfig/{base,nextjs,node,library}.json`
  - ESLint (flat): `@ariforce/config/eslint`
  - Prettier: `@ariforce/config/prettier` (root `package.json#prettier`)
  - Tailwind v4 preset (CSS-first): `@ariforce/config/tailwind/theme.css`, imported by `packages/ui/src/globals.css`. Design tokens (#3) go here / in `packages/ui/src/globals.css`.
- Fonts: Google Sans copied to `apps/web/public/fonts`, loaded with `next/font/local` (#3).
- API: `apps/web/src/lib/api.ts` typed client from `@ariforce/contracts`; mock mode via `@ariforce/contracts/mocks` (see `docs/API-CONVENTIONS.md`).

> Known quirk: the shadcn CLI may write `import { cn } from 'cn'` in packages/ui. Change it to `'../lib/utils'` (typecheck catches it).
