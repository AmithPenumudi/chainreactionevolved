import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getRouter } from "@/router";
import { routeTree } from "@/routeTree.gen";

const root = process.cwd();
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

/*
 * The Android entry must not render the root route's document shell.
 *
 * The web build is server-rendered and hydrates the whole document, so its root route renders
 * <html>/<head>/<body> via `shellComponent`. The Android build is client-only and mounts into
 * the <div id="root"> that capacitor-src/index.html already provides.
 *
 * Rendering the shell in both places froze the first closed-testing build solid: React 19 adopts
 * the real <html>/<body> as singletons and binds its delegated listeners to the document, while
 * the root container stays that <div>. React's event dispatch walks between the two forever,
 * pinning the renderer at 100% CPU on the very first tap — with no exception and nothing in
 * logcat. See the trap in ARCHITECTURE.md.
 *
 * jsdom renders the shell quite happily, so there is no component test that would catch this.
 * These assertions guard the wiring itself.
 */

describe("the Android entry opts out of the document shell", () => {
  it("passes documentShell: false when building its router", () => {
    const main = read("capacitor-src/main.tsx");
    expect(main).toMatch(/getRouter\(\s*\{[^}]*documentShell:\s*false/);
  });

  it("mounts into the #root div that index.html provides", () => {
    // Mounting at `document` instead would be the other way to keep the containers in step, but
    // it is not what this entry does — if that ever changes, the assertion above must change too.
    expect(read("capacitor-src/main.tsx")).toMatch(/getElementById\("root"\)/);
    expect(read("capacitor-src/index.html")).toMatch(/id="root"/);
  });

  it("strips shellComponent from the root route when asked, and keeps it by default", () => {
    type ShellOption = { shellComponent?: unknown };
    const options = routeTree.options as ShellOption;
    // getRouter mutates the route tree, which is a module singleton — put it back afterwards so
    // this test cannot change the outcome of anything that runs after it.
    const original = options.shellComponent;
    try {
      // Default (the web build): the shell has to survive, or SSR emits no <html> at all.
      getRouter();
      expect(options.shellComponent).toBeTypeOf("function");

      getRouter({ documentShell: false });
      expect(options.shellComponent).toBeUndefined();
    } finally {
      options.shellComponent = original;
    }
  });
});

describe("the root route still defines a document shell for the web build", () => {
  it("renders html, head and body", () => {
    const rootRoute = read("src/routes/__root.tsx");
    expect(rootRoute).toMatch(/shellComponent:/);
    for (const tag of ["<html", "<head>", "<body>"]) {
      expect(rootRoute).toContain(tag);
    }
  });
});
