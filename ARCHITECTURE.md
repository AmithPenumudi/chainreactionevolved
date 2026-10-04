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

> **Trap:** `MoveResult.boardBefore` is the board _before the orb is placed_, not after. Showing
> it while the animation warms up left every tap with no feedback at all until the first
> explosion wave — measured at ~214ms from click to the orb appearing. `animateMove` now starts
> from `boardAfterPlacement(res)` so the player's own orb lands on the next frame, and skips the
> pre-explosion pause entirely when nothing explodes; that brought click-to-orb to ~57ms.
> The pause telegraphs the _explosion_, not the placement.
>
> `boardAfterPlacement` derives the board rather than `applyMove` storing it, because the AI
> search calls `applyMove` on every node and would pay for a clone it never looks at.

**Critical mass** is `effectiveCriticalMass()`, not the naive corner/edge/interior count: walls
reduce a cell's neighbour count, `fortified` adds one, an owned `reactor` adds one, and the
result floors at 2.

**A cell may only lose the orbs it actually throws out.** Critical mass and the number of outlets
are not the same number — `fortified` and an owned `reactor` each add one, and the floor at 2 lifts
a cell that has a single non-wall neighbour — so subtracting `cm` on every explosion quietly
deleted the difference. A fortified cell ate one orb each time it fired; a 1×N board and any
corridor cell walled in on three sides lost one per explosion. The drain is now
`min(cm, outlets × orbsPerNeighbour)` and the surplus stays behind. Two deliberate exceptions
remain, and they are the only ways an orb leaves the board: a `dead` tile absorbs what it is sent,
and a cell **sealed in by walls** has nowhere to send anything, so it still subtracts `cm` and acts
as a sink — keeping those orbs would park it permanently above its critical mass and break the
settled-board invariant.

**A decided game is decided.** `canPlace` refuses on `draw` as well as `winner`; a Sudden Death
shrink can wipe out every remaining player at once, and only `winner` used to be checked.

**A turn with nothing legal in it.** Owning a cell normally guarantees a move, but an EMP lock on a
player's only cell while every other cell belongs to an opponent leaves them nothing — and they are
not eliminated, so no other rule would move the turn along and the match simply stopped.
`passTurnUntilPlayable(state, canAct)` hands the turn on until it reaches someone who can act and
reports a draw if it gets all the way round. The predicate is injected because the ability half of
the answer (`canActNow` in `abilities.ts`, over `hasLegalMove` + `hasCastableAbility`) lives a layer
up and the engine must not depend on it. It returns its input untouched when the player on turn can
already act, which is what lets `GameScreen` run it on every state without spinning.

**Turn-passing and the shrink are pure.** `forfeitTurnWithShrink()` and `passTurnUntilPlayable()`
live in the engine rather than inside a React effect, so both are unit-tested directly instead of
only through a bot match. `GameScreen` is a one-line caller for each.

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

> **Trap:** a capped cascade's `chainCount` describes the oscillation, not a chain anyone built.
> `MoveResult.truncated` marks those, and `commitMove` clamps what they contribute to `largestChain`
> to the cell count, so "biggest chain" stays a number that means something. `totalExplosions` still
> gets the raw count, because those explosions did happen.

**Two provable early exits keep the cap from being the common path.** Every wave is a full board
scan plus a board clone for the animation, and the AI search pays it on every node that reaches such
a position, so running `max(200, rows × cols × 2)` waves to discover what is knowable in one is the
engine's worst case for cost. `resolveExplosions` now stops as soon as either holds:

1. **Over capacity.** `settleCapacity()` bounds the orbs a board could hold with every cell below its
   critical mass. Hold more than that and there is nowhere for them to come to rest. Sound only when
   nothing can swallow an orb — a `dead` tile or a live shield could drain the count back under the
   bound later — so it is gated on `hasOrbSink()`. The bound is deliberately optimistic (a `reactor`
   counts its +1 even unowned, since it may be captured later) so it never grows mid-cascade, which
   is what makes the verdict permanent rather than a snapshot.
2. **A repeated board state.** A wave's outcome depends on nothing but the board, so a board that
   comes round a second time is a proven infinite loop. Signatures are exact strings, not a hash: a
   collision would silently truncate a cascade that was going to settle.

