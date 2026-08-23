# Testing

Two layers. Run both before shipping any change.

## 1. Automated tests (game logic)

Covers `src/game/*.ts` — the chain-reaction engine, AI, profile/XP, puzzles,
and challenges. Pure logic, no UI, no device needed.

```
npm test          # run once
npm run test:watch   # re-run on file changes while developing
```

96 tests across 6 files:
- `engine.test.ts` — critical mass, placement rules, chain reactions,
  eliminations, portals, shields, amplifiers, energy cap, board shrink
- `ai.test.ts` — legal-move guarantees per difficulty, winning-move detection
- `profile.test.ts` — XP/leveling math, match stat accumulation, streaks
- `puzzles.test.ts` — puzzle data integrity, medal thresholds, unlock order
- `challenges.test.ts` — daily/weekly rotation, progress accumulation, claiming
- `settings.test.ts` — settings persistence and speed factor

**When to add a test:** any time you touch `src/game/*.ts` and the change
affects behavior (not just visuals) — new ability, new tile type, new AI
heuristic, new XP rule, etc. Add the case next to the existing ones for that
file.

## 2. Manual regression checklist (Android app)

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
