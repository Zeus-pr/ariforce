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
pnpm -F @ariforce/db db:migrate   # uses DATABASE_URL (owner role)
pnpm -F @ariforce/db db:seed
DATABASE_URL=... DATABASE_URL_APP=... pnpm test
```

## 4. Leak check

```bash
find ~/.npm ~/.cache ~/.pnpm-store ~/Library/pnpm ~/Library/Caches ~/.corepack -newer /Volumes/Prajesh_ext_512/.leak-marker 2>/dev/null | head
```

Should print nothing (or only unrelated apps).