Neither is checked until `max(16, (rows + cols) × 2)` waves have passed, so an ordinary cascade — a
handful of waves — pays nothing, and a long dramatic one that ends in a win partway through still
plays out as it did. Measured on a saturated 6×6 amplifier board: **202 waves and 7029 explosions
before, 25 waves and 657 explosions after**; on a 10×15, 51 waves against a cap of 301.

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

> **Trap:** an owed Double Drop keeps the turn with its caster, and an ability cast during that
> window does not spend the drop — so the turn stays too. Unbounded, that is a soft-lock rather than
> a combo: on an amplifier board each Overload starts a chain that refunds more energy than it cost,
> so the caster can go on casting and the opponent never moves again (measured: **50 consecutive
> casts with energy still pinned at 100**). `GameState.extraPlacementCastUsed` allows the owed drop
> to survive exactly one cast, which is what the combo is for, and refuses the second. `GameScreen`
> greys the ability bar out once it is spent, rather than offering buttons that do nothing.

**An owed extra placement never outlives its owner.** A Sudden Death shrink can eliminate the player
holding one, and only one can be outstanding at a time, so a flag left pointing at a dead player
blocked every later power-tile bonus for the rest of the match. `applyShrink` and `commitMove` both
drop it.

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

**Sampling must actually be random.** `worstReplyForMe` and the Relocate source search both look at
a capped sample of candidates, and both used `sort(() => Math.random() - 0.5)` to pick it. That is
not a shuffle — the comparator is inconsistent, so the result stays close to the input order and the
"sample" was mostly the first few cells in scan order, which is a bias invisible from outside. Both
now go through `shuffled()` (Fisher–Yates, on a copy — the old one also sorted the caller's array in
place). It is exported so its distribution can be asserted directly.

**Always call `chooseAIActionAsync()` from UI code**, not `chooseAIAction()`. The former runs the
search in a Web Worker so the board stays responsive; on the emulator, hard AI on the largest
board froze the UI for ~1s per move before this, and ~100ms after. It falls back to the main
thread on any failure — no Worker support, load failure, crash, or timeout — so a turn is never
lost.

**Two things the turn counter and the shrink must agree on.** `forfeitTurn` advances `turn`: EMP
locks expire against an absolute turn number, so with the counter frozen a lock set in a timed game
never lifted once both players started letting the clock run out. Because the shrink is scheduled
off that same counter, `forfeitTurnWithShrink()` applies the shrink when the turn that timed out is
the boundary one — otherwise advancing `turn` would step straight over a shrink. And `applyShrink` folds
the cascade the ring's removal sets off into `largestChain` / `totalExplosions`; only the captures
were counted, so those explosions were missing from the match totals entirely.

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
| Challenge `claimed`         | union, but only within the same period       | Forgetting a claim pays twice; keeping a stale one pays nothing    |
| Challenge progress          | `max`, but only within the same period       | Once a period rolls over the numbers describe different challenges |

**Sync settles to a fixed point rather than being strictly idempotent.** The first merge
canonicalises the order of matches that finished in the same millisecond; after that nothing
changes. Without that fixed point every sync would produce a different blob and trigger another
write — an infinite loop.

**Commutativity is load-bearing, and three places quietly broke it.** Each one is a pair of devices
that would have kept overwriting each other forever, because every pass produced a different blob:

- **Period keys.** `mergeChallengeState` used to keep the calling device's `dailyKey` / `weeklyKey`.
  Those keys are built from the device's **local** calendar day, so a phone and a tablet either side
  of a date line disagree permanently. The later period now wins, compared chronologically — string
  order will not do, because the keys are not zero-padded and `"2026-1-9" > "2026-1-10"` as text.
- **`claimed` across a rollover.** Grow-only is right _within_ a period, but the daily pool rotates
  and repeats. `rollPeriods` deletes a claim locally when the day turns over; pulling the other
  device's stale `claimed: true` back in made the fresh challenge with the same id look
  already-claimed, and **the player never got that reward**. Progress, claims and sets from a side
  still on an earlier period are now dropped rather than merged. Mastery ids belong to no period and
  always merge.
