/**
 * Generates the Play Console listing artwork into store/.
 *
 *   npm run store-assets
 *
 *   icon-512.png             512x512, 32-bit PNG   — the store icon
 *   feature-graphic.png     1024x500               — the banner at the top of the listing
 *
 * The icon is composited from the launcher icon the app actually ships, not redrawn by hand:
 * Play expects the store icon to be the same mark players see on their home screen, and two
 * hand-drawn "matching" icons drift the moment either is touched.
 *
 * Screenshots are NOT generated here — those come off a real device via
 * `node scripts/capture-screenshots.mjs`, because a screenshot should show the actual game.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Canvas, decodePNG, encodePNG, hex, oklch } from "./lib/png.mjs";

const root = new URL("..", import.meta.url);
const storeDir = fileURLToPath(new URL("store/", root));
mkdirSync(storeDir, { recursive: true });

// The adaptive icon's own background colour, from res/values/ic_launcher_background.xml.
const ICON_BG = hex("#0B0D12");
const BG = oklch(0.16, 0.01, 260);
const GRID = oklch(0.26, 0.015, 260);
const PLAYERS = [
  oklch(0.68, 0.19, 245),
  oklch(0.64, 0.22, 27),
  oklch(0.76, 0.19, 145),
  oklch(0.66, 0.2, 305),
  oklch(0.76, 0.17, 60),
  oklch(0.8, 0.14, 200),
  oklch(0.74, 0.18, 350),
  oklch(0.86, 0.16, 95),
];

/** The highest-density launcher foreground — the mark, already drawn for the safe zone. */
const foreground = decodePNG(
  readFileSync(
    fileURLToPath(
      new URL("android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png", root),
    ),
  ),
);

function write(name, canvas, options) {
  const png = encodePNG(canvas, options);
  writeFileSync(fileURLToPath(new URL(name, `file://${storeDir.replace(/\\/g, "/")}/`)), png);
  console.log(
    `  ${name.padEnd(22)} ${canvas.width}x${canvas.height}  ${(png.length / 1024).toFixed(1)} kB`,
  );
}

/**
 * Draws the launcher mark the way Android composites an adaptive icon: the foreground is a
 * 108dp square of which only the central 72dp is ever visible, so it is drawn 108/72 = 1.5x
 * oversized and centre-cropped. Anything else would show the mark smaller than it looks on a
 * home screen.
 */
function drawMark(canvas, cx, cy, visibleSize) {
  const full = visibleSize * (108 / 72);
  canvas.drawImage(foreground, Math.round(cx - full / 2), Math.round(cy - full / 2), full, full);
}

// ---------------------------------------------------------------- store icon

const icon = new Canvas(512, 512, ICON_BG);
drawMark(icon, 256, 256, 512);
// Play applies its own rounded mask, so the artwork stays a full square.
write("icon-512.png", icon, { alpha: true });

// ---------------------------------------------------------------- feature graphic

const FW = 1024;
const FH = 500;
const feature = new Canvas(FW, FH, BG);

// A board that runs off both edges, so the graphic reads as a window onto a larger game.
const CELL = 100;
const COLS = Math.ceil(FW / CELL) + 1;
const ROWS = Math.ceil(FH / CELL) + 1;
const OX = (FW - COLS * CELL) / 2;
const OY = (FH - ROWS * CELL) / 2;

for (let c = 0; c <= COLS; c++) {
  feature.vLine(Math.round(OX + c * CELL), 0, FH - 1, GRID, 0.5);
}
for (let r = 0; r <= ROWS; r++) {
  feature.hLine(0, FW - 1, Math.round(OY + r * CELL), GRID, 0.5);
}

/**
 * Orbs spreading outward from behind the mark, as two chains closing in from either side.
 * [col, row, count, player]
 *
 * The grid is oversized so its lines run off every edge, which means the outermost row and
 * column are only partly on canvas: with CELL=100 on 1024x500, only rows 1-4 and columns 1-10
 * have their centres far enough inside to hold an orb without clipping it. Columns 4-6 are left
 * empty so the mark stays the focal point.
 */
const CELLS = [
  [1, 2, 3, 0],
  [2, 2, 2, 0],
  [1, 3, 2, 0],
  [2, 1, 1, 5],
  [1, 1, 1, 5],
  [3, 1, 1, 1],
  [2, 3, 1, 1],
  [3, 4, 1, 6],
  [8, 2, 3, 2],
  [7, 2, 2, 2],
  [8, 3, 2, 2],
  [9, 2, 1, 4],
  [7, 1, 1, 4],
  [9, 4, 1, 7],
  [10, 3, 1, 3],
  [8, 1, 1, 6],
];

const centre = (c, r) => [OX + c * CELL + CELL / 2, OY + r * CELL + CELL / 2];

for (const [c, r, count, player] of CELLS) {
  const [cx, cy] = centre(c, r);
  feature.glow(cx, cy, CELL * (0.8 + count * 0.25), PLAYERS[player], 0.11 + count * 0.05);
}

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
  const radius = count === 1 ? CELL * 0.19 : count === 2 ? CELL * 0.16 : CELL * 0.14;
  for (const [dx, dy] of LAYOUTS[count - 1]) {
    const ox = cx + dx * CELL;
    const oy = cy + dy * CELL;
    feature.disc(ox, oy, radius * 1.5, colour, 0.22);
    feature.disc(ox, oy, radius, colour, 1);
    feature.disc(ox - radius * 0.3, oy - radius * 0.32, radius * 0.34, [255, 255, 255], 0.5);
  }
}

// Darken behind the mark so it separates from the board without a hard edge.
feature.glow(FW / 2, FH / 2, 300, [0, 0, 0], 0.75);
drawMark(feature, FW / 2, FH / 2, 300);

feature.vignette(0.4, 0.6);
write("feature-graphic.png", feature);

console.log(`\nWrote to ${storeDir}`);
