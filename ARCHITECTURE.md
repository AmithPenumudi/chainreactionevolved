# Architecture

Chain Reaction: Evolved — a turn-based grid game. Players drop orbs into cells; a cell at its
critical mass explodes into its neighbours, which can cascade. Last player holding cells wins.

> **This file is maintained, not archived.** Any change that alters how the system works —
> a new module, a changed decision, a new trap, something moved off the deferred list — updates
> this file in the same commit. A stale architecture doc is worse than none, because it is
> trusted. If you are reading this and it disagrees with the code, the code is right: fix the doc.

This document is the map of the codebase and, more importantly, the **reasoning behind it** —
the decisions and traps that are not visible from reading the code. Start here when picking the
project up cold. For how to test, see `TESTING.md`.

---

## 1. Shape of the project

One `src/` tree, two build targets:

| Target      | Entry                          | Build                     | Notes                                          |
| ----------- | ------------------------------ | ------------------------- | ---------------------------------------------- |
| **Web**     | `src/routes/` (TanStack Start) | `npm run build`           | SSR, deploys as a Cloudflare Worker via nitro  |
| **Android** | `capacitor-src/main.tsx`       | `npm run build:capacitor` | Plain client-side bundle, wrapped by Capacitor |

Android is the primary target. The Capacitor build is deliberately a _separate_ Vite config
(`vite.capacitor.config.ts`) because TanStack Start's pipeline needs a live server, which a
packaged app does not have. The WebView serves the app from `https://localhost`.

### Layering

```
src/game/        pure logic — no React, no DOM, no network
src/components/  React UI
src/lib/         platform concerns (compat guard, crash log)
scripts/         local tooling (device smoke test, metrics dashboard)
supabase/        SQL migrations
```

**The rule that matters: `src/game/*` stays pure.** No DOM, no React, no direct network calls.
That is what makes the engine fuzz-testable, the AI runnable inside a Web Worker, and the merge
logic testable without a backend. `src/game/sync/` and `src/game/metrics/` bend this only at
their edges (`client.ts` talks to Supabase; `activity.ts` reads `Date.now`) and both inject
those dependencies so the logic underneath stays testable.

---

## 2. The engine (`src/game/engine.ts`)

The heart of the game, ~30 exports, no dependencies.

**Model.** A `BoardState` is `{ rows, cols, cells }` with cells in a flat row-major array —
always index with `r * board.cols + c`, and always with _that board's own_ `cols`. `GameState`
wraps the board with players, turn, elimination flags, energy and mode config.

**Move lifecycle.** Deliberately split in two:

```
applyMove(state, r, c) -> MoveResult | null   // pure: computes the whole cascade, mutates nothing
commitMove(state, res) -> GameState           // pure reducer: folds the result into new state
```

`MoveResult.steps` holds each explosion wave with a board snapshot, which is what the UI
animates. This split is why the engine can be fuzzed and why a server could one day replay and
verify a match.

**Critical mass** is `effectiveCriticalMass()`, not the naive corner/edge/interior count: walls
reduce a cell's neighbour count, `fortified` adds one, an owned `reactor` adds one, and the
result floors at 2.

**Invariants a settled board must satisfy** (asserted by `engine.invariants.test.ts`):

- no cell at or above its critical mass (unless the game ended mid-cascade)
- orbs and owner agree — zero orbs means no owner, and vice versa
- walls and dead cells hold neither orbs nor an owner
- no modifier (`shielded`, `fortified`, `empLockedFor`) on an unowned cell
- in classic mode, total orbs equals the number of placements

**Cascades can be unbounded.** Amplifiers inject two orbs per neighbour instead of one, so a
dense board can oscillate forever. `resolveExplosions` caps iterations and, on hitting the cap,
discards the overflow so every cell ends below its critical mass. A permanently unstable board
would be worse than a slightly wrong one.

---

## 3. Modes

Two orthogonal axes:

- **`ModeKind`** (`MODE_CONFIGS`) — `classic` | `abilities` | `arena`. Controls whether energy,
  abilities and special tiles exist.
- **`GameMode`** (`DEFAULT_RULES`) — `classic` | `blitz` | `sudden-death` | `custom`. Controls
  the turn timer and board shrinking.

