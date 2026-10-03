# Chain Reaction: Evolved

Turn-based grid game. Android (Capacitor) is the primary target; the same `src/` also builds
for web as a Cloudflare Worker.

**Read `ARCHITECTURE.md` first** — it is the map of the codebase and the reasoning behind it.
`TESTING.md` covers the test layers and the device workflow, and `RELEASE.md` covers shipping to
Play: the signed bundle, store assets, the Data safety answers and the live privacy policy URL.

## Ground rules

- **Keep `ARCHITECTURE.md` current, in the same commit as the change.** This is a standing
  instruction from the project owner, not a nicety. If a change adds a module, alters a
  decision, introduces a trap, or moves something off the "deliberately not built yet" list,
  the doc changes with it. When finishing any non-trivial task, check the doc before
  committing and say whether it needed updating.

- **`src/game/*` stays pure** — no React, no DOM, no network. That is what makes the engine
  fuzz-testable and lets the AI run in a Web Worker.
- **An explosion may only lose the orbs it actually throws out.** Subtract
  `min(cm, outlets x orbsPerNeighbour)`, never `cm` — critical mass and the number of outlets are
  different numbers once `fortified`, an owned `reactor` or the floor at 2 is involved. The only
  sanctioned sinks are `dead` tiles and cells sealed in by walls. Fortify used to eat an orb on
  every explosion and a 1xN board lost one per explosion.
- **Anything that keeps the turn needs a bound.** `keepTurn` with no budget is not a combo, it is a
  soft-lock: an owed Double Drop plus free ability casts held the turn for 50 consecutive casts
  with energy pinned at 100, and the opponent never moved again.
- **A decided game means `winner` _or_ `draw`.** Checking only `winner` left a drawn board — every
  remaining player wiped out by one Sudden Death shrink — still accepting placements.
- **Every merge in `src/game/sync/merge.ts` must be commutative, including its tie-breaks and its
  key order.** Two devices that disagree overwrite each other forever. Period-scoped data
  (`claimed`, daily/weekly progress) must also be dropped when a side is on an older period — a
  claim carried across a rollover makes the repeated challenge id permanently unclaimable.
- **Never use CSS relative colour syntax** (`oklch(from ...)`). Android WebViews are often older
  than Chrome 119. Use `lighten` / `darken` / `withAlpha` from `src/game/colors.ts`. When this
  broke, every orb rendered black while every test still passed.
- **Never force-push or amend pushed commits.** The repo is public with open pull requests;
  rewriting pushed history breaks review threads and anyone's checkout.
- **No third-party branding or credits** anywhere in the codebase, docs, commit messages or
  metadata — no build-tool attribution, no co-author trailers, no vendor marketing. This is the
  owner's project and it carries only their name.
- **Verify against a build or a device, not just the suite.** The credentials-missing bug and the
  black-orb bug both passed every unit test. `npm run test:android` drives the real app.

## Commands

```bash
npm test                 # full suite (~3 min)
npm run lint
npm run build:capacitor  # Android web assets
npm run test:android     # smoke test on a running emulator/device
npm run dashboard        # internal metrics (-- --demo for sample data)
npm run release:android  # signed .aab for Play, signature verified
npm run build            # web build, then: npx wrangler --cwd dist/ deploy
```

On Windows, run Gradle from PowerShell — `gradlew.bat` fails under Git Bash.

## Gotchas that have bitten before

- Large heredocs in the shell often fail; prefer writing files directly.
- Python edits on Windows turn LF into CRLF and flood prettier with errors — open with
  `newline=''` and normalise, then run prettier on just the touched files.
- Never run `prettier --write src` wholesale; it reformats unrelated files.
- A capped cascade's `chainCount` describes an oscillation, not a chain anyone built. Use
  `MoveResult.truncated` before reporting it as a stat. `resolveExplosions` exits early once the
  board is provably unsettleable — over `settleCapacity()` with no sink, or a repeated board state —
  so don't reintroduce a path that grinds `maxIters` full-board scans to learn the same thing.
- `sort(() => Math.random() - 0.5)` is not a shuffle; the comparator is inconsistent and the result
  stays near the input order. Use `shuffled()` in `ai.ts`.
- Game logic belongs in `src/game/`, not in a React effect. `forfeitTurnWithShrink` and
  `passTurnUntilPlayable` were moved out of `GameScreen` so they could be tested directly.
- `forfeitTurn` must advance `turn`: EMP locks expire against an absolute turn number, and the
  Sudden Death shrink is scheduled off the same counter.
- Bot decisions use `Math.random`. Seed it (`vi.spyOn(Math, "random")`) in any AI test, or the
  failure is a flake nobody can reproduce.
- **Never assert a wall-clock budget in a unit test.** Vitest runs files in parallel and the
  machine is never idle, so the assertion measures contention. `expect(ms).toBeLessThan(1500)`
  failed at 2271ms with an emulator running and passed in isolation on the same commit;
  calibrating the budget against `applyMove` was no better (8,700 equivalents in isolation,
  21,274 in the suite). Assert something deterministic and leave responsiveness to
  `npm run test:android`, which measures it on a device. Heavy fuzz tests need an explicit
  generous timeout — the four-bot arena test takes ~54s alone and timed out against the 60s
  default whenever anything else was running.
- **Deploy the web build with `wrangler` directly, not `nitro deploy`.** nitro runs wrangler
  through `execSync`, which mangles its interactive prompts — a subdomain prompt came back as
  garbled echo and aborted the deploy twice. Use `npx wrangler --cwd dist/ deploy`.
- **The worker's `compatibility_date` is pinned in `vite.config.ts`, not taken from the clock.**
  nitro stamps the build machine's _local_ date, and Cloudflare rejects anything it considers
  future-dated (`10021`) — from IST that is every build before 05:30. It also decides runtime
  semantics, so it should not drift per build or per timezone.
- **The workers.dev subdomain is permanent.** Cloudflare binds one per account, once; the API
  refuses a change with `10036`. Only a custom domain can improve the public URL now.
