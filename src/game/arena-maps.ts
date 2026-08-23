import { BoardState, Cell, makeBoard, TileKind } from "./engine";

export type ArenaMapId = "standard" | "portal" | "fortress" | "power-grid" | "chaos";

export interface ArenaMapDef {
  id: ArenaMapId;
  label: string;
  desc: string;
  rows: number;
  cols: number;
  build: () => BoardState;
  available: boolean;
}

/**
 * Builder helper. `set` places a tile at (r,c); `mirror` places the same tile at
 * (r,c) and at its 180°-rotational counterpart so every layout is perfectly fair.
 */
function builder(rows: number, cols: number) {
  const board = makeBoard(rows, cols);
  const set = (r: number, c: number, tile: TileKind, portalPairId?: number) => {
    if (r < 0 || c < 0 || r >= rows || c >= cols) return;
    const cell: Cell = board.cells[r * cols + c];
    cell.tile = tile;
    if (portalPairId !== undefined) cell.portalPairId = portalPairId;
  };
  const mirror = (r: number, c: number, tile: TileKind, portalPairId?: number) => {
    set(r, c, tile, portalPairId);
    set(rows - 1 - r, cols - 1 - c, tile, portalPairId);
  };
  /** Places a portal pair: (r,c) and its mirrored counterpart share one pair id. */
  const portalPair = (r: number, c: number, id: number) => mirror(r, c, "portal", id);
  return { board, set, mirror, portalPair };
}

/** Standard Arena: 8×12 symmetrical layout with a small, balanced set of special tiles. */
function buildStandard(): BoardState {
  const { board, set, mirror, portalPair } = builder(8, 12);
  // One central amplifier (single, balanced — sits between the two power tiles).
  set(3, 5, "amplifier");
  // Two power tiles, mirrored across the board center.
  mirror(2, 3, "power");
  // Walls: four, mirrored, forming light chokepoints without isolating regions.
  mirror(3, 2, "wall");
  mirror(2, 7, "wall");
  // One portal pair on opposite edges — lets chains jump across the board.
  portalPair(0, 5, 1);
  return board;
}

/** Portal Arena: 8×12 with three portal pairs for long-distance chain reactions. */
function buildPortal(): BoardState {
  const { board, mirror, portalPair } = builder(8, 12);
  // Three portal pairs spread across corners, edges and the mid-lanes.
  portalPair(1, 1, 1);
  portalPair(0, 8, 2);
  portalPair(4, 3, 3);
  // Light walls so portals are the natural route between halves.
  mirror(3, 6, "wall");
  mirror(2, 5, "wall");
  // A single power tile per side to reward holding a portal mouth.
  mirror(6, 2, "power");
  return board;
}

/** Fortress: wall-heavy 8×12 with defensive pockets and narrow chokepoints. */
function buildFortress(): BoardState {
  const { board, mirror, portalPair } = builder(8, 12);
  // Two mirrored fortress walls with a one-cell gate in each.
  for (const r of [1, 2, 3]) mirror(r, 3, "wall");
  // gate at (4,3) intentionally left open by not mirroring r=4
  for (const r of [0, 1]) mirror(r, 8, "wall");
  // Central bunker: a hollow wall ring around a power tile.
  mirror(3, 5, "wall");
  mirror(2, 6, "wall");
  mirror(3, 6, "power");
  // Corner strongpoints — walls make adjacent cells explode sooner.
  mirror(6, 1, "wall");
  mirror(7, 4, "wall");
  // Collapsed corners — permanently unclaimable, denying the cheapest strongholds.
  mirror(0, 0, "dead");
  // One portal pair so the fortresses are never fully sealed.
  portalPair(5, 0, 1);
  return board;
}

/** Power Grid: 10×15, dense power tiles and amplifiers for aggressive play. */
function buildPowerGrid(): BoardState {
  const { board, set, mirror } = builder(10, 15);
  // Power tiles on a repeating lattice (mirrored, so counts stay even).
  for (const [r, c] of [
    [1, 2],
    [1, 6],
    [3, 4],
    [3, 10],
    [5, 1],
    [4, 8],
  ] as const) {
    mirror(r, c, "power");
  }
  // Amplifiers punctuating the lattice.
  set(4, 7, "amplifier");
  mirror(2, 9, "amplifier");
  mirror(6, 3, "amplifier");
  // A single Reactor at the heart of the grid — high risk, high payoff.
  mirror(1, 11, "reactor");
  // A few walls to stop the whole board from cascading at once.
  mirror(0, 4, "wall");
  mirror(4, 12, "wall");
  mirror(7, 6, "wall");
  return board;
}

/** Chaos Grid: 10×15 party layout — every mechanic, densely packed. */
function buildChaos(): BoardState {
  const { board, set, mirror, portalPair } = builder(10, 15);
  // Portals everywhere.
  portalPair(0, 0, 1);
  portalPair(2, 11, 2);
  portalPair(5, 4, 3);
  portalPair(8, 2, 4);
  // Amplifier cluster around the centre.
  set(4, 7, "amplifier");
  mirror(3, 5, "amplifier");
  mirror(6, 10, "amplifier");
  mirror(1, 8, "amplifier");
  // Scattered power tiles.
  mirror(2, 2, "power");
  mirror(7, 12, "power");
  mirror(2, 5, "power");
  // A Reactor pair for high-value, high-risk holdouts.
  mirror(5, 10, "reactor");
  // Dead zones — pockets that swallow orbs for good.
  mirror(1, 6, "dead");
  // Jagged wall debris.
  for (const [r, c] of [
    [1, 4],
    [3, 9],
    [4, 2],
    [6, 6],
    [8, 13],
    [7, 1],
  ] as const) {
    mirror(r, c, "wall");
  }
  return board;
}

export const ARENA_MAPS: ArenaMapDef[] = [
  {
    id: "standard",
    label: "Standard Arena",
    desc: "Balanced walls, one portal pair, two power tiles and a central amplifier.",
    rows: 8,
    cols: 12,
    build: buildStandard,
    available: true,
  },
  {
    id: "portal",
    label: "Portal Arena",
    desc: "Three portal pairs — chains teleport across the board.",
    rows: 8,
    cols: 12,
    build: buildPortal,
    available: true,
  },
  {
    id: "fortress",
    label: "Fortress",
    desc: "Wall-heavy map with gated strongholds, a central bunker, tight chokepoints and two collapsed dead-zone corners.",
    rows: 8,
    cols: 12,
    build: buildFortress,
    available: true,
  },
  {
    id: "power-grid",
    label: "Power Grid",
    desc: "Large board packed with power tiles and amplifiers, plus a Reactor pair — relentless pressure.",
    rows: 10,
    cols: 15,
    build: buildPowerGrid,
    available: true,
  },
  {
    id: "chaos",
    label: "Chaos Grid",
    desc: "Everything at once: four portal pairs, amplifier clusters, power tiles, a Reactor, dead zones and debris.",
    rows: 10,
    cols: 15,
    build: buildChaos,
    available: true,
  },
];

export function getArenaMap(id: ArenaMapId): ArenaMapDef {
  return ARENA_MAPS.find((m) => m.id === id) ?? ARENA_MAPS[0];
}
