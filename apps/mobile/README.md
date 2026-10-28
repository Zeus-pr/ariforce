# @ariforce/mobile

Expo (SDK 58, expo-router) stub of the AriForce field app for Android and iOS: brand splash,
email + password sign-in against the AriForce API, and a placeholder home with sign-out.
Runs in **Expo Go**; no native modules beyond what Expo Go ships.

## Run (Android emulator, Expo Go)

```sh
cd /Volumes/Prajesh_ext_512/AriForce-wt-mobile
source scripts/env.sh
pnpm install
cd apps/mobile
./node_modules/.bin/expo start      # then press `a` (installs Expo Go on the emulator if needed)
```

API: `https://ariforce-api.prajeshchoudhury.in` (from `app.json` `extra.apiUrl`). To point at a
local API from the Android emulator, put `EXPO_PUBLIC_API_URL=http://10.0.2.2:4000` in
`apps/mobile/.env.local` (git-ignored) and restart `expo start`.

## Auth

- `POST /v1/auth/sign-in/email` → bearer token (better-auth `bearer()` plugin, already on the API)
  → `GET /v1/me` for the name. Token + last profile live in `expo-secure-store`.
- Every request uses `credentials: 'omit'` and `Authorization: Bearer …`, never cookies:
  better-auth rejects cookie POSTs with no `Origin` header (`403 MISSING_OR_NULL_ORIGIN`), and a
  native app sends no Origin. With bearer, no API change is needed.

## Checks

```sh
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint .
```
