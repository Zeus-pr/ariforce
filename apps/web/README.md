# @ariforce/web

Next.js App Router + TypeScript + Tailwind v4.

```bash
source scripts/env.sh   # from repo root: keeps every cache on the SSD
cd apps/web
pnpm install
pnpm dev                # http://localhost:3000
pnpm lint && pnpm typecheck && pnpm build
```

## Splash (#2)

- `src/components/splash/splash-script.ts`: inline `<head>` script. If `sessionStorage["af:splash-seen"]` is not set it adds `af-splash` to `<html>` before first paint, so CSS hides the page and shows the white overlay (no flash, no hydration flicker).
- `src/components/splash/splash.tsx`: after a 700 ms hold, measures the centred logo and the header logo (`[data-af-header-logo]`) and moves the overlay logo onto it with a transform-only WAAPI animation (850 ms, `cubic-bezier(0.32, 0.72, 0, 1)`). The wordmark fades out, the white veil fades, and `.af-page` elements fade in (opacity only). On finish it sets the session flag, removes the class and unmounts the overlay; the real header logo is revealed in the same box.
- `prefers-reduced-motion: reduce`: no movement, a 250 ms opacity crossfade.
- Evidence: `BASE_URL=http://localhost:3000 node e2e/splash-evidence.mjs` writes frames, videos and assertions to `docs/evidence/splash/`.
