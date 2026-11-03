# AriForce design system

Clean, data-dense, fast. Built for managers scanning exceptions and reps logging calls, not a marketing site.

## Where things live

- `packages/ui/src/tokens.css`: **every raw value** (colours, shadows, radius, motion). Brand navy `#0B1F4D` and teal `#00A9C4` are **approved** (2026-10-27); change `--brand-navy` / `--brand-teal` here and every scale and component follows.
- `packages/ui/src/globals.css`: Tailwind v4 `@theme inline` mapping tokens to utilities, plus base styles.
- `packages/ui/src/components/*`: shadcn/ui components (`components.json` in `packages/ui`) and borrowed pieces. Import as `@ariforce/ui/components/<name>`.
- `apps/web/src/components/shell/*`: app shell (header, sidebar, role context). `apps/web/src/app/globals.css` imports the UI globals and adds the splash rules.

Add a shadcn component: `source scripts/env.sh && cd packages/ui && pnpm dlx shadcn@latest add <name>`, then check that imports use `@ariforce/ui/lib/utils` (the CLI sometimes writes `cn`).

## Rules

1. No raw colours in components. Use semantic utilities: `bg-primary`, `text-muted-foreground`, `border`, `bg-card`, status `text-success|warning|danger|info` and `bg-*-soft`. Brand scales `brand-50…900` and `teal-50…700` are there for charts and highlights.
2. Type: Google Sans variable (400 to 700). UI text 14px, secondary 12–13px, page titles 24px semibold with `tracking-tight`. Use `tabular-nums` for every number column.
3. Radius `--radius` 10px (`rounded-sm` 6, `md` 8, `lg` 10, `xl` 14). No pill-shaped large containers.
4. Elevation: borders first, shadows rare and diffuse (`shadow-xs` on cards, `shadow-lg` only for popovers and dialogs).
5. Spacing: Tailwind's 4px scale. Page padding is `p-4` on mobile and `p-6` on larger screens; cards use 16px insets.
6. Motion: tokens `--ease-out` `cubic-bezier(0.23,1,0.32,1)`, `--ease-drawer` `cubic-bezier(0.32,0.72,0,1)`, durations 100/160/220/320ms. Animate `transform` and `opacity` only. UI motion stays under 300ms, and nothing animates on keyboard-driven actions. `prefers-reduced-motion` zeroes the duration tokens.
7. Light mode only. There is no dark token set, no theme toggle, no `dark:` classes and no `prefers-color-scheme` handling; `:root { color-scheme: light }` keeps native controls light even when the OS is dark.
8. Data: empty, loading (`Skeleton`, `app/(app)/loading.tsx`) and error states for every list. Mock data lives only in `apps/web/src/mocks/` and is marked "Sample data" in the UI.

## Shell

- Sticky header (56px): logo + wordmark (the splash lands here, so keep `[data-af-header-logo]` 36x32 at the same spot), sidebar toggle (Ctrl/⌘ B), search, notifications, account menu (signed-in mock user, "Preview as role (mock)" switch, Sign out). No logo plate.
- Sidebar (shadcn `collapsible="icon"`): Dashboard, Masters, Attendance, DCR, Tour plans, Reports, filtered by role (`apps/web/src/lib/nav.ts`, roles in `apps/web/src/lib/roles.ts`; see the matrix below). On mobile it opens as a Sheet.
- Dashboard: "Needs attention" layout from the research in PR #16 (ux-patterns): hierarchy breadcrumb, KPI strip (call average, coverage, frequency compliance, DCR compliance), exceptions list sorted by severity, approvals inbox with Approve and Return-with-comment, and a team table with coverage rings. All of it is mock data.
- Masters, Attendance, DCR, Tour plans and Reports are placeholders pointing to #8 to #11.

## Roles and navigation

Ladder, lowest to highest: Business Manager (BM), Area Business Manager (ABM), Regional Business Manager (RBM), Zonal Business Manager (ZBM), Sales Manager, General Manager, Vice President, Director. System Admin is technical and outside the ladder.
`apps/web/src/lib/roles.ts` takes role values from the contract enum (`ROLE_KEYS`, `HIERARCHY_ROLE_KEYS` in `@ariforce/contracts`) and adds only display labels, short labels, ordering helpers and gating predicates.

| Area       | BM                    | ABM to Director            | System Admin          |
| ---------- | --------------------- | -------------------------- | --------------------- |
| Dashboard  | Own day               | Team view, approvals inbox | No (lands on Masters) |
| Masters    | No                    | No                         | Yes                   |
| Attendance | Own check-ins         | Team map and table         | No                    |
| DCR        | Files own             | Team view                  | No                    |
| Tour plans | Fills and submits own | Approves team plans        | No                    |
| Reports    | No                    | Yes                        | No                    |

Pages outside a role's nav redirect to that role's home, both before paint (inline head script) and on client navigation (`AuthGate`).

## Sign-in (mock)

`/sign-in` is MOCK auth only (`apps/web/src/lib/mock-auth.ts`): one demo user per role, a shared demo password printed on the page, session in `localStorage["af:mock-session"]`. No real credentials, nothing secret, nothing sent anywhere. Signed-out visitors are redirected to `/sign-in?next=...` before first paint; signed-in visitors skip it. The splash plays once per session wherever the visit starts; on `/sign-in` it lands on the card logo (`[data-af-header-logo]`, same 9:8 ratio) with no layout shift.

## Checks

- `node apps/web/e2e/splash-evidence.mjs`: splash (CLS 0, transform/opacity only, exact landing box, once per session, reduced motion).
- `node apps/web/e2e/auth-evidence.mjs`: guard without paint, inline errors, show/hide password, Enter submits, role landing, sign out, splash handoff on /sign-in, 16px inputs.
- `node apps/web/e2e/shell-evidence.mjs`: nav by role, Google Sans applied, Ctrl+B collapse, toast, dialog, mobile sheet, no horizontal overflow, OS dark preference ignored, no console errors. Screenshots go to `docs/evidence/shell/`.
