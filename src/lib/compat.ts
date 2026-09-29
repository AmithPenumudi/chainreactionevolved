/**
 * The UI relies on modern CSS (`oklch()` colours and `color-mix()`, Chrome 111+). Android's
 * System WebView updates through Google Play, but devices without it can be far behind, and an
 * unsupported colour silently renders as nothing — a blank or black screen with no explanation.
 */
export const MIN_CHROME = 111;

type Supports = (property: string, value: string) => boolean;

const REQUIRED_COLOURS = ["oklch(0.6 0.1 200)", "color-mix(in oklab, red 50%, blue)"];

/** True when the browser understands every CSS feature the app depends on. */
export function browserSupportsApp(
  supports: Supports | undefined = typeof CSS !== "undefined" && typeof CSS.supports === "function"
    ? (p, v) => CSS.supports(p, v)
    : undefined,
): boolean {
  if (!supports) return false;
  try {
    return REQUIRED_COLOURS.every((c) => supports("color", c));
  } catch {
    return false;
  }
}

/** Plain-DOM notice (no React, no app CSS) shown instead of a broken UI. */
export function renderUnsupportedNotice(root: HTMLElement): void {
  root.innerHTML = "";
  document.body.style.margin = "0";
  document.body.style.background = "#0b0d12";
  const box = document.createElement("div");
  box.setAttribute("role", "alert");
  box.style.cssText =
    "min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;" +
    "padding:24px;text-align:center;background:#0b0d12;color:#e8ecf3;font-family:sans-serif;";
  const title = document.createElement("h1");
  title.textContent = "Update needed";
  title.style.cssText = "font-size:22px;margin:0 0 12px;";
  const body = document.createElement("p");
  body.textContent =
    "Chain Reaction needs a newer Android System WebView (Chrome " +
    MIN_CHROME +
    " or later) to display correctly. Open Google Play, search for “Android System WebView” " +
    "and tap Update, then reopen the game.";
  body.style.cssText = "max-width:420px;line-height:1.5;margin:0;color:#aab3c5;";
  box.append(title, body);
  root.appendChild(box);
}
