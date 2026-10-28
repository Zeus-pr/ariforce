# @ariforce/mobile

Expo SDK 58 (expo-router, React Native 0.88, React 19.3) stub of the AriForce field app for
Android and iOS: brand splash, email + password sign-in against the AriForce API, a rep home
screen on sample data, and bottom tabs whose other screens are stubs. It runs in **Expo Go**: every native module it uses ships in
Expo Go for SDK 58. Nothing here needs a development build yet.

## Run on the Android emulator (Expo Go)

One-time shell setup on the Mac (Android Studio's SDK lives in `~/Library/Android/sdk`):

```sh
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$PATH"
```

Start an emulator (AVDs on this Mac: `Pixel_8`, `Pixel_9_Pro`) and check adb sees it:

```sh
emulator -list-avds
emulator -avd Pixel_8 >/dev/null 2>&1 &     # or start it from Android Studio > Device Manager
adb wait-for-device && adb devices          # expect: emulator-5554  device
```

Install and start Metro:

```sh
cd /Volumes/Prajesh_ext_512/AriForce-wt-mobile
source scripts/env.sh
pnpm install
cd apps/mobile
npx expo start --clear                      # or: ./node_modules/.bin/expo start --clear
```

Press `a`. Expo CLI installs the SDK 58 Expo Go on the emulator if it is missing and opens the
app. Port 8081 busy? Stop the other Metro with Ctrl+C in its own terminal, or run
`npx expo start --port 8083` (never kill a Metro another project owns).

Optional: Google's `android` CLI (`android emulator list|start|stop`, `android screen` for
screenshots) wraps the same tools. Install it only if you want it:
`curl -fsSL https://dl.google.com/android/cli/latest/darwin_arm64/install.sh | bash`.

### Which API the app talks to

| Where                           | API                                        | How                                                    |
| ------------------------------- | ------------------------------------------ | ------------------------------------------------------ |
| Default (emulator and phones)   | `https://ariforce-api.prajeshchoudhury.in` | `app.json` `extra.apiUrl`                              |
| Physical phone on your LAN      | e.g. `http://192.168.1.4:4000`             | `EXPO_PUBLIC_API_URL` in `apps/mobile/.env.local`      |
| Android emulator to a local API | `http://10.0.2.2:4000`                     | `EXPO_PUBLIC_API_URL_ANDROID_EMULATOR` in `.env.local` |

`10.0.2.2` is the Mac as seen from the Android emulator only; phones and Expo Go on a phone
need the Mac's LAN IP. On the emulator a `localhost` / `127.0.0.1` URL is rewritten to
`10.0.2.2` automatically. Personal values go in `.env.local` (git-ignored): Expo refuses
personal env vars from a non-`.local` file. Restart `expo start` after changing it.

## Later: a development build (not needed now)

Only when the app adds something Expo Go cannot run (Android remote push with FCM, a custom
native module). Then add `expo-dev-client`, set `extra.eas.projectId` (`eas init`), and build
with the `development` profile in `eas.json` (or `npx expo run:android` locally). Gradle needs
JBR 21, not Android Studio's bundled JBR 25:

```sh
export JAVA_HOME="$HOME/Library/Java/JavaVirtualMachines/jbr-21.0.11/Contents/Home"
```

If the merge step fails on a duplicate `libworklets.so`, add
`packagingOptions { pickFirst '**/libworklets.so' }`. Measure start-up on a release APK,
never on debug + Metro.

`eas.json` profiles: `development` (dev client, internal APK), `preview` (internal APK),
`production`. No EAS project id is committed.

## How it works

- **Routes** (`src/app`): root `_layout.tsx` gates on the session with `Stack.Protected`:
  signed out sees `sign-in`, signed in sees `(app)`. `(app)/_layout.tsx` is a stack holding
  `(tabs)` (Home, Business, DCR, Tour Plan, More; expo-router `Tabs`) and
  `coming-soon/[feature]`, the stub every unbuilt feature opens (keys in `src/lib/features.ts`).
  More holds the account details and Sign out.
- **Home** (`(tabs)/index.tsx`, blocks in `src/components/home/`), top to bottom: greeting,
  today (punch in/out, today's tour plan, DCR status), flags, quick actions, approvals (ABM and
  above only, same rule as the website), doctors planned today, this month's KPIs.
- **Sample data**: everything on Home except the user comes from `src/mocks/home.ts` (marked
  PLACEHOLDER, with the API source for each block). Punch in/out is local state; no GPS is read
  and nothing is sent. The screen shows a "Sample data" chip until `HOME_IS_PLACEHOLDER` is
  false.
- **Layout rhythm** (`layout` in `theme.ts`): one screen gutter (16), one gap between sections
  (24), one gap inside them (12). Every list row is the same box (`sizes.row`, one-line title
  and subtitle); grids use equal-flex rows so cards in a row match.
- **Tab bar** (`src/components/floating-tab-bar.tsx`): custom `tabBar` for expo-router `Tabs`,
  CUTLY's expanding-capsule pattern in AriForce navy. It floats 16 dp from the sides and sits
  above the safe area / gesture bar; the active tab widens into a navy pill with its label
  (Reanimated CSS transition, instant under Reduce Motion), with a selection haptic on press.
  Scroll screens add `useBottomSpace()` as bottom padding so nothing hides behind it.
