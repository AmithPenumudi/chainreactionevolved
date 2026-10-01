# Testing

Two layers. Run both before shipping any change.

## 1. Automated tests (game logic)

Covers `src/game/*.ts` — the chain-reaction engine, AI, profile/XP, puzzles,
and challenges. Pure logic, no UI, no device needed.

```
npm test          # run once
npm run test:watch   # re-run on file changes while developing
```

Several hundred tests across ~30 files (the full run takes a few minutes, mostly the AI
and brute-force puzzle suites):

Game logic (`src/game/__tests__/`)

- `engine.test.ts` — critical mass, placement rules, chain reactions,
  eliminations, portals, shields, amplifiers, energy cap, board shrink
- `engine.invariants.test.ts` — seeded fuzz: thousands of random games on every
  board size / player count / arena map, asserting orb conservation, settled
  boards, no orphaned modifiers, valid turn order; plus edge cases (shrink
  eliminations, stale flags, repeat eliminations, forfeit)
- `abilities.test.ts` — every ability incl. target validation, EMP timing,
  Double Drop (two placements), energy accounting
- `maps.test.ts` — arena maps (size, symmetry, portal pairing, connectivity) and
  Chaos Grid (limits, clamping, determinism, exact tile counts, extreme seeds)
- `ai.test.ts`, `ai.fuzz.test.ts` — legal moves per difficulty, full AI-vs-AI
  games in every mode/map that must finish, valid ability casts, time budget
- `puzzles.test.ts`, `puzzles.solver.test.ts` — data integrity, plus a brute-force
  solver proving every puzzle is solvable within its move cap and gold is reachable
- `profile.test.ts`, `challenges.test.ts`, `settings.test.ts`, `persistence.test.ts`
  — XP/streaks, rotation, and corrupt / blocked / out-of-range localStorage, puzzle
  unlock rules (adding puzzles never re-locks anyone)
- `ai.shrink.test.ts` — Sudden Death awareness: bots avoid the ring the shrink deletes
- `ai-client.test.ts` — the AI Web Worker client: round trip, crash / timeout / no-Worker
  fallbacks, concurrent requests
- `haptics.test.ts`, `undo.test.ts`, `a11y.test.ts` — vibration rules, undo budget,
  screen-reader cell labels

Adversarial suites — these go after the positions a player would have to be _trying_ to reach,
rather than the rules as written. Each assertion that reads like a regression note is one:

- `engine.adversarial.test.ts` — saturated and near-critical boards on every size, amplifier
  feedback that trips the iteration cap, geometry where critical mass exceeds the number of outlets
  (fortify, owned reactor, corridor cells, 1×N, cells sealed in by walls), the full critical-mass
  matrix, portal/amplifier/dead/shield interactions incl. portals with no partner and portals
  pointing at each other, a frozen state passed through `applyMove`, byte-identical repeat results,
  a decided game asked to keep playing, an owed placement outliving its owner, an unbounded ability
  chain, injected/hand-corrupted boards, and both cascade early exits — an unsettleable board is cut
  short, a long one that can settle never is, and a dead position becomes a draw without looping
- `ai.adversarial.test.ts` — all nine difficulty pairings to completion, four bots on an arena map,
  no unaffordable or out-of-range ability cast, no missed win-in-one, no mutation of the position
  handed to the search, a stale answer arriving after the board moved on, a turn with nothing legal
  in it, a cost ceiling on the largest board and on a saturated one, and the move sampler's
  distribution (every element reaches every slot, which the sort-based shuffle it replaced did not)
- `sync/__tests__/merge.adversarial.test.ts` — 200 seeded random device pairs asserting every merge
  is commutative to the byte, idempotent, and reaches a fixed point within one further pass; plus
  time-zone-split period keys, a rollover that must not resurrect a claim, and a two-device
  offline-then-online exchange

Bot decisions are seeded through a stubbed `Math.random` in the adversarial AI suite, so a failure
there is reproducible from its seed rather than being a flake.

App code (`src/lib/__tests__/`, `src/components/__tests__/`)

- `compat.test.ts`, `index-guard.test.ts` — the "update WebView" guard (the inline
  `index.html` script is executed under both supported and unsupported conditions)
- `crash-log.test.ts`, `ErrorBoundary.test.tsx` — on-device error log and recovery screen

Component flow (`src/components/game/__tests__/`)

- `GameScreen.flow.test.tsx` — renders the real GameScreen under jsdom and plays
  complete bot-vs-bot matches (classic, 4-player, Sudden Death, Abilities, Arena,
  Blitz timer) to the result screen
- `GameScreen.undo.test.tsx`, `GameScreen.zoom.test.tsx`, `cellsize.test.ts` — undo
  flow, zoom toggle on big boards, and board sizing for portrait / landscape / desktop

React only flushes effects when an `act()` scope ends, so component tests that wait for a
bot must advance fake timers in many short `act()` calls (see `advance()` in the undo test).

### Android smoke test (real device / emulator)

