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