- **Icons**: `@expo/vector-icons` Material Community (JS + font, works in Expo Go), loaded with
  the app fonts so they never pop in.
- **Splash**: the native splash (`expo-splash-screen`, mark on `#F4F8FD`) stays until fonts
  load; the in-app splash puts the mark in the same place, adds the wordmark, "Field Force
  CRM", "Arighna Pharma" and the three-dot loader, and fades out once the stored session is
  checked (minimum 1.1 s so it never flashes). Fonts never block launch longer than 2.5 s.
- **Auth** (`src/lib/auth-api.ts`): `POST /v1/auth/sign-in/email` returns a bearer token
  (better-auth `bearer()` plugin, already on the API), then `GET /v1/me`. Every request uses
  `credentials: 'omit'` and `Authorization: Bearer …`, never cookies, because better-auth
  rejects cookie POSTs without an `Origin` header and native apps send none. No API change
  is needed.
- **Session** (`src/lib/auth-context.tsx`): token and last profile in `expo-secure-store`;
  the profile is a TanStack Query (`['me', token]`) seeded from the saved copy, so a signed-in
  launch opens home at once and revalidates in the background. Offline launch keeps the saved
  profile. A 401 signs out with "Your session has ended. Sign in again."
- **Roles**: same rule as the website. A user whose roles are all retired or unknown gets the
  website's message, "Your role does not have access to this portal.", and is signed out, both
  at sign-in and when a stored session is restored. The allowed set is type-checked against
  `@ariforce/contracts` (`RoleKey` minus `RETIRED_ROLE_KEYS`), so a contract change fails
  `tsc` here.
- **Design system** (`src/theme.ts`, the only token file): colours, Google Sans families per
  weight (static instances of the website's variable font, Latin subset, OFL), type ramp,
  4-point spacing, radii, `boxShadow` strings, motion. Screens use `AppText` variants; no hex,
  font size or shadow literal lives outside the theme.
- **Motion**: Reanimated 4 CSS transitions for press feedback (scale 0.97, 120 ms, strong
  ease-out), a CSS keyframe loop for the dots, one layout entrance on the splash only. All of it
  honours Reduce Motion. Haptics: one success or error notification per sign-in attempt.
- **Keyboard**: `react-native-keyboard-controller` (`KeyboardAwareScrollView`) keeps the focused
  field and the Sign in button above the keyboard.

## Checks

```sh
cd apps/mobile
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint .
./node_modules/.bin/expo install --check
```

## Decisions and pitfalls (dated; append, don't rewrite)

- **2026-10-28** Bearer tokens, not `@better-auth/expo` cookies: works against the live API with
  no server change (curl: bearer sign-out 200; cookie sign-out without Origin 403
  `MISSING_OR_NULL_ORIGIN`). The `expo()` server plugin is only needed if we ever switch.
- **2026-10-28** No `babel.config.js`: on SDK 58 `babel-preset-expo` adds the worklets plugin
  for Reanimated 4 itself. (CUTLY added one on SDK 57; not needed here.)
- **2026-10-28** No `@expo/ui` yet: its `List` is a scrolling native list (Compose `LazyColumn`)
  and home is a pull-to-refresh `ScrollView`; there are no sheets, pickers or switches in the
  stub. Use `@expo/ui` first when those arrive.
- **2026-10-28** Light only (`userInterfaceStyle: "light"`), matching the mockups. Dark mode
  needs light/dark pairs in `theme.ts` first.
- **2026-10-28** Home uses expo-router JS `Tabs`, not `NativeTabs` (the expo-router skill's
  default): the tab bar keeps Google Sans labels and the same look on Android and iOS, and needs
  no SF Symbols / Material Symbols setup. Revisit when the app gets a dev build.
- **2026-10-29** Floating capsule tab bar (custom `tabBar`), frosted with `expo-blur` (in Expo
  Go): iOS native blur, `tint: light`; Android `blurMethod: 'dimezisBlurView'`, which since
  SDK 54 only blurs a `BlurTargetView`, so each tab screen wraps its content in `<TabScene>`
  and the focused one registers as the target (`blurMethod` replaces the deprecated
  `experimentalBlurMethod`). Near-solid white until a target exists; solid white when iOS Reduce
  Transparency is on. The active pill is sized to its measured label (Tour Plan shows "Plans",
  full name kept for screen readers and the title); the other tabs share the rest, 48 dp min. In this expo-router build
  the custom bar gets `emitter` + `navigateToTab`, not `navigation` (see `BottomTabBarProps`).
- **2026-10-28** Punch-in GPS is a stub. Real punch-in needs `expo-location` (in Expo Go, but a
  new native module): add it together with the attendance API.
- From CUTLY: never `Alert.alert` (inline errors and in-app banners); never put
  `lottie-react-native` in `app.json` plugins (breaks Expo Go); `expo-status-bar` takes no
  `backgroundColor`; use `StyleSheet.absoluteFill`; set weight with `fontFamily`, never
  `fontWeight`, on custom fonts; prefer node binaries over `npx` in agent shells.
