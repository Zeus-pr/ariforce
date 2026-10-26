# Local setup (SSD only)

Rule: nothing for AriForce is written to the internal disk or `~`.

## 1. Toolchain

- Node >= 22.12 (CI uses 24, see `.nvmrc`). The Mac already has Homebrew Node.
- pnpm is installed **on the SSD**: `source scripts/env.sh && npm i -g pnpm@10` puts it in `/Volumes/Prajesh_ext_512/.tools/npm-global` (npm cache also on the SSD).
- `scripts/env.sh` exports `npm_config_cache`, `npm_config_store_dir`, `PNPM_HOME`, `COREPACK_HOME`, `XDG_*`, `TURBO_CACHE_DIR`, `TMPDIR`, telemetry opt-outs, all under `/Volumes/Prajesh_ext_512/.cache-ariforce` / `.tools`. `.npmrc` pins the pnpm store/cache/state dirs as a second safety net.

## 2. Install and run

```bash
source scripts/env.sh
pnpm install
cp .env.example apps/api/.env   # edit secrets; never commit .env
pnpm dev
```

## 3. Postgres + PostGIS

Option A, Docker (not installed on this Mac today): if you install Docker Desktop, first move its disk image to the SSD (Settings > Resources > Advanced > Disk image location), then `docker compose up -d`. The data dir is bind-mounted to `/Volumes/Prajesh_ext_512/.data-ariforce/pgdata`.

Option B, CI: DB/RLS/API integration tests always run in GitHub Actions against `postgis/postgis` (see `.github/workflows/ci.yml`).

Option C, existing Homebrew `postgresql@16` with a data dir on the SSD (`initdb -D /Volumes/Prajesh_ext_512/.data-ariforce/pg16`). Homebrew has no PostGIS here, and installing it would write to the internal disk, so this option cannot run the PostGIS migration.

Then:

```bash
pnpm -F @ariforce/db db:migrate   # uses DIRECT_URL (owner, direct connection)
pnpm -F @ariforce/db db:seed
DIRECT_URL=... DATABASE_URL=... pnpm test   # DATABASE_URL = ariforce_app (RLS enforced)
```

## 4. Leak check

```bash
find ~/.npm ~/.cache ~/.pnpm-store ~/Library/pnpm ~/Library/Caches ~/.corepack -newer /Volumes/Prajesh_ext_512/.leak-marker 2>/dev/null | head
```

Should print nothing (or only unrelated apps).

## 5. Production database (Supabase, Mumbai) and files (Cloudflare R2)

- Connection details arrive via a secure route; put them only in git-ignored `.env` files (names in `.env.example`).
- Once per project, as owner over `DIRECT_URL`: `pnpm -F @ariforce/db db:migrate` (creates PostGIS, tables, RLS, the `ariforce_app` role), then in the Supabase SQL editor give the role a login: `ALTER ROLE ariforce_app LOGIN PASSWORD '<secret>'`. The API's `DATABASE_URL` is the **transaction pooler** URL with user `ariforce_app.<project-ref>`.
- Leave Supabase Auth and the Data API unused (see ADR 0001).
- R2: create a private bucket + an API token scoped to it; set `R2_*`. Files are uploaded/downloaded with short-lived presigned URLs from the API.
