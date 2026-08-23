import { BoardState, Cell, makeBoard } from "./engine";

export interface ChaosConfig {
  portalPairs: number;
  amplifiers: number;
  powerTiles: number;
  walls: number;
  reactors: number;
  deadZones: number;
}

export interface ChaosLimits {
  portalPairs: number;
  amplifiers: number;
  powerTiles: number;
  walls: number;
  reactors: number;
  deadZones: number;
  maxSpecialCells: number;
}

/** Number of special cells a config occupies (a portal pair = 2 cells). */
export function specialCellCount(cfg: ChaosConfig): number {
  return (
    cfg.portalPairs * 2 + cfg.amplifiers + cfg.powerTiles + cfg.walls + cfg.reactors + cfg.deadZones
  );
}

/** Per-type and total limits, scaled from the 8×12 reference board. */
export function chaosLimits(rows: number, cols: number): ChaosLimits {
  const cells = rows * cols;
  const k = cells / 96; // 8 × 12 reference
  const s = (n: number) => Math.max(1, Math.round(n * k));
  return {
    portalPairs: s(4),
    amplifiers: s(6),
    powerTiles: s(8),
    walls: s(12),
    reactors: s(3),
    deadZones: s(5),
    maxSpecialCells: Math.floor(cells * 0.33),
  };
}

export function defaultChaosConfig(rows: number, cols: number): ChaosConfig {
  const k = (rows * cols) / 96;
  const s = (n: number) => Math.max(0, Math.round(n * k));
  const lim = chaosLimits(rows, cols);
  return clampChaosConfig(
    {
      portalPairs: Math.min(s(2), lim.portalPairs),
      amplifiers: Math.min(s(2), lim.amplifiers),
      powerTiles: Math.min(s(3), lim.powerTiles),
      walls: Math.min(s(6), lim.walls),
      reactors: Math.min(s(1), lim.reactors),
      deadZones: Math.min(s(2), lim.deadZones),
    },
    rows,
    cols,
  );
}

export function clampChaosConfig(cfg: ChaosConfig, rows: number, cols: number): ChaosConfig {
  const lim = chaosLimits(rows, cols);
  const out: ChaosConfig = {
    portalPairs: Math.max(0, Math.min(lim.portalPairs, Math.round(cfg.portalPairs))),
    amplifiers: Math.max(0, Math.min(lim.amplifiers, Math.round(cfg.amplifiers))),
    powerTiles: Math.max(0, Math.min(lim.powerTiles, Math.round(cfg.powerTiles))),
    walls: Math.max(0, Math.min(lim.walls, Math.round(cfg.walls))),
    reactors: Math.max(0, Math.min(lim.reactors, Math.round(cfg.reactors ?? 0))),
    deadZones: Math.max(0, Math.min(lim.deadZones, Math.round(cfg.deadZones ?? 0))),
  };
  // Trim (in reverse priority) until the total budget is respected.
  const order: (keyof ChaosConfig)[] = ["deadZones", "walls", "reactors", "powerTiles", "amplifiers", "portalPairs"];
  for (const key of order) {
    while (specialCellCount(out) > lim.maxSpecialCells && out[key] > 0) out[key] -= 1;
  }
  return out;
}

/** Can we add one more of this type without breaking any limit? */
export function canIncrement(cfg: ChaosConfig, key: keyof ChaosConfig, rows: number, cols: number) {
  const lim = chaosLimits(rows, cols);
  if (cfg[key] >= lim[key]) return false;
  const cost = key === "portalPairs" ? 2 : 1;
  return specialCellCount(cfg) + cost <= lim.maxSpecialCells;
}

// ---------------------------------------------------------------- randomness

