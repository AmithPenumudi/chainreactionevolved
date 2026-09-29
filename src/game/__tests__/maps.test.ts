import { describe, it, expect } from "vitest";
import { ARENA_MAPS, getArenaMap, type ArenaMapId } from "../arena-maps";
import {
  buildChaosBoard,
  canIncrement,
  chaosLimits,
  clampChaosConfig,
  defaultChaosConfig,
  randomChaosConfig,
  specialCellCount,
  type ChaosConfig,
} from "../chaos-grid";
import type { BoardState, TileKind } from "../engine";

const SIZES: [number, number][] = [
  [6, 9],
  [8, 12],
  [10, 15],
];
const KEYS: (keyof ChaosConfig)[] = [
  "portalPairs",
  "amplifiers",
  "powerTiles",
  "walls",
  "reactors",
  "deadZones",
];
const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function count(b: BoardState, tile: TileKind) {
  return b.cells.filter((c) => c.tile === tile).length;
}

/** All non-wall cells reachable orthogonally from one another. */
function connected(b: BoardState) {
  const open = b.cells.map((c) => c.tile !== "wall");
  const start = open.indexOf(true);
  if (start < 0) return false;
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length) {
    const i = stack.pop()!;
    const r = Math.floor(i / b.cols);
    const c = i % b.cols;
    for (const [dr, dc] of DIRS) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nc < 0 || nr >= b.rows || nc >= b.cols) continue;
      const n = nr * b.cols + nc;
      if (open[n] && !seen.has(n)) {
        seen.add(n);
        stack.push(n);
      }
    }
  }
  return seen.size === open.filter(Boolean).length;
}

const empty = (): ChaosConfig => ({
  portalPairs: 0,
  amplifiers: 0,
  powerTiles: 0,
  walls: 0,
  reactors: 0,
  deadZones: 0,
});

describe("arena maps", () => {
  it("ids are unique and getArenaMap falls back safely", () => {
    expect(new Set(ARENA_MAPS.map((m) => m.id)).size).toBe(ARENA_MAPS.length);
    expect(getArenaMap("nope" as ArenaMapId)).toBe(ARENA_MAPS[0]);
  });

  for (const map of ARENA_MAPS) {
    describe(map.label, () => {
      const b = map.build();

      it("declared size matches the built board", () => {
        expect(b.rows).toBe(map.rows);
        expect(b.cols).toBe(map.cols);
        expect(b.cells).toHaveLength(map.rows * map.cols);
      });

      it("starts empty and build() returns a fresh board every time", () => {
        expect(b.cells.every((c) => c.orbs === 0 && c.owner === null)).toBe(true);
        const a = map.build();
        a.cells[0].orbs = 9;
        expect(map.build().cells[0].orbs).toBe(0);
      });

      it("every portal has exactly one partner with the same pair id", () => {
        const byId = new Map<number, number>();
        for (const c of b.cells) {
          if (c.tile === "portal") {
            expect(c.portalPairId, "portal without a pair id").toBeDefined();
            byId.set(c.portalPairId!, (byId.get(c.portalPairId!) ?? 0) + 1);
          } else {
            expect(c.portalPairId, "pair id on a non-portal").toBeUndefined();
          }
        }
        for (const [id, n] of byId) expect(n, `pair ${id}`).toBe(2);
      });

      it("is 180° rotationally symmetric (fair for both sides)", () => {
        for (let r = 0; r < b.rows; r++) {
          for (let c = 0; c < b.cols; c++) {
            const a = b.cells[r * b.cols + c];
            const m = b.cells[(b.rows - 1 - r) * b.cols + (b.cols - 1 - c)];
            expect(m.tile, `(${r},${c})`).toBe(a.tile);
          }
        }
      });

      it("has no sealed-off regions and leaves plenty of playable cells", () => {
        expect(connected(b)).toBe(true);
        const playable = b.cells.filter((c) => c.tile !== "wall" && c.tile !== "dead").length;
        expect(playable).toBeGreaterThan(b.cells.length * 0.6);
      });
    });
  }
});

