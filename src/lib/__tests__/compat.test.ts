import { describe, expect, it } from "vitest";
import { browserSupportsApp, MIN_CHROME, renderUnsupportedNotice } from "../compat";

describe("browserSupportsApp", () => {
  it("is true only when every required colour feature is supported", () => {
    expect(browserSupportsApp(() => true)).toBe(true);
  });

  it("is false when oklch() is unsupported (Chrome < 111)", () => {
    expect(browserSupportsApp((_p, v) => !v.startsWith("oklch"))).toBe(false);
  });

  it("is false when color-mix() is unsupported", () => {
    expect(browserSupportsApp((_p, v) => !v.startsWith("color-mix"))).toBe(false);
  });

  it("is false when CSS.supports itself throws", () => {
    expect(
      browserSupportsApp(() => {
        throw new Error("boom");
      }),
    ).toBe(false);
  });

  it("checks the colour property, not an unrelated one", () => {
    const seen: string[] = [];
    browserSupportsApp((p) => {
      seen.push(p);
      return true;
    });
    expect(new Set(seen)).toEqual(new Set(["color"]));
  });
});

describe("renderUnsupportedNotice", () => {
  it("replaces the root's contents with a readable, accessible message (no app CSS needed)", () => {
    const root = document.createElement("div");
    root.innerHTML = "<p>old</p>";
    renderUnsupportedNotice(root);
    expect(root.querySelector("p")?.textContent).toContain("WebView");
    expect(root.textContent).toContain(String(MIN_CHROME));
    expect(root.textContent).not.toContain("old");
    expect(root.querySelector("[role='alert']")).not.toBeNull();
    expect(root.querySelector("h1")?.textContent).toBe("Update needed");
  });
});
