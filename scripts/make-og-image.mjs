/**
 * Generates public/og-image.png — the social preview card.
 *
 * Kept as a script rather than a committed-and-forgotten binary so the card can be regenerated
 * when the palette changes: it reads the same oklch values as styles.css.
 *
 *   npm run og-image
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Canvas, encodePNG, oklch } from "./lib/png.mjs";

const W = 1200;
const H = 630;

const BG = oklch(0.16, 0.01, 260);
const GRID = oklch(0.26, 0.015, 260);
const PLAYERS = [
  oklch(0.68, 0.19, 245), // blue
  oklch(0.64, 0.22, 27), // red
  oklch(0.76, 0.19, 145), // green
  oklch(0.66, 0.2, 305), // violet
  oklch(0.76, 0.17, 60), // orange
  oklch(0.8, 0.14, 200), // cyan
  oklch(0.74, 0.18, 350), // pink
  oklch(0.86, 0.16, 95), // yellow
];

const canvas = new Canvas(W, H, BG);

// ---------------------------------------------------------------- the board

const COLS = 10;
const ROWS = 6;
const CELL = 88;
const OX = (W - COLS * CELL) / 2;
const OY = (H - ROWS * CELL) / 2;

for (let c = 0; c <= COLS; c++) {
  canvas.vLine(Math.round(OX + c * CELL), OY, OY + ROWS * CELL, GRID, 0.55);
}
for (let r = 0; r <= ROWS; r++) {
  canvas.hLine(OX, OX + COLS * CELL, Math.round(OY + r * CELL), GRID, 0.55);
}

/**
 * A chain caught mid-reaction: a dense core, orbs thinning outward, a few cells already
 * flipped to other players. Hand-placed rather than random so the card is stable.
 * [col, row, count, player]
 */
const CELLS = [
  [4, 2, 3, 0],
  [5, 2, 3, 0],
  [4, 3, 3, 0],
  [5, 3, 2, 0],
  [3, 2, 2, 5],
  [6, 3, 2, 5],
  [3, 3, 1, 5],
  [6, 2, 1, 2],
  [2, 1, 2, 1],
  [7, 4, 2, 1],
  [2, 4, 1, 3],
  [7, 1, 1, 3],
  [1, 2, 1, 4],
  [8, 3, 1, 4],
  [5, 1, 1, 0],
  [4, 4, 1, 0],
  [1, 4, 1, 7],
  [8, 1, 1, 6],
  [0, 3, 1, 6],
  [9, 2, 1, 7],
];

const centre = (c, r) => [OX + c * CELL + CELL / 2, OY + r * CELL + CELL / 2];

// Glow underneath everything, so overlapping haloes add up rather than clip.
for (const [c, r, count, player] of CELLS) {
  const [cx, cy] = centre(c, r);
  canvas.glow(cx, cy, CELL * (0.75 + count * 0.22), PLAYERS[player], 0.1 + count * 0.055);
}

// Orbs, arranged inside the cell the way the game lays them out.
const LAYOUTS = [
  [[0, 0]],
  [
    [-0.19, 0],
    [0.19, 0],
  ],
  [
    [0, -0.2],
    [-0.19, 0.14],
    [0.19, 0.14],
  ],
];

for (const [c, r, count, player] of CELLS) {
  const [cx, cy] = centre(c, r);
  const colour = PLAYERS[player];
  const radius = count === 1 ? CELL * 0.2 : count === 2 ? CELL * 0.165 : CELL * 0.145;

  for (const [dx, dy] of LAYOUTS[count - 1]) {
    const ox = cx + dx * CELL;
    const oy = cy + dy * CELL;
    canvas.disc(ox, oy, radius * 1.5, colour, 0.22); // halo
    canvas.disc(ox, oy, radius, colour, 1); // body
    // Off-centre highlight, the same trick the orb component uses to read as a sphere.
    canvas.disc(ox - radius * 0.3, oy - radius * 0.32, radius * 0.34, [255, 255, 255], 0.5);
  }
}

canvas.vignette();

const out = fileURLToPath(new URL("../public/og-image.png", import.meta.url));
const png = encodePNG(canvas);
writeFileSync(out, png);
console.log(`Wrote ${out} (${W}x${H}, ${(png.length / 1024).toFixed(1)} kB)`);
