import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const css = readFileSync(resolve(root, "src/styles.css"), "utf8");

/** Every source file that could pull a font (or anything else) from a third-party host. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      sourceFiles(p, out);
    } else if (/\.(tsx?|css|html)$/.test(name) && !name.endsWith(".gen.ts")) {
      out.push(p);
    }
  }
  return out;
}

describe("bundled fonts", () => {
  it("the app makes no requests to Google Fonts (it must work offline)", () => {
    const files = [...sourceFiles(resolve(root, "src")), resolve(root, "capacitor-src/index.html")];
    const offenders = files.filter((f) =>
      /fonts\.(googleapis|gstatic)\.com/.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("declares Inter with @font-face rules that point at files that exist", () => {
    const urls = [...css.matchAll(/@font-face\s*{[^}]*?url\("([^"]+)"\)/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThanOrEqual(1);
    for (const u of urls) {
      const file = resolve(root, "src", u);
      expect(existsSync(file), `${u} missing`).toBe(true);
    }
    expect(css).toMatch(/font-family:\s*"Inter"/);
  });

  it("font files are real WOFF2 binaries of a sane size", () => {
    const dir = resolve(root, "src/assets/fonts");
    const fonts = readdirSync(dir).filter((f) => f.endsWith(".woff2"));
    expect(fonts.length).toBeGreaterThanOrEqual(1);
    for (const f of fonts) {
      const buf = readFileSync(join(dir, f));
      expect(buf.subarray(0, 4).toString("latin1"), `${f} is not WOFF2`).toBe("wOF2");
      expect(buf.length).toBeGreaterThan(10_000);
      expect(buf.length).toBeLessThan(400_000);
    }
  });

  it("uses font-display: swap so text never stays invisible while a font loads", () => {
    const faces = css.match(/@font-face\s*{[^}]*}/g) ?? [];
    expect(faces.length).toBeGreaterThan(0);
    for (const face of faces) expect(face).toContain("font-display: swap");
  });

  it("ships the font licence alongside the files", () => {
    expect(existsSync(resolve(root, "src/assets/fonts/LICENSE.txt"))).toBe(true);
    expect(readFileSync(resolve(root, "src/assets/fonts/LICENSE.txt"), "utf8")).toContain(
      "Open Font License",
    );
  });

  it("the CSS font stacks still fall back to system fonts", () => {
    expect(css).toMatch(/--font-sans:\s*"Inter",\s*system-ui/);
  });
});
