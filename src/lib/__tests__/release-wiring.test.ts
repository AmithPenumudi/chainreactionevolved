import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_VERSION } from "../version";
import { PRIVACY_CONTACT, PRIVACY_SECTIONS } from "@/content/privacy";

const root = process.cwd();
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

/*
 * Play-release wiring. None of this is exercised by playing the game, and every failure mode
 * here surfaces only in the Play Console — after an upload, which costs a versionCode that can
 * never be reused. So it is guarded here instead.
 */

describe("version plumbing", () => {
  const pkg = JSON.parse(read("package.json")) as { version: string };

  it("the app reports the same version package.json declares", () => {
    // Injected by every Vite config. If the define is dropped, APP_VERSION silently becomes
    // "unknown" and every bug report loses the one field that makes it actionable.
    expect(APP_VERSION).toBe(pkg.version);
    expect(APP_VERSION).not.toBe("unknown");
  });

  it("package.json carries a plain x.y.z version", () => {
    // release-bump.mjs and the gradle versionName both assume this shape.
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("android takes versionName from package.json rather than hardcoding it", () => {
    const gradle = read("android/app/build.gradle");
    expect(gradle).toContain("versionName appVersionName");
    expect(gradle).toMatch(/parse\(rootProject\.file\('\.\.\/package\.json'\)\)/);
    // The Capacitor template ships `versionName "1.0"`; if that ever comes back, the store
    // listing and the in-app version drift apart without anything failing.
    expect(gradle).not.toMatch(/versionName\s+"/);
  });

  it("android takes versionCode from version.properties, and it is a positive integer", () => {
    const gradle = read("android/app/build.gradle");
    expect(gradle).toContain("versionCode appVersionCode");
    expect(gradle).not.toMatch(/versionCode\s+\d/);

    const code = /^versionCode=(\d+)$/m.exec(read("android/version.properties"))?.[1];
    expect(code).toBeDefined();
    expect(Number(code)).toBeGreaterThan(0);
  });
});

describe("privacy policy", () => {
  it("is reachable both in the app and on the web", () => {
    // Play needs a public URL; a player offline needs the in-app copy. Both render the same
    // source, so neither may quietly lose it.
    expect(read("src/routes/privacy.tsx")).toContain("PRIVACY_SECTIONS");
    expect(read("src/components/game/PrivacyScreen.tsx")).toContain("PRIVACY_SECTIONS");
    expect(read("src/components/game/SettingsScreen.tsx")).toContain("onPrivacy");
  });

  it("has content in every section and a contact address", () => {
    expect(PRIVACY_SECTIONS.length).toBeGreaterThan(4);
    for (const section of PRIVACY_SECTIONS) {
      expect(section.heading.trim()).not.toBe("");
      expect(section.body.length + (section.bullets?.length ?? 0)).toBeGreaterThan(0);
      for (const text of [...section.body, ...(section.bullets ?? [])]) {
        expect(text.trim()).not.toBe("");
      }
    }
    expect(PRIVACY_CONTACT).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);
  });

  it("states the things the Data safety form is answered against", () => {
    // These are commitments, not decoration: each one is an answer given in the Play Console.
    // If the game ever starts doing one of them, this test should fail and force the policy,
    // the form and the code back into agreement.
    const all = PRIVACY_SECTIONS.flatMap((s) => [...s.body, ...(s.bullets ?? [])])
      .join(" ")
      .toLowerCase();
    expect(all).toContain("anonymous");
    expect(all).toContain("no ads");
    expect(all).toContain("row-level security");
    expect(all).toContain("supabase");
    // Deletion route, required by Play for any app that stores user data off-device.
    expect(all).toContain("delet");
  });
});

describe("what the game actually sends", () => {
  it("only writes the tables the policy describes", () => {
    // The policy says progress is uploaded and nothing else. If a new `.from("…")` appears,
    // this fails and the policy must be revisited before release.
    const sync = read("src/game/sync/sync.ts");
    const tables = [...sync.matchAll(/\.from\("([^"]+)"\)/g)].map((m) => m[1]);
    expect([...new Set(tables)]).toEqual(["player_data"]);
  });

  it("does not create an account merely because the app was opened", () => {
    // syncIfSignedIn runs at launch and must never call ensureUserId; an account created on
    // first launch would make the "nothing leaves your device until you finish a match"
    // sentence in the policy false.
    const sync = read("src/game/sync/sync.ts");
    const launch = /export async function syncIfSignedIn[\s\S]*?\n}/.exec(sync)?.[0] ?? "";
    expect(launch).toContain("currentUserId");
    expect(launch).not.toContain("ensureUserId");
  });
});
