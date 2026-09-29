import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MIN_CHROME } from "../compat";

const html = readFileSync(resolve(process.cwd(), "capacitor-src/index.html"), "utf8");

/** The guard is the only classic (non-module) inline script in the page. */
function guardSource(): string {
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("compatibility guard script not found in capacitor-src/index.html");
  return m[1];
}

function runGuard() {
  new Function(guardSource())();
}

let root: HTMLDivElement;

beforeEach(() => {
  root = document.createElement("div");
  root.id = "root";
  document.body.appendChild(root);
  delete (window as unknown as { __crSupported?: boolean }).__crSupported;
});

afterEach(() => {
  root.remove();
  vi.unstubAllGlobals();
});

const supported = () => (window as unknown as { __crSupported?: boolean }).__crSupported;

describe("index.html compatibility guard", () => {
  it("runs before the app bundle and is a classic script, not a module", () => {
    const guardAt = html.indexOf("<script>");
    const bundleAt = html.indexOf('type="module"');
    expect(guardAt).toBeGreaterThan(-1);
    expect(bundleAt).toBeGreaterThan(guardAt);
  });

  it("is plain ES5: no arrow functions, let/const, template strings or optional chaining", () => {
    // strip the string literals (the feature probe intentionally contains modern syntax in one)
    const code = guardSource()
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/'(?:[^'\\]|\\.)*'/g, "''")
      .replace(/\/\/.*$/gm, "");
    for (const bad of [/=>/, /\blet\b/, /\bconst\b/, /`/, /\?\./, /\?\?/, /\bclass\b/]) {
      expect(code, `guard must not use ${bad}`).not.toMatch(bad);
    }
  });

  it("leaves the page alone when the browser supports everything", () => {
    vi.stubGlobal("CSS", { supports: () => true });
    root.innerHTML = "<p>app</p>";
    runGuard();
    expect(supported()).toBe(true);
    expect(root.innerHTML).toBe("<p>app</p>");
  });

  it("shows the update notice when oklch() is not supported", () => {
    vi.stubGlobal("CSS", { supports: (_p: string, v: string) => !v.startsWith("oklch") });
    runGuard();
    expect(supported()).toBe(false);
    expect(root.textContent).toContain("Update needed");
    expect(root.textContent).toContain("Android System WebView");
    expect(root.textContent).toContain(String(MIN_CHROME));
    expect(root.querySelector("[role='alert']")).not.toBeNull();
    // no default white page margin around the dark notice
    expect(document.body.style.margin).toBe("0px");
    expect(document.body.style.background).not.toBe("");
  });

  it("shows the update notice when color-mix() is not supported", () => {
    vi.stubGlobal("CSS", { supports: (_p: string, v: string) => !v.startsWith("color-mix") });
    runGuard();
    expect(supported()).toBe(false);
    expect(root.textContent).toContain("Update needed");
  });

  it("shows the update notice when CSS.supports does not exist at all (very old WebView)", () => {
    vi.stubGlobal("CSS", undefined);
    runGuard();
    expect(supported()).toBe(false);
    expect(root.textContent).toContain("Update needed");
  });

  it("does not throw if CSS.supports itself throws", () => {
    vi.stubGlobal("CSS", {
      supports: () => {
        throw new Error("nope");
      },
    });
    expect(() => runGuard()).not.toThrow();
    expect(supported()).toBe(false);
  });

  it("uses the same wording and version as the React-side notice", () => {
    expect(html).toContain(`Chrome ${MIN_CHROME} or later`);
    expect(html).toContain("Update needed");
  });
});
