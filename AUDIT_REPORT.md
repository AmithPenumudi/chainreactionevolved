# Pre-release audit — Chain Reaction: Evolved

**Audited commit:** `a6642d2` on branch `fix/line-endings-on-windows`
(= `origin/main` at `820b5c9` **plus one file**, `.gitattributes`; `git diff origin/main..HEAD --name-only`
returns that file and nothing else, so every finding below applies to `main` unless stated.)

**Date:** 2 October 2026 · **Scope:** read-only. No project file was edited, created, renamed or
deleted except this report. No dependency was installed or changed. Nothing was committed.
`git status` was verified clean after every build.

**Verdict:** the code is in good shape. There are **no crash-level defects** and nothing wrong
with the game logic. Release is blocked by one deployment task, and there is one
**high-risk display issue on Android 15+ that could not be tested here** and must be checked on a
real modern device before you ship.

---

## 0. Resolution status (added after the audit, 2 October 2026)

The audit itself was read-only. The findings below are preserved **as found**; this block records
what has since been fixed, so nothing is chased twice.

| ID        | Finding                                          | Status                                                                             |
| --------- | ------------------------------------------------ | ---------------------------------------------------------------------------------- |
| B-1       | Privacy policy not deployed                      | **Open — yours.** Needs a deployment; cannot be fixed in code                      |
| H-1       | Safe-area insets ignored on Android 15+          | **Fixed** — `src/styles.css`; verified by injecting the insets Capacitor would set |
| H-2       | Release artifact never run                       | **Open — yours.** Needs a human playing the signed build                           |
| H-3       | Windows checkout unlintable                      | **Fixed** — `.gitattributes` (PR #6, awaiting merge)                               |
| H-4       | Flaky wall-clock assertion                       | **Fixed** — assertion replaced; full suite now 597/597 under load                  |
| M-1       | 46 unused UI components, ~30 unused deps         | **Fixed** — removed; dependencies 55 → 13                                          |
| M-2       | R8/ProGuard disabled                             | **Open by choice** — see the entry; enabling it before H-2 would be backwards      |
| M-3       | Auto Backup carries the session token            | **Open — your decision**, documented below                                         |
| M-4       | Metrics module unwired                           | **No action needed** — the guard test already covers it                            |
| M-5       | `_loader.mjs` dead                               | **Fixed** — removed                                                                |
| L-1 … L-3 | console.log in deps, bundle size, version values | **No action needed**                                                               |

---

## 1. Project summary

### Stack

| Thing         | Value                                             | Evidence                                                            |
| ------------- | ------------------------------------------------- | ------------------------------------------------------------------- |
| Framework     | TanStack Start + React 19                         | `package.json` → `@tanstack/react-start ^1.168.26`, `react ^19.2.0` |
| Language      | TypeScript 5.8                                    | `package.json`, `tsconfig.json`                                     |
| Android shell | Capacitor 8.5.0 (WebView)                         | `package.json` → `@capacitor/android ^8.5.0`, `capacitor.config.ts` |
| Build         | Vite 8 (two configs) + Gradle 8.14.3 / AGP 8.13.0 | `vite.config.ts`, `vite.capacitor.config.ts`, `android/`            |
| Backend       | Supabase (anonymous auth + one table)             | `package.json` → `@supabase/supabase-js`, `supabase/migrations/`    |
| Tests         | Vitest 4 + jsdom, 36 files / 597 tests            | `vitest.config.ts`                                                  |
| Web target    | Cloudflare Workers via nitro                      | `vite.config.ts` (`preset: "cloudflare-module"`)                    |

**This is not a native game engine.** There is no Unity/Godot/Flutter. The whole game is
TypeScript running in an Android WebView; the only Java is a 31-line `MainActivity`.

### Layout

```
src/game/        5,805 lines  pure logic (no React, no DOM, no network)
src/components/  4,955 lines  React UI
src/routes/                   two routes: / (the game) and /privacy
src/lib/                      compat guard, crash log, SSR error plumbing, version
android/                      Capacitor shell, signing config, icons, splash
supabase/migrations/          schema + row-level security
scripts/                      smoke test, release, store assets, dashboard
```

23,791 lines of TypeScript across 135 files. 36 test files.

### Gameplay features found

**Three mode kinds** (`src/game/engine.ts:16-20`)

- **Classic** — no energy, no abilities, no special tiles
- **Abilities** — energy economy + 7 castable abilities (`src/game/abilities.ts`):
  overload, shield, fortify, double-drop, emp, relocate, overcharge
- **Arena** — special tiles: walls, portals, amplifiers, dead zones, reactors, power tiles

**Rule variants inside Classic** (`src/game/engine.ts:4`): `classic`, `blitz` (turn timer),
`sudden-death` (board shrinks every N rounds), `custom`.

**Other systems**

- Local multiplayer, 2–8 players, pass-and-play
- Offline AI at three difficulties, running in a **Web Worker** with a main-thread fallback
  (`src/game/ai.worker.ts`, `ai-client.ts`, 8s timeout)
- 30 hand-built puzzles with medals and a brute-force solvability test (`src/game/puzzles.ts`)
- Daily/weekly challenges (`src/game/challenges.ts`)
- Profile: XP, per-mode stats, streaks, recent matches, 8 avatars
- Undo — max 3 per match, single human vs bots only (`src/game/undo.ts`)
- Chaos Grid board generator (`src/game/chaos-grid.ts`), Arena maps (`arena-maps.ts`)
- Board zoom for large boards, landscape two-column layout
- Settings: chain speed, turn confirmation, critical-cell hints, orb motion, reduced motion,
  haptics, sound/music + volumes, player colours
- Accessibility: per-cell screen-reader labels, distinct symbols per player, reduced motion
- Cloud save via Supabase anonymous auth, merge-on-read
- On-device crash log, copyable from Settings → Support

**Not present:** no ads, no analytics SDK, no in-app purchases, no third-party telemetry.
Verified: scanning `package.json` for `billing|admob|ads|firebase|analytics|segment|amplitude|
sentry|mixpanel|facebook|appsflyer` returns **none**.

**Placeholders:** "RANKED" and "PLAY WITH FRIENDS" on the home screen are `enabled: false` and
labelled _COMING SOON_ (`src/components/game/HomeScreen.tsx:53-54`, badge at `:123`). Disabled and
labelled is acceptable to Play; silently dead buttons would not be.

---

## 2. Commands run, and their real output

| Command                      | Result                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| `npx tsc --noEmit`           | **exit 0, clean**                                                                   |
| `npm run lint` (this branch) | **0 errors**, 6 warnings                                                            |
| `npm run lint` (on `main`)   | **19,132 errors** — see HIGH-3                                                      |
| `npm test`                   | **594 passed, 3 failed** of 597 — see HIGH-4                                        |
| `npm run build` (web)        | **exit 0** — nitro Cloudflare Worker produced                                       |
| `npm run build:capacitor`    | **exit 0**                                                                          |
| `npm run release:android`    | **exit 0** — signed AAB, 3.6 MB, `version 1.0.0, versionCode 1`                     |
| `npm run test:android`       | **9/9 device checks passed** (run earlier this session, debug APK, API 34 emulator) |

Verbatim release-build output:

```
BUILD SUCCESSFUL in 40s
C:\Users\Amith\Desktop\Chain Reaction Evolved\android\app\build\outputs\bundle\release\app-release.aab
  3.6 MB, signed by CN=Amith Penumudi, OU=Chain Reaction Evolved, O=Amith Penumudi
  version 1.0.0, versionCode 1
```

Nothing tracked by git was modified by any build (`git status --short` empty afterwards).

---

## 3. Issues by severity

### BLOCKER

#### B-1 — Privacy policy is not reachable at a public URL

- **Where:** `src/routes/privacy.tsx`, `src/content/privacy.ts`
- **What:** The app collects data (anonymous user ID, chosen display name, game progress) and
  uploads it to Supabase, so Play **requires** a privacy policy at a URL reachable without
  installing the app. The policy exists and is good, served at `/privacy` by the web build — but
  the web build has not been deployed anywhere, so there is no URL to paste into the Console.
- **Evidence:** route exists and builds; `vite.config.ts` targets Cloudflare Workers; no
  deployment was found or verified. The in-app copy renders correctly (confirmed on device).
- **Fix (not applied):** deploy the web build (`npm run build` then `npx nitro deploy --prebuilt`,
  or Cloudflare's dashboard) and use `https://<your-domain>/privacy`. Confirm it loads in a
  private window before submitting.
- **Also:** `RELEASE.md` §8 lists a check that the contact mailbox
  (`chainreactionevolved@gmail.com`, `src/content/privacy.ts:22`) actually receives mail. Send it
  a test message — a policy promising a deletion route that bounces is worse than no address.

---

### HIGH

#### H-1 — Edge-to-edge: the app ignores safe-area insets, and this is untested on Android 15+

- **Where:** `capacitor-src/index.html:5` (`viewport-fit=cover`), `src/styles.css` (no insets),
  `android/variables.gradle:4` (`targetSdkVersion = 36`)
- **What:** `targetSdk 36` means Android 15+ (API 35+) **enforces edge-to-edge**: the app draws
  under the status bar and the navigation/gesture bar. The app opts further in with
  `viewport-fit=cover`. Capacitor 8 then hands the insets to the web layer as CSS variables —
  and **the app's CSS uses none of them.**
- **Evidence:**
  - `git grep "safe-area-inset" -- src` → **no matches**. No `env(safe-area-inset-*)` either.
  - Capacitor injects `--safe-area-inset-top/right/bottom/left`
    (`@capacitor/android/.../plugin/SystemBars.java:265-268`), default `insetsHandling = "css"`
    (`:58`), i.e. _the page is expected to handle it_.
  - `SystemBars.java:179` computes real insets only on
    `Build.VERSION_CODES.VANILLA_ICE_CREAM` (**API 35**) and above; below that it uses
    `WindowInsetsCompat.CONSUMED` — zeros.
  - **The only emulator available here is API 34 / Android 14**
    (`adb shell getprop ro.build.version.sdk` → `34`). So every device test this session, including
    the 9/9 smoke run and all screenshots, ran on the one configuration where this cannot appear.
  - No opt-out in the theme: no `windowOptOutEdgeToEdgeEnforcement`, `fitsSystemWindows` or
    `statusBarColor` in `android/app/src/main/res/values/styles.xml`.
- **Likely symptom:** the top row (`← MENU` / `← BACK`, turn counter) renders under the status bar
  and the bottom of long screens under the gesture pill — clipped, overlapped, or hard to tap.
- **I could not verify this, and I am not guessing that it is broken.** It needs one run on a real
  Android 15 or 16 device, or an API 35+ emulator image.
- **Fix (not applied):** once confirmed, either consume Capacitor's variables in the app shell
  (`padding-top: var(--safe-area-inset-top)` etc. on the screen containers, with `env()` as the
  iOS-compatible fallback), or opt out of edge-to-edge in the theme. The former is the direction
  Android is going.

#### H-2 — The signed release build has never been run

- **Where:** `scripts/android-smoke.mjs:9-10`
- **What:** All nine automated device checks attach through the Chrome DevTools Protocol, which
  **only connects to a debuggable WebView**. So the artifact that has been exercised is the debug
  APK; the `.aab` you will upload has never been installed or played.
- **Evidence:** the script's own header documents the constraint; `android:debuggable` is correctly
  absent from the release manifest, which is exactly what prevents the tooling from attaching.
- **Why it matters here:** this project has twice shipped bugs that passed the whole suite — every
  orb rendered black on Chrome 113, and the Android bundle once shipped with no Supabase
  credentials. A release-only difference would surface nowhere else.
- **Fix (not applied):** extract a universal APK from the bundle with `bundletool` and
  `adb install` it, or push to an internal Play track and install from there. Then play a full
  match, a puzzle, and check Settings → Privacy by hand.

#### H-3 — A clean checkout on Windows fails `npm run lint` with 19,132 errors

- **Where:** repository root — no `.gitattributes` on `main`
- **What:** `core.autocrlf=true` (the Windows default) checks files out as CRLF; Prettier's
  `endOfLine` defaults to `"lf"`, so every line of every file is an error.
- **Evidence:** `npm run lint` on `main` → `✖ 19138 problems (19132 errors, 6 warnings)`, all
  `Delete ␍`. `git status` stays clean, because normalisation happens on commit — which is why it
  has been invisible. CI never sees it: `.github/workflows/ci.yml` runs on `ubuntu-latest`.
- **Status:** **already fixed in open PR #6** (the one file this audit branch adds). Lint goes
  19,132 → 0. Not yet merged.
- **Fix (not applied here):** merge PR #6.

#### H-4 — A wall-clock assertion inside a parallel test suite flakes

- **Where:** `src/game/__tests__/ai.fuzz.test.ts:196`
- **What:** `expect(ms).toBeLessThan(1500)` measures real elapsed time while Vitest runs other
  test files in parallel. On any loaded machine it fails.
- **Evidence:** full-suite run → `AssertionError: hard AI took 2271ms: expected 2270.69… to be less
than 1500`. Run **in isolation it passes** (verified twice). A second failure in the same run,
  `GameScreen.undo.test.tsx` _"allows at most three undos per match"_, also **passes in isolation
  (verified 3/3)**. Root cause: the Android emulator left running had accumulated ~49,800
  CPU-seconds (`qemu-system-x86_64`, top process by a wide margin) and was saturating the machine.
- **So: these are not real defects**, and the undo logic is fine. But the same assertion will flake
  on a busy CI runner and erode trust in the suite.
- **Fix (not applied):** make the AI budget assertion tolerant (relative to a calibration run), or
  isolate it (`describe.sequential` / its own project), or assert on search-node count rather than
  milliseconds.

---

### MEDIUM

#### M-1 — 46 unused UI components and ~30 unused runtime dependencies

- **Where:** `src/components/ui/` (46 files), plus `src/hooks/use-mobile.tsx`, `src/lib/utils.ts`,
  `components.json`
- **What:** The whole shadcn/ui library is present and **none of it is imported by the game**.
- **Evidence:** `git grep "components/ui" -- src ':!src/components/ui'` → **no matches**.
  `use-mobile` is imported only by the unused `ui/sidebar.tsx`; `lib/utils.ts` is imported only by
  `ui/*` (0 references outside it).
  Dependencies that exist solely for this dead code: ~26 `@radix-ui/*` packages, `recharts`,
  `embla-carousel-react`, `cmdk`, `vaul`, `react-day-picker`, `input-otp`,
  `react-resizable-panels`, `sonner`, `react-hook-form`, `@hookform/resolvers`,
  `class-variance-authority`, `date-fns`, `zod`, `tailwind-merge`.
- **Impact is supply chain, not size.** Tree-shaking already keeps them out of the shipped app —
  verified: `recharts`, `embla`, `cmdk`, `vaul`, `react-day-picker` each appear **0 times** in
  `dist-capacitor/assets/index-*.js`. The cost is ~30 packages you do not use that can each raise
  an advisory and block a release day.
- **Fix (not applied):** delete `src/components/ui/`, `src/hooks/`, `src/lib/utils.ts` and
  `components.json`, then remove the orphaned dependencies and re-run the suite. Do it as its own
  change, after release, not before.

#### M-2 — R8/ProGuard is disabled for release

- **Where:** `android/app/build.gradle:29` — `minifyEnabled false`; `proguard-rules.pro` is empty
- **What:** Code shrinking and obfuscation are off for the release build type.
- **Why it is only MEDIUM here:** the Java layer is a 31-line activity plus Capacitor; the game is
  JavaScript, already minified by Vite. The saving would be small and the risk of R8 stripping a
  Capacitor reflection target is real.
- **Fix (not applied):** leave as-is for v1, or enable `minifyEnabled true` + `shrinkResources true`
  and test the release build thoroughly — but only after H-2 is addressed, since an R8 problem
  appears **only** in the release artifact.

#### M-3 — Auto Backup copies the anonymous session token to the user's Google account

- **Where:** `android/app/src/main/AndroidManifest.xml:5` — `android:allowBackup="true"`, with no
  `android:dataExtractionRules` and no `android:fullBackupContent`
- **What:** Android Auto Backup will include the WebView's `localStorage`, which holds the Supabase
  anonymous auth token (`src/game/sync/client.ts:28-32`, `persistSession: true`) alongside profile,
  puzzle, challenge and settings data.
- **Two sides:** it is arguably a _feature_ — progress and the account survive a device change,
  which is otherwise impossible for an anonymous account. But the session token leaves the device
  to Google Drive, and that is a Data Safety–relevant fact.
- **Fix (not applied):** decide deliberately. Either keep it and be comfortable, or add
  `dataExtractionRules` excluding the auth token while keeping game progress.

#### M-4 — Metrics module is written, tested, and wired to nothing

- **Where:** `src/game/metrics/activity.ts` (137 lines), `supabase/migrations/0002_metrics.sql`
- **Evidence:** `git grep -l "metrics/activity" -- src ':!src/game/metrics'` → **no matches**. The
  only table the app writes is `player_data` (`src/game/sync/sync.ts:124,138`).
- **Why it matters:** your Data Safety answers are currently _correct_ precisely because this is
  unwired. If it is ever connected, the form and the privacy policy must change in the same
  commit. `src/lib/__tests__/release-wiring.test.ts:88` already guards this by asserting the sync
  layer only ever writes `player_data`.
- **Fix:** none needed now. Keep the guard.

#### M-5 — `_loader.mjs` is tracked but referenced nowhere

- **Where:** `_loader.mjs` (repo root)
- **Evidence:** `git grep "_loader" -- . ':!node_modules'` → **no matches**. A TypeScript ESM loader
  that nothing invokes; `npm run dashboard` uses `node --experimental-strip-types` instead.
- **Fix (not applied):** delete it, or document what it is for.

---

### LOW

#### L-1 — `console.log` present in the shipped bundle

`grep -c "console\.log" dist-capacitor/assets/index-*.js` → **4**. None come from app code:
`git grep "console\." -- src ':!**/__tests__/**'` shows only `console.error` in
`src/lib/error-capture.ts` (deliberate error plumbing) and `src/routes/__root.tsx:43`. The four are
inside dependencies. Harmless; noted for completeness.

#### L-2 — JS bundle is 679 KB uncompressed (~198 KB gzipped)

`dist-capacitor/assets/index-*.js`. Fine for a 3.6 MB app, and it is parsed once at launch, but it
is the main thing to watch on a low-end device. The AI already runs off the main thread.

#### L-3 — First-release version values

`versionCode 1` (`android/version.properties`), `versionName 1.0.0` (`package.json`). Correct for a
first upload. `npm run release:bump` manages both thereafter. Noted only so you confirm it is
intentional.

---

## 4. Core game logic — validation results

| Check                                               | Result                       | Evidence                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Critical mass: corner 2 / edge 3 / interior 4       | **PASS**                     | `src/game/engine.ts:140-146` implements exactly this; `engine.test.ts` asserts each case                                                                                                                                                                                                                           |
| Cell-aware critical mass (walls, fortify, reactor)  | **PASS**                     | `engine.ts:149-160` counts non-wall neighbours, floors at 2, `+1` for `fortified`, `+1` for an owned `reactor`                                                                                                                                                                                                     |
| Chains resolve with no infinite loop or freeze      | **PASS**                     | Three independent guards in `resolveExplosions`: an iteration cap (`engine.ts:475`), a conservation proof — orbs exceeding `settleCapacity()` with no sink can never settle (`:404-418`, `:601`), and repeated-board-state detection (`:508`). Overflow is discarded on truncation so the board always ends stable |
| Ownership / colour conversion                       | **PASS**                     | covered by `engine.test.ts`, `engine.invariants.test.ts`                                                                                                                                                                                                                                                           |
| Turn order and elimination                          | **PASS**                     | eliminations derived from final ownership rather than from the chain resolver, so losing the outer ring to a shrink counts (`engine.ts:866-871`); the turn is never left on an eliminated player (`:880-883`)                                                                                                      |
| **First-round edge case** (player with no orbs yet) | **PASS**                     | `engine.ts:869` — `if (eliminated[p.id] \|\| !state.hasMoved[p.id]) continue;` A player who has not yet placed cannot be eliminated. This is the classic bug in this genre and it is handled                                                                                                                       |
| Win **and draw** detection                          | **PASS**                     | `alive.length === 1` → winner, `=== 0` → draw (`engine.ts:875-877`); both block further placement (`:198`), and a dead position settles on `draw` and stays (`:832-838`)                                                                                                                                           |
| AI makes only legal moves                           | **PASS**                     | `ai.adversarial.test.ts` — _"four bots on an arena map never produce an illegal action"_                                                                                                                                                                                                                           |
| AI never hangs                                      | **PASS (with H-4 caveat)**   | runs in a Web Worker with an 8s timeout and main-thread fallback (`ai-client.ts:6`); device check _"Hard bot on the biggest board never freezes the UI (longest stall < 400 ms)"_ passes                                                                                                                           |
| Undo                                                | **PASS**                     | max 3, human-vs-bots only (`src/game/undo.ts`); `undo.test.ts` + `GameScreen.undo.test.tsx` pass in isolation (3/3)                                                                                                                                                                                                |
| Save / load restores state                          | **PASS**                     | five `localStorage` keys (profile, puzzles, challenges, settings, crash log), each with a sanitiser that tolerates damaged data; `persistence.test.ts`                                                                                                                                                             |
| Android Back button                                 | **PASS**                     | `MainActivity.java:19-33` walks WebView history and only exits from Home; device check confirms _"Back from Setup returns Home; Back from Home would exit"_                                                                                                                                                        |
| Rotation                                            | **PASS (not stress-tested)** | `configChanges` includes `orientation\|screenSize\|screenLayout\|density` so the activity is not recreated; a landscape two-column layout exists                                                                                                                                                                   |
| Error recovery                                      | **PASS**                     | `ErrorBoundary` + on-device crash log with separate JS/component-stack budgets                                                                                                                                                                                                                                     |
| Old WebView guard                                   | **PASS**                     | ES5 inline check in `capacitor-src/index.html` shows an "update WebView" screen instead of a blank page below Chrome 111                                                                                                                                                                                           |

**Not verified:** low-memory kill/restore, incoming phone call, and true tablet/notch layout — all
need a physical device or a configured emulator profile. See §6.

---

## 5. Play Store readiness checklist

| Item                          | Status                 | Note                                                                                                                                                                                                                                                |
| ----------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Builds a signed `.aab`        | **PASS**               | 3.6 MB, `jarsigner` verifies, `CN=Amith Penumudi`                                                                                                                                                                                                   |
| Signing key validity          | **PASS**               | alias `upload`, SHA384withRSA, valid **until 2054-01-08** (Play wants ≥ 2033)                                                                                                                                                                       |
| Keystore **not** committed    | **PASS**               | `git ls-files` finds no `*.keystore`/`*.jks`/`keystore.properties`; both ignored via `android/.gitignore:57-58`                                                                                                                                     |
| Release build not debuggable  | **PASS**               | no `android:debuggable` in the merged release manifest                                                                                                                                                                                              |
| 64-bit support                | **PASS (N/A)**         | no native libraries at all — the AAB contains no `.so`. A WebView app has no ABI constraint                                                                                                                                                         |
| R8 / ProGuard                 | **FAIL (low impact)**  | `minifyEnabled false` — see M-2                                                                                                                                                                                                                     |
| `applicationId` final         | **PASS**               | `com.chainreactionevolved.game`, consistent across `capacitor.config.ts`, `build.gradle`, `strings.xml`                                                                                                                                             |
| `versionCode` / `versionName` | **PASS**               | `1` / `1.0.0`, single-sourced, with `npm run release:bump`                                                                                                                                                                                          |
| `minSdkVersion`               | **PASS**               | **24** (Android 7.0) — well below any Play floor                                                                                                                                                                                                    |
| `targetSdkVersion`            | **NEEDS MANUAL CHECK** | **36**. That is the newest API at the time of writing and is very likely compliant — but **I will not state Play's current requirement from memory.** Confirm the live figure in Play Console → _App bundle explorer_ or the target-API policy page |
| Permissions justified         | **PASS**               | only two, both needed — see §5.1                                                                                                                                                                                                                    |
| Adaptive icon                 | **PASS**               | `mipmap-anydpi-v26/ic_launcher.xml` + `ic_launcher_round.xml`, raster at all five densities                                                                                                                                                         |
| App name                      | **PASS**               | `Chain Reaction: Evolved` (`strings.xml`)                                                                                                                                                                                                           |
| Splash screen                 | **PASS**               | `Theme.SplashScreen` with `windowSplashScreenBackground` for API 31+, plus legacy port/land drawables at all densities                                                                                                                              |
| Store listing assets          | **PASS**               | `store/icon-512.png` (composited from the real launcher icon), `store/feature-graphic.png` 1024×500, 7 phone screenshots in `store/screenshots/`                                                                                                    |
| Ads                           | **PASS (none)**        | no ad SDK in dependencies                                                                                                                                                                                                                           |
| In-app purchases              | **PASS (none)**        | no billing library; nothing to sell, so Google Play Billing does not apply                                                                                                                                                                          |
| Analytics / third-party SDKs  | **PASS (none)**        | see §5.2                                                                                                                                                                                                                                            |
| Privacy policy URL            | **FAIL**               | see B-1                                                                                                                                                                                                                                             |
| Families / children policy    | **NEEDS MANUAL CHECK** | see §6                                                                                                                                                                                                                                              |
| Release artifact play-tested  | **FAIL**               | see H-2                                                                                                                                                                                                                                             |
| Edge-to-edge on Android 15+   | **NEEDS MANUAL CHECK** | see H-1                                                                                                                                                                                                                                             |

### 5.1 Permissions

From `AndroidManifest.xml` and confirmed against the **merged release manifest**:

| Permission                                       | Justification                                                                      | Verdict      |
| ------------------------------------------------ | ---------------------------------------------------------------------------------- | ------------ |
| `android.permission.INTERNET`                    | Supabase cloud save                                                                | **Needed**   |
| `android.permission.VIBRATE`                     | haptic feedback on explosions (`src/game/haptics.ts`), user-toggleable in Settings | **Needed**   |
| `…game.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | auto-added by AndroidX at build time; self-scoped, not user-visible                | **Expected** |

No location, camera, microphone, storage, contacts or advertising-ID permission. This is a clean
set and makes the Data Safety form straightforward.

### 5.2 What the app collects — for the Data Safety form

**No third-party SDK collects anything.** There is no ad network, no analytics vendor, no crash
reporter. The only network destination is your own Supabase project.

What leaves the device, and when:

- **Only after a match is finished** — not on launch. (`syncAfterMatch` creates the account;
  `syncIfSignedIn` at launch never does. Guarded by `release-wiring.test.ts:97`.)
- **An anonymous user ID** — a random UUID; no email, no password, nothing identifying.
- **The display name the player chooses**, plus avatar.
- **Game progress** — XP, per-mode win/loss, streaks, recent match results, puzzle medals,
  challenge progress.

Table shape: `supabase/migrations/0001_player_data.sql:11-21` — one row per user, three JSONB
blobs, `version`, `updated_at`. Protected by row-level security; a second player cannot read
another's row (verified against the live project earlier in development).

**Not collected:** location, contacts, photos, files, messages, calendar, installed apps, purchase
history, advertising ID, **and crash logs** — the crash log stays on the device and is only ever
shared if the player copies it into a bug report themselves (`src/lib/crash-log.ts`).

`RELEASE.md` §4 already contains a filled-in answer table consistent with the above. One thing to
add to your own thinking: **M-3** (Auto Backup carries the session token to Google Drive).

---

## 6. What you must do manually, outside the code

1. **Deploy the web build and get the privacy policy URL** — blocks submission (B-1).
2. **Send a test email to `chainreactionevolved@gmail.com`** and confirm it arrives.
3. **Test on a real Android 15 or 16 device** — specifically the top and bottom edges of Home,
   Settings, Puzzles and a match (H-1). This is the single highest-value manual check.
4. **Install and play the signed release build** (H-2).
5. **Confirm Play's current target-API requirement** against `targetSdk 36`. I deliberately did not
   state it from memory.
6. **Families / children policy.** The game is colourful, has no violence, no chat and no ads —
   it may well attract under-13s. You must decide the target-audience answer in the Console. If you
   select a child-inclusive audience, extra obligations attach (Families policy, and the anonymous
   account/Data Safety answers get more scrutiny). Decide deliberately rather than by default.
7. **Content rating questionnaire** — expect "Everyone" / PEGI 3: no violence, no sexual content,
   no profanity, no gambling, no user-to-user communication, no shared user content, no ads.
8. **Developer account identity.** An _individual_ Play account publicly displays the developer's
   name **and address** on the listing. You cared about an email address being scraped; this is a
   larger exposure. Registering as an organisation (needs a D-U-N-S number) shows the organisation's
   details instead. Verify the current rule in the Console.
9. **Closed-testing requirement** — individual accounts generally must run a closed test with
   ~12 testers for 14 continuous days before production access. That is a two-week floor on your
   timeline. Confirm the current rule.
10. **Store listing copy** — ready to paste in `RELEASE.md` §3.
11. **Low-memory, incoming-call and tablet/notch behaviour** — not testable here; worth ten minutes
    on a real device.

---

## 7. What I did not do

- **Did not read every file.** Prioritised, as instructed: `src/game/` (all logic), the Android
  manifest/Gradle/signing config, `supabase/migrations/`, build configs, and the entry points.
  **Skipped:** the 46 unused `src/components/ui/*` files (beyond confirming they are unused), the
  bulk of `HowToPlayScreen.tsx` (static instructional copy), and per-puzzle data in the 1,244-line
  `puzzles.ts` (a brute-force solver test already covers solvability).
- **Did not test on a physical device or an API 35+ emulator** — only an API 34 emulator was
  available, which is exactly why H-1 is unresolved.
- **Did not run the release artifact** (H-2) — it cannot be driven by the existing tooling.
- **Changed nothing.** No file edited, created, renamed or deleted except this report; no
  dependency installed or upgraded; no build config changed; nothing committed. The builds that ran
  wrote only to gitignored output directories, verified by `git status` being clean afterwards.

---

## 8. Bottom line

The engineering is genuinely solid: pure, fuzz-tested game logic with real invariant and
adversarial coverage; correct critical-mass rules including the first-round elimination edge case
that most implementations get wrong; three independent guards against runaway cascades; a clean
two-permission manifest; a correctly configured, long-lived signing key that is not in the
repository; and no ads, analytics or third-party data collection to declare.

Before you ship, in priority order:

1. **B-1** — deploy the policy (blocks submission).
2. **H-1** — check the app on Android 15+. The one finding that could look broken to a real player
   on a modern phone, and the one this environment could not test.
3. **H-2** — play the actual release artifact.
4. **H-3** — merge PR #6 so the project is lintable on your own machine.

Nothing else needs to happen before release.
