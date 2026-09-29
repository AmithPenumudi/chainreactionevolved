// Standalone client-only build for the Capacitor (Android) shell.
// The main vite.config.ts drives TanStack Start's SSR build for the Cloudflare
// web deploy; that pipeline needs a live server, which Capacitor doesn't have.
// This config instead does a plain client-side React build so `dist-capacitor`
// is a fully static bundle Capacitor can load with no backend.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";

const rootTsconfig = fileURLToPath(new URL("./tsconfig.json", import.meta.url));

export default defineConfig({
  root: "capacitor-src",
  plugins: [tsConfigPaths({ projects: [rootTsconfig] }), tailwindcss(), viteReact()],
  // The AI search runs in a module Web Worker (see src/game/ai-client.ts).
  worker: { format: "es" },
  build: {
    outDir: "../dist-capacitor",
    emptyOutDir: true,
  },
});
