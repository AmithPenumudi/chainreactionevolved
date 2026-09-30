# Welcome to your Lovable project

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Open your project in the [Lovable editor](https://lovable.dev) and keep building.

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: connect the project to GitHub and every change made in Lovable is committed straight to your repository.
- **Full ownership**: this code is yours. Push to your repository and your changes sync back into Lovable, ready for your next prompt.

## Documentation

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — how the codebase fits together, the decisions behind
  it, and the traps worth knowing before changing things.
- **[TESTING.md](TESTING.md)** — the test layers, and the device smoke test.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS

## Android

The Android app is a Capacitor shell around a static client build. See `TESTING.md`
for the full checklist.

```
npm run build:capacitor
npx cap sync android
cd android && ./gradlew assembleDebug
```

- **Windows:** run Gradle from PowerShell (`.\gradlew.bat assembleDebug`) with `JAVA_HOME`
  pointing at JDK 21. `gradlew.bat` does not work from Git Bash.
- **Old devices:** the UI needs a WebView of Chrome 111+ (`oklch()` / `color-mix()`). The app
  shows an "update Android System WebView" screen instead of a blank page when it is older.
