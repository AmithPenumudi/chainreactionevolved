// Standalone client-only build for the Capacitor (Android) shell.
// The main vite.config.ts drives TanStack Start's SSR build for the Cloudflare
// web deploy; that pipeline needs a live server, which Capacitor doesn't have.
// This config instead does a plain client-side React build so `dist-capacitor`
// is a fully static bundle Capacitor can load with no backend.
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";

const rootTsconfig = fileURLToPath(new URL("./tsconfig.json", import.meta.url));

// The same package.json version android/app/build.gradle reads for versionName, so a bug
// report from a player names a release that actually exists.
const appVersion = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
).version;

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  root: "capacitor-src",
  // .env lives at the project root, but envDir defaults to `root` — without this the
  // VITE_SUPABASE_* values are silently absent from the Android bundle and sync no-ops.
  envDir: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [tsConfigPaths({ projects: [rootTsconfig] }), tailwindcss(), viteReact()],
  // The AI search runs in a module Web Worker (see src/game/ai-client.ts).
  worker: { format: "es" },
  build: {
    outDir: "../dist-capacitor",
    emptyOutDir: true,
  },
});
