#!/usr/bin/env bash
# Source this before ANY install/build: `source scripts/env.sh`
# Keeps every package-manager cache, store and tool on the external SSD (docs/BRIEF.md rule 1).
SSD="${ARIFORCE_SSD:-/Volumes/Prajesh_ext_512}"
C="$SSD/.cache-ariforce"
export ARIFORCE_CACHE="$C"
export npm_config_cache="$C/npm"
export npm_config_store_dir="$C/pnpm-store"
export npm_config_prefix="$SSD/.tools/npm-global"
export PNPM_HOME="$SSD/.tools/pnpm-home"
export PNPM_STORE_DIR="$C/pnpm-store"
export COREPACK_HOME="$C/corepack"
export XDG_CACHE_HOME="$C/xdg-cache"
# XDG_CONFIG_HOME is intentionally NOT moved: gh/git keep their auth config there.
export XDG_DATA_HOME="$C/xdg-data"
export XDG_STATE_HOME="$C/xdg-state"
export TURBO_CACHE_DIR="$C/turbo"
export TURBO_TELEMETRY_DISABLED=1
export DO_NOT_TRACK=1
export NEXT_TELEMETRY_DISABLED=1
export NODE_COMPILE_CACHE="$C/node-compile-cache"
export npm_config_devdir="$C/node-gyp"
export ELECTRON_CACHE="$C/electron"
export PLAYWRIGHT_BROWSERS_PATH="$C/ms-playwright"
export CYPRESS_CACHE_FOLDER="$C/cypress"
export PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1
export TMPDIR="$C/tmp/"
export PATH="$PNPM_HOME:$npm_config_prefix/bin:$PATH"
# Docker (if ever installed) must keep its data root on the SSD too; out of scope here.