/** Small deterministic PRNG so a given seed always rebuilds the same board. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed() {
  return Math.floor(Math.random() * 2 ** 31);
}

export function randomChaosConfig(rows: number, cols: number, rnd: () => number = Math.random): ChaosConfig {
  const lim = chaosLimits(rows, cols);
  const pick = (max: number) => Math.floor(rnd() * (max + 1));
  return clampChaosConfig(
    {
      portalPairs: pick(lim.portalPairs),
      amplifiers: pick(lim.amplifiers),
      powerTiles: pick(lim.powerTiles),
      walls: pick(lim.walls),
      reactors: pick(lim.reactors),
      deadZones: pick(lim.deadZones),
    },
    rows,
    cols,
  );
}

// ---------------------------------------------------------------- generation

/** Every non-wall cell must be reachable through orthogonal non-wall steps. */
function noIsolatedRegions(walls: Set<number>, rows: number, cols: number) {
  const total = rows * cols;
  let start = -1;
  for (let i = 0; i < total; i++) {
    if (!walls.has(i)) {
      start = i;
      break;
    }
  }
  if (start < 0) return false;
  const seen = new Set<number>([start]);
  const queue = [start];
  while (queue.length) {
    const idx = queue.pop()!;
    const r = Math.floor(idx / cols);
    const c = idx % cols;
    for (const [dr, dc] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
      const n = nr * cols + nc;
      if (walls.has(n) || seen.has(n)) continue;
      seen.add(n);
      queue.push(n);
    }
  }
  return seen.size === total - walls.size;
}

/** Spread check: no board quadrant may hold more than ~55% of the special tiles. */
function reasonablySpread(indices: number[], rows: number, cols: number) {
  if (indices.length < 4) return true;
  const counts = [0, 0, 0, 0];
  for (const i of indices) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const q = (r < rows / 2 ? 0 : 2) + (c < cols / 2 ? 0 : 1);
    counts[q]++;
  }
  return Math.max(...counts) <= Math.ceil(indices.length * 0.55);
}

/**
 * Builds a Chaos Grid board containing exactly the requested tile quantities.
 * Retries until the layout passes connectivity / distribution validation.
 */
export function buildChaosBoard(rows: number, cols: number, cfg: ChaosConfig, seed: number): BoardState {
  const total = rows * cols;
  const config = clampChaosConfig(cfg, rows, cols);
  const needed = specialCellCount(config);

  for (let attempt = 0; attempt < 400; attempt++) {
    const rnd = mulberry32(seed + attempt * 7919);
    const pool = Array.from({ length: total }, (_, i) => i);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const chosen = pool.slice(0, needed);
    if (chosen.length < needed) break;

    let k = 0;
    const walls = new Set<number>();
    for (let i = 0; i < config.walls; i++) walls.add(chosen[k++]);
    const deadZones = chosen.slice(k, (k += config.deadZones));
    const amplifiers = chosen.slice(k, (k += config.amplifiers));
    const reactors = chosen.slice(k, (k += config.reactors));
    const powers = chosen.slice(k, (k += config.powerTiles));
    const portals = chosen.slice(k, (k += config.portalPairs * 2));

    if (!noIsolatedRegions(walls, rows, cols)) continue;
    if (!reasonablySpread(chosen, rows, cols)) continue;

    const board = makeBoard(rows, cols);
    const at = (idx: number): Cell => board.cells[idx];
    walls.forEach((idx) => (at(idx).tile = "wall"));
    deadZones.forEach((idx) => (at(idx).tile = "dead"));
    amplifiers.forEach((idx) => (at(idx).tile = "amplifier"));
    reactors.forEach((idx) => (at(idx).tile = "reactor"));
    powers.forEach((idx) => (at(idx).tile = "power"));
    for (let p = 0; p < config.portalPairs; p++) {
      const a = at(portals[p * 2]);
      const b = at(portals[p * 2 + 1]);
      a.tile = "portal";
      b.tile = "portal";
      a.portalPairId = p + 1;
      b.portalPairId = p + 1;
    }
    return board;
  }

  // Fallback: an empty board is always playable.
  return makeBoard(rows, cols);
}
