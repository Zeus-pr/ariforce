#!/bin/sh
# Runs vitest with HOME pointed inside the repo (SSD).
# On macOS vitest writes ~/Library/Application Support/vitest/.vitest-secret-token from
# os.homedir() and ignores XDG_*; HOME is its only override. Also pins Node's compile cache
# and TMPDIR so nothing lands on the internal disk even when turbo filters the env.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export HOME="${ARIFORCE_TEST_HOME:-$ROOT/.cache/test-home}"
export NODE_COMPILE_CACHE="${NODE_COMPILE_CACHE:-$ROOT/.cache/node-compile-cache}"
export TMPDIR="${TMPDIR:-$ROOT/.cache/tmp/}"
export NEXT_TELEMETRY_DISABLED=1
mkdir -p "$HOME" "$NODE_COMPILE_CACHE" "$TMPDIR"
exec vitest "$@"