```
npm run build:capacitor && npx cap sync android && (cd android && ./gradlew assembleDebug)
npm run test:android            # installs the debug APK, then drives the real app
npm run test:android -- --no-install --serial emulator-5554
```

`scripts/android-smoke.mjs` uses adb plus the WebView's DevTools protocol (no extra
dependencies) to check: the WebView guard, home screen, Back navigation, orb colours, a
real match with undo, Hard-bot responsiveness (no main-thread stall over 400 ms) and that no
JavaScript exception is thrown. It taps with real touch gestures, because a scripted
`element.click()` has no user activation and Chrome then skips the page's history entries,
which makes Back behave differently from what a player sees.

**When to add a test:** any time you touch `src/game/*.ts` and the change
affects behavior (not just visuals) — new ability, new tile type, new AI
heuristic, new XP rule, etc. Add the case next to the existing ones for that
file.

## 2. Manual regression checklist (Android app)

Lessons from testing on an emulator with an _older WebView_ (API 34 image ships
Chrome 113 — real phones can be older still):

- Don't use CSS relative colour syntax (`oklch(from …)`, needs Chrome 119): use the
  `lighten` / `darken` / `withAlpha` helpers in `src/game/colors.ts` (`color-mix()`).
  Symptom when broken: every orb renders black.
- The hardware Back button is handled in `MainActivity.java` + the history stack in
  `src/routes/index.tsx`. Check: Game → Back → Setup → Back → Home → Back exits.
- 15-column boards must fit the phone width (no horizontal page overflow).
- Chrome DevTools can attach to the debug build: `adb forward tcp:9222
localabstract:webview_devtools_remote_<pid>` then open `http://localhost:9222/json`.
- The `Pixel_2_API_27` emulator image ships Chrome 61. The app cannot run there at all; the
  classic inline script in `capacitor-src/index.html` must show "Update needed" instead of a
  blank white page (the React bundle cannot even be parsed on such a WebView).
- Landscape phones use a two-column layout (`land:` variant in `styles.css`). Rotate with
  `adb shell cmd window user-rotation lock 1` (and `lock 0` to go back).
- Hard AI runs in a Web Worker (`src/game/ai.worker.ts`); it must not stall the UI.
- Inter is bundled (`src/assets/fonts`, `@font-face` in `styles.css`), so the app looks the
  same offline. Check with airplane mode: `adb shell cmd connectivity airplane-mode enable`
  and confirm `document.fonts.check("16px Inter")` is true. `fonts.test.ts` fails if any
  Google Fonts URL creeps back in.

Automated tests don't touch the native shell, rendering, or touch input —
run this by hand after any change before considering it done, and always
before a release build.

### Rebuild and install

```
npm run build:capacitor
npx cap sync android
cd android && ./gradlew.bat assembleDebug
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

### Checklist

**Launch**

- [ ] App installs without error
- [ ] App launches to the home screen (no crash, no blank/white screen)
- [ ] Fonts and styling render correctly (not default system font/unstyled)

**Navigation**

- [ ] Quick Play → Match Setup → back button returns to home
- [ ] Challenges, Puzzles, How To Play, Profile, Settings all open and have a
      working back button
- [ ] Android hardware/gesture back button behaves sensibly on every screen
      (goes back a level, doesn't exit the app unexpectedly)

**Core gameplay (Classic mode, local multiplayer)**

- [ ] Start a Quick Play match with 2 players
- [ ] Tap an empty cell — orb places, ownership color updates
- [ ] Tap the same cell again (below critical mass) — orb count increases
- [ ] Load a cell to critical mass — it explodes and orbs propagate to
      neighbors with the animation playing
- [ ] Trigger a chain reaction (3+ cells) — no visual glitches, no freeze
- [ ] Play to a win — winner screen/banner shows the correct player
- [ ] Rematch and exit-to-home both work from the end screen

**Other modes**

- [ ] Abilities mode: energy bar fills, an ability can be cast, target
      selection works
- [ ] Arena mode: special tiles (portal/wall/amplifier) render and behave
      distinctly on the board

**Puzzles**

- [ ] Open a puzzle, make moves, solve it — medal screen appears
- [ ] Puzzle progress persists after closing and reopening the app (force
      close, not just backgrounding)

**Persistence**

- [ ] Profile stats update after a match (games/wins count increments)
- [ ] Force-close the app (not just background it) and reopen — profile,
      settings, and puzzle/challenge progress all survive

**Device basics**

- [ ] Rotate the device/emulator — layout doesn't break (or is correctly
      locked to one orientation, if that's intended)
- [ ] Background the app mid-match (Home button) and resume — game state is
      still intact
- [ ] No crash in `adb logcat` during the above (grep for `AndroidRuntime` /
      `FATAL EXCEPTION`)

### Fast smoke test (small change, low risk)

If the change is small and clearly isolated (copy tweak, color, etc.), it's
enough to: install → launch → confirm home screen renders → play a few moves
of one match → force-close and relaunch to confirm no persistence breakage.
Run the full checklist above before any release build.