- **The identity tie.** "A tie on `updatedAt` keeps what this device shows" is not commutative, and
  the tie is the common case, not a freak one: a player who never renamed leaves `updatedAt` at 0 on
  every device. It is now broken on name-then-avatar.

Key **order** is settled by sorting too (`abilityCounts`, puzzle ids, challenge ids, union sets).
The contents were already order-independent; the serialised form was not, and a blob that differs
only in key order still reads as a change to anything comparing it.

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

**Safe areas / edge-to-edge.** `targetSdk 36` means Android 15 (API 35) and up draw the app under
the status and gesture bars, and `capacitor-src/index.html` opts further in with
`viewport-fit=cover`. Capacitor then hands the insets to the page as `--safe-area-inset-*` on
`<html>` and expects CSS to deal with them. `src/styles.css` maps those (with `env()` as the
iOS/web fallback) onto `--sa-*`, pads `body` with them, and — unlayered, so it beats Tailwind's
utility — redefines `.min-h-screen` to subtract them.

> **Trap:** Capacitor reports insets **only on API 35+**
> (`SystemBars.java` gates on `VANILLA_ICE_CREAM`); below that they are all zero. So on an
> Android 14 emulator this whole mechanism is invisible and a missing inset looks fine. It was
> missing until an audit found it. To test the behaviour without an Android 15 device, set the
> four `--safe-area-inset-*` properties on `document.documentElement` by hand — that is the exact
> path a real device takes.

**No component library.** `src/components/ui/` (46 shadcn components), `src/hooks/` and
`src/lib/utils.ts` were deleted: nothing in the game ever imported them. They were tree-shaken out
of the bundle, so removing them changed its size not at all — the win was **42 fewer npm
dependencies** (55 → 13) and that much less supply-chain surface. The game's UI is hand-written
Tailwind; if you need a primitive, write it rather than reinstating the library.

**Feedback channels.** `sound.ts` (WebAudio blips) and `haptics.ts` (Vibration API) are both
best-effort: they no-op when the platform lacks the API, when the setting is off, or under
Reduced Motion, and never throw. Explosions are throttled in both so a long chain reads as one
event rather than a machine-gun.

**When something breaks at runtime.** `ErrorBoundary` catches render errors and shows a recovery
screen instead of a blank page; `src/lib/crash-log.ts` keeps the last few errors on the device so
a player can copy them from Settings → Support. The JS stack and React's component stack get
separate length budgets — concatenating them let a long stack silently drop the component tree,
which is the more useful half. Separately, `error-capture.ts` and `error-page.ts` are
server-side plumbing for the web build: h3 swallows in-handler throws into a generic 500 with the
stack stripped, so `src/server.ts` detects that shape, recovers the original error out-of-band and
renders a real error page. They are not part of the game, and they are not dead code.

**Board sizing** lives in `src/game/board-size.ts` (pure, tested). Portrait phones, landscape
phones (a two-column layout via the `land:` CSS variant) and desktop each get their own fit.
Boards whose fitted cells fall below `ZOOM_BELOW` offer a zoom toggle rather than shipping
untappable cells.

