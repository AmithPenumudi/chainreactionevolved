import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  // Both build configs inject this; without it here, anything reading the app version would
  // take its fallback path under test and the real value would never be exercised.
  define: {
    __APP_VERSION__: JSON.stringify(
      JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version,
    ),
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    restoreMocks: true,
    // Component tests replay whole bot turns in fake time; that is slow when the full suite
    // runs in parallel, so the default 5s is far too tight.
    testTimeout: 60_000,
  },
});
