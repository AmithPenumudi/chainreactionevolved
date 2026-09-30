# Chain Reaction: Evolved

A turn-based grid strategy game. Place orbs on a board; when a cell exceeds its capacity it
explodes into its neighbours, capturing them and often setting off a chain. Last player with
orbs on the board wins.

Android is the primary target — a Capacitor shell around a static client build. The same `src/`
also builds for the web as a Cloudflare Worker.

**Three modes:** Classic, Abilities (energy and castable powers), and Arena (special tiles).
Plus 30 hand-built puzzles, daily challenges, and offline bot opponents.

## Documentation

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — how the codebase fits together, the decisions behind
  it, and the traps worth knowing before changing things. Read this first.
- **[TESTING.md](TESTING.md)** — the test layers, and the device smoke test.
- **[RELEASE.md](RELEASE.md)** — shipping to Google Play: the signed bundle, store assets,
  Data safety answers and the pre-upload checklist.

## Development

Requires Node.js 24+ and npm.

```sh
npm install
npm run dev
```

The dev server runs on port 8080.

### Commands

| Command                   | What it does                               |
| ------------------------- | ------------------------------------------ |
| `npm run dev`             | Dev server (web)                           |
| `npm run build`           | Web build for Cloudflare Workers           |
| `npm run build:capacitor` | Static client bundle for Android           |
| `npm test`                | Full test suite                            |
| `npm run lint`            | ESLint                                     |
| `npm run test:android`    | Smoke test against a running device        |
| `npm run dashboard`       | Internal metrics (`-- --demo` for samples) |
| `npm run release:android` | Signed `.aab` for Play (see RELEASE.md)    |

## Android

```sh
npm run build:capacitor
npx cap sync android
cd android && ./gradlew assembleDebug
```

- **Windows:** run Gradle from PowerShell (`.\gradlew.bat assembleDebug`) with `JAVA_HOME`
  pointing at JDK 21. `gradlew.bat` does not work from Git Bash.
- **Old devices:** the UI needs a WebView of Chrome 111+ (`oklch()` / `color-mix()`). The app
  shows an "update Android System WebView" screen instead of a blank page when it is older.

## Built with

TanStack Start · React 19 · TypeScript · Tailwind CSS · Capacitor · Supabase · Vite