describe("chaos grid — limits and clamping", () => {
  it("limits scale with board size and never go below 1", () => {
    for (const [r, c] of SIZES) {
      const l = chaosLimits(r, c);
      for (const k of KEYS) expect(l[k]).toBeGreaterThanOrEqual(1);
      expect(l.maxSpecialCells).toBe(Math.floor(r * c * 0.33));
    }
  });

  it("clamp handles negatives, fractions and overshoot", () => {
    const cfg: ChaosConfig = {
      portalPairs: -5,
      amplifiers: 999,
      powerTiles: 2.6,
      walls: 999,
      reactors: 999,
      deadZones: 999,
    };
    for (const [r, c] of SIZES) {
      const out = clampChaosConfig(cfg, r, c);
      const lim = chaosLimits(r, c);
      expect(out.portalPairs).toBe(0);
      expect(specialCellCount(out)).toBeLessThanOrEqual(lim.maxSpecialCells);
      for (const k of KEYS) {
        expect(out[k]).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(out[k])).toBe(true);
        expect(out[k]).toBeLessThanOrEqual(lim[k]);
      }
    }
  });

  it("clamp is idempotent", () => {
    for (const [r, c] of SIZES) {
      const once = clampChaosConfig(randomChaosConfig(r, c), r, c);
      expect(clampChaosConfig(once, r, c)).toEqual(once);
    }
  });

  it("default config is valid and non-empty", () => {
    for (const [r, c] of SIZES) {
      const d = defaultChaosConfig(r, c);
      expect(clampChaosConfig(d, r, c)).toEqual(d);
      expect(specialCellCount(d)).toBeGreaterThan(0);
    }
  });

  it("incrementing while canIncrement holds never breaks a limit", () => {
    for (const [r, c] of SIZES) {
      let cfg = empty();
      let progressed = true;
      while (progressed) {
        progressed = false;
        for (const k of KEYS) {
          if (canIncrement(cfg, k, r, c)) {
            cfg = { ...cfg, [k]: cfg[k] + 1 };
            progressed = true;
          }
        }
      }
      expect(specialCellCount(cfg)).toBeLessThanOrEqual(chaosLimits(r, c).maxSpecialCells);
      expect(clampChaosConfig(cfg, r, c)).toEqual(cfg);
    }
  });

  it("random configs from many seeds are always valid", () => {
    for (let i = 0; i < 200; i++) {
      const [r, c] = SIZES[i % 3];
      let s = i + 1;
      const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
      const cfg = randomChaosConfig(r, c, rnd);
      expect(clampChaosConfig(cfg, r, c)).toEqual(cfg);
    }
  });
});

describe("chaos grid — generation", () => {
  it("is deterministic per seed and differs across seeds", () => {
    const cfg = defaultChaosConfig(8, 12);
    const a = buildChaosBoard(8, 12, cfg, 42);
    expect(buildChaosBoard(8, 12, cfg, 42)).toEqual(a);
    expect(buildChaosBoard(8, 12, cfg, 43)).not.toEqual(a);
  });

  it("places exactly the requested quantity of every tile, with valid portal pairs", () => {
    for (const [r, c] of SIZES) {
      for (let seed = 1; seed <= 25; seed++) {
        let s = seed;
        const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
        const cfg = randomChaosConfig(r, c, rnd);
        const b = buildChaosBoard(r, c, cfg, seed);
        expect(count(b, "wall")).toBe(cfg.walls);
        expect(count(b, "dead")).toBe(cfg.deadZones);
        expect(count(b, "amplifier")).toBe(cfg.amplifiers);
        expect(count(b, "reactor")).toBe(cfg.reactors);
        expect(count(b, "power")).toBe(cfg.powerTiles);
        expect(count(b, "portal")).toBe(cfg.portalPairs * 2);
        const pairs = new Map<number, number>();
        for (const x of b.cells)
          if (x.tile === "portal")
            pairs.set(x.portalPairId!, (pairs.get(x.portalPairId!) ?? 0) + 1);
        expect([...pairs.values()].every((n) => n === 2)).toBe(true);
        expect(connected(b), `${r}x${c} seed ${seed}: walls isolate a region`).toBe(true);
      }
    }
  });

  it("an all-zero config yields a plain empty board", () => {
    const b = buildChaosBoard(8, 12, empty(), 7);
    expect(b.cells.every((c) => c.tile === undefined)).toBe(true);
  });

  it("maximum-density configs still produce a playable, connected board", () => {
    for (const [r, c] of SIZES) {
      const max = clampChaosConfig(
        { portalPairs: 99, amplifiers: 99, powerTiles: 99, walls: 99, reactors: 99, deadZones: 99 },
        r,
        c,
      );
      for (let seed = 1; seed <= 10; seed++) {
        const b = buildChaosBoard(r, c, max, seed);
        expect(b.cells).toHaveLength(r * c);
        expect(connected(b)).toBe(true);
        expect(b.cells.some((x) => x.tile !== "wall" && x.tile !== "dead")).toBe(true);
      }
    }
  });

  it("survives extreme seeds (0, negative, huge, fractional, NaN)", () => {
    const cfg = defaultChaosConfig(8, 12);
    for (const seed of [0, -1, 2 ** 31, 2 ** 53, 1.5, NaN]) {
      expect(buildChaosBoard(8, 12, cfg, seed).cells).toHaveLength(96);
    }
  });
});
