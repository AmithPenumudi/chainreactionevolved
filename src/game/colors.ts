export const PLAYER_COLOR_VARS = [
  "var(--p1)",
  "var(--p2)",
  "var(--p3)",
  "var(--p4)",
  "var(--p5)",
  "var(--p6)",
  "var(--p7)",
  "var(--p8)",
];

export const PLAYER_COLOR_NAMES = [
  "Electric Blue",
  "Neon Red",
  "Plasma Green",
  "Violet",
  "Orange",
  "Cyan",
  "Pink",
  "Yellow",
];

// Distinct symbols for accessibility (non-color differentiation)
export const PLAYER_SYMBOLS = ["◆", "▲", "●", "■", "★", "✚", "◼", "⬢"];

export function colorFor(colorIndex: number): string {
  return PLAYER_COLOR_VARS[colorIndex % PLAYER_COLOR_VARS.length];
}

/*
 * Shading helpers. These use `color-mix()` (Chrome 111+) instead of CSS relative colour
 * syntax (`oklch(from ...)`, Chrome 119+): older Android WebViews drop relative colours
 * entirely, which left every orb black and every player badge invisible.
 */

/** Mixes `pct`% white into the colour. */
export function lighten(color: string, pct: number): string {
  return `color-mix(in oklab, ${color} ${100 - pct}%, white)`;
}

/** Mixes `pct`% black into the colour. */
export function darken(color: string, pct: number): string {
  return `color-mix(in oklab, ${color} ${100 - pct}%, black)`;
}

/** The colour at the given opacity (0..1). */
export function withAlpha(color: string, alpha: number): string {
  return `color-mix(in oklab, ${color} ${Math.round(alpha * 100)}%, transparent)`;
}