> **Trap:** zoomed, the board frame becomes a real nested scroller — 676px of board inside a
> 369px window on a 10×15 — so it needs `overscroll-contain`. Without it a pan that reaches the
> board's edge chains into the page and scrolls the whole screen out from under the player's
> finger mid-move. Measured on a device: 169px of page movement with `auto`, 0 with `contain`.
> `GameScreen.zoom.test.tsx` asserts the class is present.

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
npm run release:bump     # raise versionCode / versionName before a Play upload
npm run release:android  # signed .aab for Play, signature verified (see RELEASE.md)
npm run store-assets     # Play icon + feature graphic
npm run store-screenshots # screenshots captured from the running app
npm run og-image         # social preview card
```

Android build (run Gradle from **PowerShell** on Windows; `gradlew.bat` fails under Git Bash):

```
npm run build:capacitor && npx cap sync android
cd android && ./gradlew assembleDebug
```

**Two Vite configs, on purpose.** `vite.config.ts` drives the web build: TanStack Start's SSR
pipeline, bundled by nitro for Cloudflare Workers, with `src/server.ts` as the server entry.
`vite.capacitor.config.ts` is a plain client-only build, because Capacitor has no server to run
SSR against. They share `src/` and nothing else, so a change to one is not a change to both.

Plugin order in the web config matters: Tailwind and path resolution, then `tanstackStart` (which
generates the route tree), then nitro on `build` only, then `viteReact` last. The config also
defines `import.meta.env.VITE_*` explicitly — Vite exposes those to the client automatically, but
the nitro server bundle is built separately and does not inherit them.

**Versioning.** `versionName` comes from `package.json`'s `version` — read by `android/app/
build.gradle` with a JSON slurper, and injected into both Vite builds as `__APP_VERSION__` (see
`src/lib/version.ts`), so the store listing, the APK and the version shown in Settings cannot
disagree. `versionCode` is a separate monotonic integer in `android/version.properties`, because
Play needs one and semver cannot provide it. `npm run release:bump` moves both;
`release-wiring.test.ts` fails if either is ever hardcoded back into the gradle file.

**Releasing.** `npm run release:android` builds the signed App Bundle and verifies the signature
before reporting success — an unsigned bundle builds happily and is only rejected in the Console,
after a `versionCode` has been spent. `RELEASE.md` holds the full checklist, the Data safety
answers and the listing copy. Store artwork is generated: `npm run store-assets` composites the
icon from the launcher icon the app actually ships, and `npm run store-screenshots` drives the
real app on a device. Both go to `store/`.

> **Trap:** the screenshot script navigates with the app's own back control, never the hardware
> Back key. One press too many on Home leaves the app, which tears down the WebView and silently
> kills the DevTools connection — the script then exits 0 having captured half its screenshots.

**Privacy policy.** `src/content/privacy.ts` is the single source, rendered by both the `/privacy`
web route (the public URL Play requires) and `PrivacyScreen` in-app (Settings → Support), because
the app is offline-first and an outbound link would be a dead end on a plane. It must describe
what the code actually does: `release-wiring.test.ts` asserts the sync layer only ever writes
`player_data` and that launch never creates an account, so a new network call fails the suite
rather than quietly making the policy false.

**Dependency overrides.** `package.json` pins `uuid` to `^11.1.1` inside `xcode`, which
`@capacitor/cli` depends on. `xcode` asks for `uuid@^7`, which has an unpatched bounds-check
advisory, and npm's own fix was to _downgrade_ Capacitor. The override is safe because `xcode`
only ever calls `uuid.v4()` through CommonJS, and v11 still exports it — verified by resolving
`uuid` from `xcode`'s own module scope and by running `npx cap sync android`. Keep `npm audit` at
zero; if a new advisory appears, prefer an override over downgrading a real dependency, but only
after checking the API the dependent actually uses.

**Social preview.** `public/og-image.png` is generated by `node scripts/make-og-image.mjs`, which
reads the same oklch palette as `styles.css` and draws a board mid-chain. It is a script rather
than a dropped-in binary so it can be regenerated when the palette moves. The card is served from
`public/` deliberately — a third-party CDN URL rots silently and leaks where the project was built.

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
7. **Anything that outlives a move must capture what it describes, not read live state.**
   `commitMove` rotates the turn the instant `animateMove` resolves, but the chain-multiplier
   banner stays up for its 1.2s pop. Reading `currentColor` at render time therefore painted a
   blue player's `x7` in the opponent's red partway through. The banner now carries the mover's
   colour, captured when it is created. The same reasoning applies to any later banner, toast or
   replay overlay.
8. **Don't rewrite pushed history.** The repo is public and has open pull requests; force-pushing,
   rebasing or amending a pushed commit breaks review threads and anyone's checkout.
9. **An explosion may not destroy orbs it did not eject.** Subtract `min(cm, outlets)`, never `cm`.
   The only sanctioned sinks are `dead` tiles and cells sealed in by walls.
10. **Anything that keeps the turn needs a bound.** `keepTurn` with no budget is a soft-lock: the
    opponent never moves again. See `extraPlacementCastUsed`.
11. **`sort(() => Math.random() - 0.5)` is not a shuffle.** Use `shuffled()`.
12. **Every merge must be commutative, including its tie-breaks and its key order.** Two devices
    that disagree write to each other forever. `merge.adversarial.test.ts` fuzzes this over 200
    random pairs and asserts byte-identical results both ways round.

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