**Abilities** (`abilities.ts`, 7 of them) cost energy and produce a `MoveResult` like a normal
move, so they flow through the same commit path. `castAbility` re-validates its own targets,
mode and game state — it never trusts the caller, because both the UI and the AI call it.

**Arena** adds tiles: `power`, `portal`, `wall`, `amplifier`, `dead`, `reactor`. Five hand-built
maps (`arena-maps.ts`) plus a generated **Chaos Grid** (`chaos-grid.ts`) with a seeded PRNG, so a
given seed always rebuilds the same board. Generation retries until the layout is connected and
reasonably spread.

Hand-built maps are **180°-rotationally symmetric** so neither side gets an advantage; this is
asserted in `maps.test.ts`. Build them with `mirror()`, not `set()` — an unmirrored tile on an
even-sized board has no true centre and quietly favours one player.

**Puzzles** (`puzzles.ts`, 30) are fixed positions with an objective; only the solver moves.
`puzzles.solver.test.ts` brute-forces every one to prove it is solvable within its move cap
**and** that the gold threshold equals the true optimum — so a puzzle can neither be impossible
nor have an unintended shortcut.

---

## 4. AI (`src/game/ai.ts`, `ai-client.ts`, `ai.worker.ts`)

Three difficulties: `easy` (mostly random with light heuristics), `normal` (one-ply scored),
`hard` (2-ply alpha-beta with move ordering and a branching cap).

**Always call `chooseAIActionAsync()` from UI code**, not `chooseAIAction()`. The former runs the
search in a Web Worker so the board stays responsive; on the emulator, hard AI on the largest
board froze the UI for ~1s per move before this, and ~100ms after. It falls back to the main
thread on any failure — no Worker support, load failure, crash, or timeout — so a turn is never
lost.

**Sudden Death awareness.** Bots discount edge cells as a shrink approaches and simulate the
shrink inside their lookahead. Without this, bots hoarded the outer ring that the shrink deletes
and matches ended at the first shrink in 12 of 24 games; now 0 of 24.

---

## 5. Persistence and cloud sync

### Local (the source of truth)

Five `localStorage` keys: `cr-profile-v1`, `cr-settings-v1`, `cr-challenges-v1`, `cr_puzzles_v1`,
`cr-crashlog-v1`.

**Every loader sanitises.** Stored data is untrusted — it may come from an older build, a damaged
write, or a hand-edited store. `sanitizeProfile`, `sanitizeSettings` and friends rebuild a valid
object from whatever they find, and are reused to validate data coming back from the network.
`persistence.test.ts` feeds them every shape of garbage, plus storage that throws on read/write
(private mode, quota).

### Cloud (`src/game/sync/`)

Supabase Postgres, one row per player in `player_data` holding three JSON blobs: profile,
puzzles, challenges.

**Settings are deliberately NOT synced.** Chain speed, haptics and volume are device
preferences; pushing your phone's haptics setting to a tablet would be wrong.

**Anonymous-first, created lazily.** The account is created on the _first finished match_, not at
launch — an anonymous user is billed as a monthly active user, and someone who opens the app once
should not cost one. `syncIfSignedIn()` (launch) never creates an account; `syncAfterMatch()`
does.

**Merge semantics** (`merge.ts`) — every function is commutative and idempotent, so sync order
and retries cannot change the result:

| Data                        | Rule                                         | Why                                                                |
| --------------------------- | -------------------------------------------- | ------------------------------------------------------------------ |
| Counters (xp, games, wins…) | `max`                                        | They only ever grow                                                |
| `currentStreak`             | whichever side played most recently          | A streak resets on a loss, so `max` would be wrong                 |
| Username / avatar           | last write wins, via `profile.updatedAt`     | A conflict is harmless                                             |
| Puzzle records              | best medal, fewest moves, highest XP awarded | Never pay the same puzzle out twice                                |
| Challenge `claimed`         | union, grow-only                             | Forgetting a claim would pay a reward twice                        |
| Challenge progress          | `max`, but only within the same period       | Once a period rolls over the numbers describe different challenges |

