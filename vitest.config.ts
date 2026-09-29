import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    restoreMocks: true,
    // Component tests replay whole bot turns in fake time; that is slow when the full suite
    // runs in parallel, so the default 5s is far too tight.
    testTimeout: 60_000,
  },
});
