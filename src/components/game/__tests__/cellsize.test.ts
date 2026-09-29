import { describe, expect, it } from "vitest";
import { computeCellSize, isLandscapePhone, ZOOM_BELOW } from "@/game/board-size";

const GAP = 4;
const PAD = 10;

/** The sizing formula as it was before landscape support, kept verbatim as a reference. */
function originalSize(rows: number, cols: number, w: number, h: number) {
  const isDesktop = w >= 1024;
  const sideCols = isDesktop ? 540 : 24;
  const maxW = Math.min(w - sideCols, 1100);
  const maxH = h - 220;
  const byW = Math.floor((maxW - cols * GAP - PAD * 2) / cols);
  const byH = Math.floor((maxH - rows * GAP - PAD * 2) / rows);
  return Math.max(16, Math.min(72, Math.min(byW, byH)));
}

const BOARDS: [number, number][] = [
  [6, 9],
  [8, 12],
  [10, 15],
];

const boardWidth = (cols: number, size: number) => cols * size + (cols - 1) * GAP + PAD * 2;

describe("isLandscapePhone", () => {
  it("is wide-and-short screens below the desktop breakpoint only", () => {
    expect(isLandscapePhone(808, 345)).toBe(true);
    expect(isLandscapePhone(900, 400)).toBe(true);
    expect(isLandscapePhone(393, 760)).toBe(false); // portrait phone
    expect(isLandscapePhone(1280, 800)).toBe(false); // desktop
    expect(isLandscapePhone(1024, 600)).toBe(false); // starts at the desktop layout
    expect(isLandscapePhone(500, 300)).toBe(false); // too narrow for two columns
    expect(isLandscapePhone(700, 700)).toBe(false); // square
  });
});

describe("computeCellSize", () => {
  it("portrait phones and desktops are unchanged from the original formula", () => {
    const viewports: [number, number][] = [
      [360, 640],
      [393, 760],
      [412, 915],
      [768, 1024], // tablet portrait
      [1024, 768],
      [1280, 800],
      [1920, 1080],
    ];
    for (const [w, h] of viewports) {
      for (const [r, c] of BOARDS) {
        expect(computeCellSize(r, c, w, h), `${r}x${c} at ${w}x${h}`).toBe(
          originalSize(r, c, w, h),
        );
      }
    }
  });

  it("landscape phones get much larger cells than the old stacked sizing", () => {
    const now = computeCellSize(6, 9, 808, 345);
    const before = originalSize(6, 9, 808, 345);
    expect(before).toBe(16); // the old bug: postage-stamp board
    expect(now).toBeGreaterThanOrEqual(ZOOM_BELOW);
    expect(now).toBeGreaterThan(before * 1.8);
  });

  it("the board never overflows the width left beside the side panel in landscape", () => {
    for (const [w, h] of [
      [808, 345],
      [915, 412],
      [740, 360],
      [640, 320],
    ] as [number, number][]) {
      for (const [r, c] of BOARDS) {
        const size = computeCellSize(r, c, w, h);
        // 320px is reserved beside the board for the 280px panel column plus gutters
        expect(boardWidth(c, size), `${r}x${c} at ${w}x${h}`).toBeLessThanOrEqual(w - 320);
      }
    }
  });

  it("never returns less than the floor or more than the ceiling, for absurd viewports", () => {
    for (const [w, h] of [
      [1, 1],
      [0, 0],
      [100, 5000],
      [5000, 100],
      [3840, 2160],
    ] as [number, number][]) {
      for (const [r, c] of BOARDS) {
        const s = computeCellSize(r, c, w, h);
        expect(s).toBeGreaterThanOrEqual(16);
        expect(s).toBeLessThanOrEqual(72);
        expect(Number.isInteger(s)).toBe(true);
      }
    }
  });

  it("bigger boards never get bigger cells than smaller ones on the same screen", () => {
    for (const [w, h] of [
      [393, 760],
      [808, 345],
      [1280, 800],
    ] as [number, number][]) {
      const sizes = BOARDS.map(([r, c]) => computeCellSize(r, c, w, h));
      expect(sizes[0]).toBeGreaterThanOrEqual(sizes[1]);
      expect(sizes[1]).toBeGreaterThanOrEqual(sizes[2]);
    }
  });
});