**Sync settles to a fixed point rather than being strictly idempotent.** The first merge
canonicalises the order of matches that finished in the same millisecond; after that nothing
changes. Without that fixed point every sync would produce a different blob and trigger another
write — an infinite loop.

**A failed read aborts the pass.** "Read threw" and "no row yet" must not be conflated: pushing
local over a row you could not read would clobber another device.

**Security model.** Row-level security is the protection, not the key. The publishable key ships
inside the APK by design. `anon` is granted nothing; an anonymous Supabase user carries the
`authenticated` role. Every policy is scoped to `auth.uid() = user_id`, there is no `DELETE`
policy, and `player_activity` has no `SELECT` policy at all (write-only). Verified live: a second
player cannot read, overwrite or forge another's row.

**What this does NOT do.** An anonymous account lives in the auth token in local storage — an
uninstall makes it unreachable even though the row survives. Real backup needs **identity
linking (Google / email)**, which is the next phase.

---

## 6. Metrics and the dashboard

`player_activity` holds one row per (player, device, day) of **counters only** — no IP, no
location, no device model, no per-match detail. Keyed by device so a phone and a tablet each
re-upload their own day idempotently.

`src/game/metrics/activity.ts` buckets foreground time by the device's **local** calendar day
(a "daily active user" means the player's day). It handles the cases that quietly corrupt time
metrics: a session spanning midnight splits across both days, day boundaries are built from local
date parts so DST's 23- and 25-hour days stay correct, a backwards clock contributes zero, and one
uninterrupted stretch caps at 4h so a device left awake is not counted as play.

`src/game/metrics/charts.ts` holds the chart geometry as pure functions — scales anchored at
zero, bar thickness capped so marks never fill their slot, stacked-bar layout, and a
fits-with-padding check so an in-segment label is never clipped. Kept separate from rendering so
the maths is testable without a DOM.

Dashboard views live in a **`metrics` schema**, outside `public`. Run `npm run dashboard` — it
reads `.env.local` in Node and writes a self-contained `dashboard.html`, so the `service_role`
key never enters a browser bundle. `npm run dashboard -- --demo` renders sample data.

> Collecting this is analytics. It needs a Play Console **Data safety** entry and a privacy
> policy line before release.

---

## 7. UI conventions

**Colours: never use CSS relative colour syntax.** `oklch(from … calc(l + 0.1) c h)` needs
Chrome 119; Android WebViews are routinely older. Use `lighten` / `darken` / `withAlpha` from
`src/game/colors.ts`, which are built on `color-mix()` (Chrome 111+). When this was broken, every
orb rendered **black** and the game was unplayable while all tests passed.

**Too-old WebViews** are caught by a classic ES5 inline script in `capacitor-src/index.html`. It
must stay ES5 and inline: on Chrome < 111 the React bundle cannot even be parsed, so this is the
only code that can run and explain the blank screen.

**Feedback channels.** `sound.ts` (WebAudio blips) and `haptics.ts` (Vibration API) are both
best-effort: they no-op when the platform lacks the API, when the setting is off, or under
Reduced Motion, and never throw. Explosions are throttled in both so a long chain reads as one
event rather than a machine-gun.

**When something breaks at runtime.** `ErrorBoundary` catches render errors and shows a recovery
screen instead of a blank page; `src/lib/crash-log.ts` keeps the last few errors on the device so
a player can copy them from Settings → Support. The JS stack and React's component stack get
separate length budgets — concatenating them let a long stack silently drop the component tree,
which is the more useful half. Separately, `error-capture.ts`, `error-page.ts` and
`lovable-error-reporting.ts` are pre-existing TanStack/Lovable server-side plumbing for the web
build; they are not part of the game and are not dead code.

**Board sizing** lives in `src/game/board-size.ts` (pure, tested). Portrait phones, landscape
phones (a two-column layout via the `land:` CSS variant) and desktop each get their own fit.
Boards whose fitted cells fall below `ZOOM_BELOW` offer a zoom toggle rather than shipping
untappable cells.

**Accessibility.** Every cell carries a screen-reader label from `src/game/a11y.ts` describing
position, tile, owner, orbs vs critical mass and modifiers.

**Keys in sibling JSX conditionals.** Two adjacent `{cond && <div key={n}/>}` blocks are one
React child list. Namespace their keys (`chain-${n}`, `shrink-${n}`) — independent counters
collide and React silently duplicates or omits children. This was a real intermittent bug.

---

## 8. Build, release and environment

```bash
npm run dev              # web dev server
npm test                 # full suite (~3 min)
npm run test:watch       # re-run affected tests while developing
npm run lint             # eslint (android/ and build output are ignored)
npm run build            # web / Cloudflare
npm run build:capacitor  # Android web assets
npm run test:android     # drive the real app on a device (see TESTING.md)
npm run dashboard        # internal metrics dashboard
```

Android build (run Gradle from **PowerShell** on Windows; `gradlew.bat` fails under Git Bash):

```
npm run build:capacitor && npx cap sync android
cd android && ./gradlew assembleDebug
```

**Environment variables.** `.env` holds `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, both
public by design and inlined at **build time** — a key added after the APK is built is not in it.

> **Trap:** `vite.capacitor.config.ts` sets `root: "capacitor-src"`, and Vite resolves `.env`
> relative to `root`. Without the explicit `envDir` pointing at the project root, the Android
> bundle ships with **no credentials and sync silently does nothing** — no error anywhere, and
> every unit test still passes. `env-wiring.test.ts` guards this.

The `service_role` key belongs only in `.env.local` (gitignored). It bypasses RLS.

---

## 9. Traps worth knowing before you change things

1. **Index a board with its own `cols`.** Mixing `displayBoard` with `state.board.cols` reads the
   wrong cells — they differ for a frame after a Sudden Death shrink.
2. **Don't add a 9th player colour.** The palette is 8; more cannot stay distinguishable.
3. **`applyMove` must stay pure.** The fuzz suite asserts it does not mutate its input.
4. **The AI search is async.** Anything derived from it must tolerate the board moving on.
5. **React flushes effects when an `act()` scope ends.** Component tests that wait for a bot must
   advance fake timers in many short `act()` calls, not one long one (see `advance()` in
   `GameScreen.undo.test.tsx`).
6. **Adding puzzles must not re-lock players.** `isUnlocked` treats any later solve as proof of
   progress.
7. **Don't force-push.** The repo syncs to Lovable; rewriting pushed history loses their project
   history (see `AGENTS.md`).

---

## 10. Deliberately not built yet

| Deferred                              | Why, and what it would take                                                                                                                                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Per-match log**                     | Not needed until leaderboards. Today aggregates merge with `max`, so two devices playing offline keep the larger total rather than the sum. An append-only match log would make totals exact and derivable.        |
| **Identity linking (Google / email)** | The step that makes progress survive an uninstall. Use a **native** Google Sign-In plugin on Android: the WebView's `https://localhost` origin is not a valid OAuth redirect. Prefer magic-link over passwords.    |
| **Leaderboards**                      | Needs the match log plus server-side validation — the engine runs entirely on the client, so client-sent totals cannot be trusted. The engine being pure and deterministic means a server could replay and verify. |
| **Online multiplayer**                | The "Ranked" and "Play with Friends" buttons are placeholders. Needs realtime, matchmaking and an authoritative server.                                                                                            |
| **Dashboard UI in-app**               | Intentionally a locally generated HTML file. An in-app admin screen would ship admin access to every player's phone.                                                                                               |

---

## 11. Where to start for a common change

| I want to…                   | Touch                                                            |
| ---------------------------- | ---------------------------------------------------------------- |
| Change a rule of the game    | `src/game/engine.ts` + `engine.invariants.test.ts`               |
| Add an ability               | `src/game/abilities.ts` (+ energy cost, validator, test)         |
| Add an arena map             | `src/game/arena-maps.ts` — use `mirror()` for symmetry           |
| Add a puzzle                 | `src/game/puzzles.ts`; the solver test verifies it automatically |
| Change AI behaviour          | `src/game/ai.ts` (`scoreResult` is the heuristic)                |
| Change what syncs            | `src/game/sync/merge.ts` + a migration in `supabase/migrations/` |
| Change board layout / sizing | `src/game/board-size.ts` + `GameScreen.tsx`                      |
| Add a screen                 | `src/components/game/`, routed from `src/routes/index.tsx`       |
