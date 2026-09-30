import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

/** Every `NAME=value` line in an env file. */
function assignments(file: string) {
  return read(file)
    .split("\n")
    .filter((l) => /^\s*[A-Z_]+\s*=/.test(l))
    .map((l) => {
      const [name, ...rest] = l.split("=");
      return { name: name.trim(), value: rest.join("=").trim() };
    });
}

/*
 * A missing VITE_ variable fails silently — the app just behaves as if no backend were
 * configured — so these guard the wiring rather than the values.
 */
describe("Supabase env wiring", () => {
  it(".env defines both values the client reads", () => {
    const env = read(".env");
    expect(env).toMatch(/^VITE_SUPABASE_URL=\S+/m);
    expect(env).toMatch(/^VITE_SUPABASE_ANON_KEY=\S+/m);
  });

  it("the capacitor build points envDir at the project root", () => {
    // Its `root` is capacitor-src/, and Vite resolves .env relative to `root` unless told
    // otherwise. Without envDir the Android bundle ships with no credentials at all and sync
    // silently does nothing.
    expect(read("vite.capacitor.config.ts")).toContain("envDir");
  });

  it("never commits a real service_role key — it bypasses row-level security", () => {
    // Checks assignments and value shapes, not prose: .env explains in a comment why the
    // service key is absent, and .env.local.example legitimately names the variable.
    const looksSecret = (v: string) => /^sb_secret_/.test(v) || /^eyJ[\w-]+\./.test(v);

    expect(assignments(".env").filter((a) => /SERVICE|SECRET/i.test(a.name))).toEqual([]);
    for (const file of [".env", ".env.local.example"]) {
      if (!existsSync(resolve(root, file))) continue;
      const leaked = assignments(file).filter((a) => looksSecret(a.value));
      expect(
        leaked.map((a) => a.name),
        `${file} contains a live secret`,
      ).toEqual([]);
    }
    // The file that does hold it must stay out of git.
    expect(read(".gitignore")).toMatch(/^\.env\.local$/m);
  });

  it("the client reads exactly the names .env defines", () => {
    const client = read("src/game/sync/client.ts");
    expect(client).toContain("VITE_SUPABASE_URL");
    expect(client).toContain("VITE_SUPABASE_ANON_KEY");
  });
});
