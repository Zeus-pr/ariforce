#!/bin/sh
# Throwaway local Postgres on the SSD for API/DB integration tests (no PostGIS available locally).
# PostGIS geometry columns are stubbed as a text domain; spatial SQL is not exercised.
#   sh scripts/test-db.sh up    -> prints `export DIRECT_URL=... DATABASE_URL=...` (local only)
#   sh scripts/test-db.sh down  -> stops and deletes the cluster
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
B="${ARIFORCE_TESTDB_DIR:-$ROOT/.cache/testdb}"
PORT="${ARIFORCE_TESTDB_PORT:-54329}"
export PGOPTIONS="-c client_min_messages=warning"
export TMPDIR="$ROOT/.cache/tmp/"
mkdir -p "$TMPDIR"
case "$1" in
  up)
    if [ ! -d "$B/data" ]; then
      mkdir -p "$B/sock"
      initdb -D "$B/data" -U postgres -A trust >/dev/null
    fi
    pg_ctl -D "$B/data" -o "-p $PORT -k $B/sock -c listen_addresses=localhost" -l "$B/log" -w start >/dev/null 2>&1 || true
    psql -h localhost -p "$PORT" -U postgres -qtc "drop database if exists ariforce with (force)" >/dev/null
    psql -h localhost -p "$PORT" -U postgres -qtc "create database ariforce" >/dev/null
    {
      echo "CREATE DOMAIN geometry AS text;"
      echo "DO \$\$BEGIN CREATE ROLE anon; CREATE ROLE authenticated; EXCEPTION WHEN others THEN NULL; END\$\$;"
      for f in "$ROOT"/packages/db/migrations/*.sql; do
        sed -E 's/geometry\([^)]*\)/geometry/g; /CREATE EXTENSION[^;]*postgis/d; s/USING gist \(/USING btree (/g' "$f"
      done
      cat "$ROOT/scripts/test-db-postgis-stub.sql"
      echo "ALTER ROLE ariforce_app LOGIN PASSWORD 'ariforce_app';"
    } > "$B/all.sql"
    psql -h localhost -p "$PORT" -U postgres -d ariforce -v ON_ERROR_STOP=1 -q -f "$B/all.sql" >/dev/null
    echo "export DIRECT_URL=postgres://postgres@localhost:$PORT/ariforce DATABASE_URL=postgres://ariforce_app:ariforce_app@localhost:$PORT/ariforce"
    ;;
  down)
    pg_ctl -D "$B/data" -m fast stop >/dev/null 2>&1 || true
    rm -rf "$B"
    ;;
  *) echo "usage: $0 up|down" >&2; exit 2 ;;
esac
