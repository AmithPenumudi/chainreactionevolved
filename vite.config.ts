// Web build: TanStack Start (SSR) bundled by nitro for Cloudflare Workers.
// The Android build is a separate, client-only config — see vite.capacitor.config.ts.
//
// Plugin order matters: tailwind and path resolution first, then tanstackStart
// (which generates the route tree), then nitro, and viteReact last.
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { defineConfig, loadEnv, type PluginOption } from "vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";

const srcDir = fileURLToPath(new URL("./src", import.meta.url));
const rootTsconfig = fileURLToPath(new URL("./tsconfig.json", import.meta.url));

export default defineConfig(async ({ command, mode }) => {
  const plugins: PluginOption[] = [
    tailwindcss(),
    tsConfigPaths({ projects: [rootTsconfig] }),
    tanstackStart({
      // Redirect TanStack Start's bundled server entry to src/server.ts, our SSR
      // error wrapper. nitro builds the Worker from this.
      server: { entry: "server" },
    }),
  ];

  // nitro is a build-only concern; `vite dev` serves through TanStack Start itself.
  if (command === "build") {
    const { nitro } = await import("nitro/vite");
    plugins.push(
      nitro({
        preset: "cloudflare-module",
        output: { dir: "dist", serverDir: "dist/server", publicDir: "dist/client" },
        cloudflare: {
          nodeCompat: true,
          deployConfig: true,
          // Without an explicit name nitro derives one from the git remote — "owner-repo",
          // which put the owner's personal name in the public URL. The deployed address is
          // https://<this name>.<account subdomain>.workers.dev, and it is also the privacy
          // policy URL given to Play, so it should read as the game and nothing else.
          wrangler: { name: "chainreactionevolved" },
        },
      }),
    );
  }

  plugins.push(viteReact());

  // Vite exposes VITE_* on the client automatically, but the nitro server bundle is
  // built separately and does not inherit that. Defining them explicitly keeps the
  // Supabase credentials present on both sides. (The Android bundle solves the same
  // problem with `envDir` — see vite.capacitor.config.ts.)
  const define: Record<string, string> = {
    // Matches the Android versionName — see vite.capacitor.config.ts.
    __APP_VERSION__: JSON.stringify(
      JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version,
    ),
  };
  for (const [key, value] of Object.entries(loadEnv(mode, process.cwd(), "VITE_"))) {
    define[`import.meta.env.${key}`] = JSON.stringify(value);
  }

  return {
    plugins,
    define,
    resolve: {
      alias: { "@": srcDir },
      // A second copy of React or the query client breaks hooks and context at runtime.
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },
    server: { host: "::", port: 8080 },
  };
});
