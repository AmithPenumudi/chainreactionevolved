/**
 * Generates public/og-image.png — the social preview card.
 *
 * Kept as a script rather than a committed-and-forgotten binary so the card can be
 * regenerated when the palette changes: it reads the same oklch values as styles.css.
 * Deliberately dependency-free (zlib and Buffer only), so it cannot rot.
 *
 *   node scripts/make-og-image.mjs
 */
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const W = 1200;
const H = 630;

// ---------------------------------------------------------------- colour

/** oklch -> sRGB (0-255). The same values styles.css declares, so the card matches the app. */
function oklch(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return lin.map((c) => {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, v)) * 255);
  });
}

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

// ---------------------------------------------------------------- canvas

const px = new Uint8Array(W * H * 3);
for (let i = 0; i < W * H; i++) {
  px[i * 3] = BG[0];
  px[i * 3 + 1] = BG[1];
  px[i * 3 + 2] = BG[2];
}

function blend(x, y, rgb, alpha) {
  if (alpha <= 0 || x < 0 || y < 0 || x >= W || y >= H) return;
  const a = Math.min(1, alpha);
  const i = (y * W + x) * 3;
  for (let c = 0; c < 3; c++) px[i + c] = Math.round(px[i + c] * (1 - a) + rgb[c] * a);
}

/** Anti-aliased filled circle. */
function disc(cx, cy, r, rgb, alpha = 1) {
  const x0 = Math.floor(cx - r - 1);
  const x1 = Math.ceil(cx + r + 1);
  const y0 = Math.floor(cy - r - 1);
  const y1 = Math.ceil(cy + r + 1);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      // one-pixel feather across the edge
      const cov = Math.min(1, Math.max(0, r + 0.5 - d));
      if (cov > 0) blend(x, y, rgb, cov * alpha);
    }
  }
}

/** Soft radial glow, falling off quadratically. */
function glow(cx, cy, r, rgb, strength) {
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(W - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(H - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r;
      if (d >= 1) continue;
      blend(x, y, rgb, (1 - d) ** 2 * strength);
    }
  }
}

function hLine(x0, x1, y, rgb, alpha) {
  for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) blend(x, y, rgb, alpha);
}
function vLine(x, y0, y1, rgb, alpha) {
  for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++) blend(x, y, rgb, alpha);
}

// ---------------------------------------------------------------- the board

const COLS = 10;
const ROWS = 6;
const CELL = 88;
const BOARD_W = COLS * CELL;
const BOARD_H = ROWS * CELL;
const OX = (W - BOARD_W) / 2;
const OY = (H - BOARD_H) / 2;

// Grid lines, brightest at the centre so the eye lands on the chain.
for (let c = 0; c <= COLS; c++) {
  vLine(Math.round(OX + c * CELL), OY, OY + BOARD_H, GRID, 0.55);
}
for (let r = 0; r <= ROWS; r++) {
  hLine(OX, OX + BOARD_W, Math.round(OY + r * CELL), GRID, 0.55);
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

// Glow underneath everything, so overlapping haloes add up rather than clip.
for (const [c, r, count, player] of CELLS) {
  const cx = OX + c * CELL + CELL / 2;
  const cy = OY + r * CELL + CELL / 2;
  glow(cx, cy, CELL * (0.75 + count * 0.22), PLAYERS[player], 0.1 + count * 0.055);
}

// Orbs, arranged inside the cell the way the game lays them out: 1 centred, 2 side by side,
// 3 in a triangle.
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
  const cx = OX + c * CELL + CELL / 2;
  const cy = OY + r * CELL + CELL / 2;
  const colour = PLAYERS[player];
  const radius = count === 1 ? CELL * 0.2 : count === 2 ? CELL * 0.165 : CELL * 0.145;

  for (const [dx, dy] of LAYOUTS[count - 1]) {
    const ox = cx + dx * CELL;
    const oy = cy + dy * CELL;
    disc(ox, oy, radius * 1.5, colour, 0.22); // halo
    disc(ox, oy, radius, colour, 1); // body
    // Off-centre highlight, the same trick the orb component uses to read as a sphere.
    disc(ox - radius * 0.3, oy - radius * 0.32, radius * 0.34, [255, 255, 255], 0.5);
  }
}

// Vignette: pull the corners down so the board floats.
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const dx = (x - W / 2) / (W / 2);
    const dy = (y - H / 2) / (H / 2);
    const d = Math.min(1, Math.hypot(dx, dy) / 1.25);
    if (d > 0.45) blend(x, y, [0, 0, 0], (d - 0.45) * 0.55);
  }
}

// ---------------------------------------------------------------- PNG

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // colour type: truecolour
// 10-12: compression, filter, interlace — all 0

// Each scanline is prefixed with its filter byte; 0 (None) compresses well enough here.
const raw = Buffer.alloc(H * (W * 3 + 1));
for (let y = 0; y < H; y++) {
  const at = y * (W * 3 + 1);
  raw[at] = 0;
  Buffer.from(px.buffer, y * W * 3, W * 3).copy(raw, at + 1);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const out = fileURLToPath(new URL("../public/og-image.png", import.meta.url));
writeFileSync(out, png);
console.log(`Wrote ${out} (${W}x${H}, ${(png.length / 1024).toFixed(1)} kB)`);
