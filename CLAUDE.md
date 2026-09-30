# Chain Reaction: Evolved

Turn-based grid game. Android (Capacitor) is the primary target; the same `src/` also builds
for web as a Cloudflare Worker.

**Read `ARCHITECTURE.md` first** — it is the map of the codebase and the reasoning behind it.
`TESTING.md` covers the test layers and the device workflow.

## Ground rules

- **Keep `ARCHITECTURE.md` current, in the same commit as the change.** This is a standing
  instruction from the project owner, not a nicety. If a change adds a module, alters a
  decision, introduces a trap, or moves something off the "deliberately not built yet" list,
  the doc changes with it. When finishing any non-trivial task, check the doc before
  committing and say whether it needed updating.

- **`src/game/*` stays pure** — no React, no DOM, no network. That is what makes the engine
  fuzz-testable and lets the AI run in a Web Worker.
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
```

On Windows, run Gradle from PowerShell — `gradlew.bat` fails under Git Bash.

## Gotchas that have bitten before

- Large heredocs in the shell often fail; prefer writing files directly.
- Python edits on Windows turn LF into CRLF and flood prettier with errors — open with
  `newline=''` and normalise, then run prettier on just the touched files.
- Never run `prettier --write src` wholesale; it reformats unrelated files.
