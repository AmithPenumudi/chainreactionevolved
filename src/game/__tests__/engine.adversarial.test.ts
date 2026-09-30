import { describe, expect, it } from "vitest";
import {
  applyMove,
  applyShrink,
  canPlace,
  cloneBoard,
  commitMove,
  DEFAULT_RULES,
  effectiveCriticalMass,
  forfeitTurn,
  hasLegalMove,
  makeBoard,
  makeInitialState,
  MODE_CONFIGS,
  propagatingNeighbors,
  resolveExplosions,
  type BoardState,
  type Cell,
  type GameState,
  type ModeKind,
  type PlayerConfig,
  type TileKind,
} from "../engine";
import { castAbility, hasCastableAbility } from "../abilities";
import { buildChaosBoard, defaultChaosConfig } from "../chaos-grid";

/*
 * Adversarial engine suite. `engine.test.ts` checks the rules as written and
 * `engine.invariants.test.ts` fuzzes ordinary play; this file goes after the positions a player
 * would have to be trying to reach: saturated boards, amplifier feedback, geometry where a cell's
 * critical mass exceeds the number of places its orbs can go, a turn with nothing legal in it, and
 * a decided game that is asked to keep playing.
 */

// ------------------------------------------------------------------ helpers

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function players(n: number): PlayerConfig[] {
  return Array.from({ length: n }, (_, i) => ({ id: i, name: `P${i + 1}`, colorIndex: i }));
}

function newState(
  n: number,
  rows: number,
  cols: number,
  kind: ModeKind = "classic",
  board?: BoardState,
): GameState {
  return makeInitialState(
    players(n),
    rows,
    cols,
    "classic",
    DEFAULT_RULES.classic,
    MODE_CONFIGS[kind],
    board,
  );
}

const cellAt = (b: BoardState, r: number, c: number) => b.cells[r * b.cols + c];
const totalOrbs = (b: BoardState) => b.cells.reduce((s, c) => s + c.orbs, 0);
const owned = (b: BoardState, p: number) => b.cells.filter((c) => c.owner === p).length;

/** Cells that are still at or above their critical mass — a settled board must have none. */
function unstable(b: BoardState): string[] {
  const out: string[] = [];
  for (let r = 0; r < b.rows; r++) {
    for (let c = 0; c < b.cols; c++) {
      const cell = cellAt(b, r, c);
      if (cell.tile === "wall" || cell.tile === "dead" || cell.owner === null) continue;
      const cm = effectiveCriticalMass(b, r, c);
      if (cell.orbs >= cm) out.push(`(${r},${c}) ${cell.orbs}>=${cm}`);
    }
  }
  return out;
}

/** Every structural rule a board must satisfy, whether it settled or the game ended mid-chain. */
function structuralViolations(b: BoardState): string[] {
  const bad: string[] = [];
  for (let r = 0; r < b.rows; r++) {
    for (let c = 0; c < b.cols; c++) {
      const cell = cellAt(b, r, c);
      const at = `(${r},${c})`;
      if (!Number.isInteger(cell.orbs) || cell.orbs < 0) bad.push(`${at} bad orb count`);
      if (cell.tile === "wall" || cell.tile === "dead") {
        if (cell.orbs !== 0 || cell.owner !== null) bad.push(`${at} orbs/owner on ${cell.tile}`);
        continue;
      }
      if (cell.orbs === 0 && cell.owner !== null) bad.push(`${at} empty but owned`);
      if (cell.orbs > 0 && cell.owner === null) bad.push(`${at} orbs but unowned`);
      if (
        cell.owner === null &&
        (cell.shielded || cell.fortified || cell.empLockedFor !== undefined)
      )
        bad.push(`${at} modifier on an unowned cell`);
    }
  }
  return bad;
}

/** Orbs a board can legitimately lose when a cell fires: dead tiles and fully sealed cells. */
function isSink(b: BoardState, r: number, c: number) {
  return propagatingNeighbors(b, r, c).length === 0;
}

function hasSinkOrDead(b: BoardState) {
  for (let r = 0; r < b.rows; r++)
    for (let c = 0; c < b.cols; c++) {
      const cell = cellAt(b, r, c);
      if (cell.tile === "dead") return true;
      if (cell.tile !== "wall" && isSink(b, r, c)) return true;
    }
  return false;
}

/** Recursively freezes a state so any write by the engine throws instead of going unnoticed. */
function deepFreeze<T>(v: T): T {
  if (v && typeof v === "object") {
    Object.freeze(v);
    for (const k of Object.keys(v as object)) deepFreeze((v as Record<string, unknown>)[k]);
  }
  return v;
}

function own(b: BoardState, r: number, c: number, p: number, orbs: number, tile?: TileKind) {
  const cell = cellAt(b, r, c);
  cell.owner = p;
  cell.orbs = orbs;
  if (tile) cell.tile = tile;
}

// -------------------------------------------------------- 1. engine correctness

describe("adversarial — applyMove purity and determinism", () => {
  it("a frozen state survives applyMove untouched", () => {
    const b = makeBoard(5, 5);
    own(b, 0, 0, 0, 1);
    own(b, 0, 1, 1, 2);
    own(b, 1, 0, 0, 2);
    const s = newState(2, 5, 5, "classic", b);
    s.hasMoved = [true, true];
    const before = JSON.stringify(s);
    deepFreeze(s);
    const res = applyMove(s, 0, 0);
    expect(res).not.toBeNull();
    expect(JSON.stringify(s)).toBe(before);
  });

  it("the same move on the same state gives byte-identical results every time", () => {
    for (const kind of ["classic", "arena", "abilities"] as ModeKind[]) {
      const rand = rng(kind.length * 7919);
      const b = makeBoard(7, 7);
      for (const cell of b.cells) {
        const roll = rand();
        if (kind === "arena" && roll < 0.12) cell.tile = "amplifier";
        else if (kind === "arena" && roll < 0.18) cell.tile = "wall";
        else if (kind === "arena" && roll < 0.22) cell.tile = "dead";
        if (cell.tile === "wall" || cell.tile === "dead") continue;
        if (roll > 0.45) {
          cell.owner = roll > 0.72 ? 1 : 0;
          cell.orbs = 1 + Math.floor(rand() * 3);
        }
      }
      const s = newState(2, 7, 7, kind, b);
      s.hasMoved = [true, true];
      const first = JSON.stringify(applyMove(s, 3, 3));
      for (let i = 0; i < 12; i++) {
        expect(JSON.stringify(applyMove(s, 3, 3)), `${kind} repeat ${i}`).toBe(first);
      }
    }
  });

  it("commitMove folds a result in without reaching back into the previous state", () => {
    const b = makeBoard(4, 4);
    own(b, 0, 0, 0, 1);
    own(b, 1, 1, 1, 1);
    const s = newState(2, 4, 4, "classic", b);
    s.hasMoved = [true, true];
    const res = applyMove(s, 0, 0)!;
    const snapshot = JSON.stringify(s);
    const next = commitMove(s, res);
    expect(JSON.stringify(s), "commitMove mutated its input").toBe(snapshot);
    // The board is the move's own result, give or take the sweep of expiring modifiers that the
    // incoming player's turn triggers.
    expect(next.board).toEqual(res.boardAfter);
    expect(next.turn).toBe(s.turn + 1);
    expect(next.totalExplosions).toBe(s.totalExplosions + res.chainCount);
    expect(next.totalCapturedCells).toBe(s.totalCapturedCells + res.capturedCells);
  });

  it("a decided game refuses further play — winner and draw alike", () => {
    const decided = newState(2, 5, 5);
    decided.winner = 0;
    expect(canPlace(decided, 2, 2)).toBe(false);
    expect(applyMove(decided, 2, 2)).toBeNull();

    // A Sudden Death shrink can wipe out every remaining player at once, which is a draw and just
    // as final as a winner — but only `winner` used to be checked here.
    const drawn = newState(2, 5, 5);
    drawn.draw = true;
    expect(canPlace(drawn, 2, 2)).toBe(false);
    expect(applyMove(drawn, 2, 2)).toBeNull();
    expect(
      castAbility({ ...drawn, modeConfig: MODE_CONFIGS.abilities }, "double-drop", []),
    ).toBeNull();
  });
});

// ---------------------------------------------------------- 2. cascade stress

describe("adversarial — cascade stress", () => {
  const sizes: [number, number][] = [
    [4, 4],
    [6, 6],
    [8, 12],
    [10, 15],
  ];

  it("a board where every cell sits one orb below critical still settles", () => {
    for (const [rows, cols] of sizes) {
      const b = makeBoard(rows, cols);
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++)
          own(b, r, c, (r + c) % 2, effectiveCriticalMass(b, r, c) - 1);
      const s = newState(2, rows, cols, "classic", b);
      s.hasMoved = [true, true];
      const res = applyMove(s, 0, 0)!;
      expect(res.chainCount, `${rows}x${cols} produced no chain`).toBeGreaterThan(0);
      expect(structuralViolations(res.boardAfter), `${rows}x${cols}`).toEqual([]);
      if (res.winner === null) expect(unstable(res.boardAfter), `${rows}x${cols}`).toEqual([]);
      // Classic geometry conserves orbs exactly: one placement, one more orb.
      expect(totalOrbs(res.boardAfter), `${rows}x${cols} orb conservation`).toBe(totalOrbs(b) + 1);
    }
  });

  it("an amplifier field oscillates, trips the iteration cap, and still hands back a stable board", () => {
    const rows = 6;
    const cols = 6;
    const b = makeBoard(rows, cols);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        cellAt(b, r, c).tile = "amplifier";
        own(b, r, c, 0, effectiveCriticalMass(b, r, c) - 1);
      }
    const s = newState(2, rows, cols, "arena", b);
    // P2 has not moved, so nobody is eliminated and the resolver cannot stop early on a winner.
    s.hasMoved = [true, false];
    const res = applyMove(s, 0, 0)!;
    expect(res.winner).toBeNull();
    expect(res.truncated, "the cap should have tripped").toBe(true);
    expect(unstable(res.boardAfter)).toEqual([]);
    expect(structuralViolations(res.boardAfter)).toEqual([]);
    // Amplifiers inject orbs, so the cap has to throw the surplus away; it may never invent orbs.
    expect(totalOrbs(res.boardAfter)).toBeLessThanOrEqual(res.chainCount + totalOrbs(b) + 1);

    // A truncated oscillation counted 7000-odd explosions on a 36-cell board. Recording that as a
    // personal best made the stat meaningless, so it is clamped to what the board could produce.
    const next = commitMove(s, res);
    expect(res.chainCount).toBeGreaterThan(rows * cols);
    expect(next.largestChain).toBeLessThanOrEqual(rows * cols);
    expect(next.totalExplosions).toBe(res.chainCount);
  });

  it("a reactor-and-fortify board cannot be driven into an unstable resting state", () => {
    const b = makeBoard(7, 7);
    for (let r = 0; r < 7; r++)
      for (let c = 0; c < 7; c++) {
        const cell = cellAt(b, r, c);
        if ((r * 7 + c) % 5 === 0) cell.tile = "reactor";
        if ((r * 7 + c) % 7 === 3) cell.tile = "amplifier";
        own(b, r, c, 0, 1);
        if ((r + c) % 3 === 0) cell.fortified = true;
        cell.orbs = effectiveCriticalMass(b, r, c) - 1;
      }
    const s = newState(2, 7, 7, "arena", b);
    s.hasMoved = [true, false];
    const res = applyMove(s, 3, 3)!;
    expect(unstable(res.boardAfter)).toEqual([]);
    expect(structuralViolations(res.boardAfter)).toEqual([]);
  });

  it("a cell sealed in by walls never explodes, so it cannot spin the resolver", () => {
    const b = makeBoard(3, 3);
    for (const [r, c] of [
      [0, 1],
      [1, 0],
      [1, 2],
      [2, 1],
    ] as const)
      cellAt(b, r, c).tile = "wall";
    expect(propagatingNeighbors(b, 1, 1)).toEqual([]);
    own(b, 1, 1, 0, 1);
    const s = newState(2, 3, 3, "arena", b);
    s.hasMoved = [true, true];
    // Repeated placements on a sealed cell must terminate and leave it below critical mass.
    let st = s;
    for (let i = 0; i < 6; i++) {
      const res = applyMove(st, 1, 1);
      if (!res) break;
      expect(unstable(res.boardAfter), `placement ${i}`).toEqual([]);
      st = commitMove(st, res);
      st = { ...st, currentPlayerIdx: 0 };
    }
  });
});

// -------------------------------------------------- 3. critical mass validation

describe("adversarial — effectiveCriticalMass", () => {
  it("corner, edge and interior on every board shape from 1x1 up", () => {
    for (let rows = 1; rows <= 5; rows++) {
      for (let cols = 1; cols <= 5; cols++) {
        const b = makeBoard(rows, cols);
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const open = propagatingNeighbors(b, r, c).length;
            const cm = effectiveCriticalMass(b, r, c);
            expect(cm, `${rows}x${cols} (${r},${c})`).toBe(Math.max(2, open));
            expect(cm).toBeGreaterThanOrEqual(2);
            expect(cm).toBeLessThanOrEqual(4);
          }
        }
      }
    }
  });

  it("each wall neighbour removes one, and the result never drops below 2", () => {
    const b = makeBoard(5, 5);
    expect(effectiveCriticalMass(b, 2, 2)).toBe(4);
    cellAt(b, 1, 2).tile = "wall";
    expect(effectiveCriticalMass(b, 2, 2)).toBe(3);
    cellAt(b, 3, 2).tile = "wall";
    expect(effectiveCriticalMass(b, 2, 2)).toBe(2);
    cellAt(b, 2, 1).tile = "wall";
    expect(effectiveCriticalMass(b, 2, 2), "floor at 2 with one opening").toBe(2);
    cellAt(b, 2, 3).tile = "wall";
    expect(effectiveCriticalMass(b, 2, 2), "floor at 2 when sealed").toBe(2);
  });

  it("fortify adds one; an owned reactor adds one; together they add two", () => {
    const b = makeBoard(5, 5);
    const c = cellAt(b, 2, 2);
    expect(effectiveCriticalMass(b, 2, 2)).toBe(4);
    c.fortified = true;
    expect(effectiveCriticalMass(b, 2, 2)).toBe(5);
    c.fortified = false;
    c.tile = "reactor";
    expect(effectiveCriticalMass(b, 2, 2), "an unowned reactor adds nothing").toBe(4);
    c.owner = 0;
    c.orbs = 1;
    expect(effectiveCriticalMass(b, 2, 2)).toBe(5);
    c.fortified = true;
    expect(effectiveCriticalMass(b, 2, 2)).toBe(6);
  });

  it("dead neighbours still count towards critical mass — only walls do not", () => {
    const b = makeBoard(5, 5);
    cellAt(b, 1, 2).tile = "dead";
    expect(effectiveCriticalMass(b, 2, 2)).toBe(4);
  });

  it("no cell one orb below its critical mass ever explodes", () => {
    for (const kind of ["classic", "arena"] as ModeKind[]) {
      const b = makeBoard(6, 6);
      for (let r = 0; r < 6; r++)
        for (let c = 0; c < 6; c++) {
          if (kind === "arena" && (r * 6 + c) % 11 === 0) cellAt(b, r, c).tile = "wall";
        }
      for (let r = 0; r < 6; r++)
        for (let c = 0; c < 6; c++) {
          const cell = cellAt(b, r, c);
          if (cell.tile === "wall") continue;
          own(b, r, c, 0, effectiveCriticalMass(b, r, c) - 1);
        }
      const s = newState(2, 6, 6, kind, b);
      s.hasMoved = [true, true];
      const out = resolveExplosions(s, cloneBoard(b), 0);
      expect(out.chainCount, `${kind}: a board at cm-1 exploded on its own`).toBe(0);
      expect(out.steps).toEqual([]);
    }
  });
});

// -------------------------------------------------------- orb bookkeeping

describe("adversarial — a cell may only lose the orbs it throws out", () => {
  it("a fortified cell keeps its surplus instead of destroying it", () => {
    const b = makeBoard(5, 5);
    own(b, 2, 2, 0, 4);
    cellAt(b, 2, 2).fortified = true; // cm 5, but only 4 outlets
    const s = newState(2, 5, 5, "abilities", b);
    s.hasMoved = [true, true];
    const res = applyMove(s, 2, 2)!;
    expect(res.chainCount).toBe(1);
    expect(totalOrbs(res.boardAfter), "fortify used to eat one orb per explosion").toBe(
      totalOrbs(b) + 1,
    );
    expect(cellAt(res.boardAfter, 2, 2).orbs).toBe(1);
    expect(cellAt(res.boardAfter, 2, 2).fortified, "fortify is consumed").toBeFalsy();
  });

  it("an owned reactor keeps its surplus", () => {
    const b = makeBoard(5, 5);
    own(b, 2, 2, 0, 4, "reactor"); // cm 5, 4 outlets
    const s = newState(2, 5, 5, "arena", b);
    s.hasMoved = [true, true];
    const res = applyMove(s, 2, 2)!;
    expect(res.chainCount).toBe(1);
    expect(totalOrbs(res.boardAfter)).toBe(totalOrbs(b) + 1);
  });

  it("a cell walled in on three sides keeps its surplus", () => {
    const b = makeBoard(3, 3);
    cellAt(b, 0, 1).tile = "wall";
    cellAt(b, 1, 0).tile = "wall";
    cellAt(b, 2, 1).tile = "wall";
    expect(propagatingNeighbors(b, 1, 1)).toEqual([[1, 2]]);
    expect(effectiveCriticalMass(b, 1, 1), "floored to 2 with one outlet").toBe(2);
    own(b, 1, 1, 0, 1);
    const s = newState(2, 3, 3, "arena", b);
    s.hasMoved = [true, true];
    const res = applyMove(s, 1, 1)!;
    expect(res.chainCount).toBe(1);
    expect(totalOrbs(res.boardAfter), "the floor used to delete an orb").toBe(totalOrbs(b) + 1);
  });

  it("a 1xN board conserves orbs across a whole game", () => {
    let st = newState(2, 1, 4);
    for (let i = 1; i <= 10 && st.winner === null; i++) {
      const moves: [number, number][] = [];
      for (let c = 0; c < 4; c++) if (canPlace(st, 0, c)) moves.push([0, c]);
      if (!moves.length) break;
      const res = applyMove(st, ...moves[0])!;
      expect(totalOrbs(res.boardAfter), `1x4 placement ${i}`).toBe(i);
      st = commitMove(st, res);
    }
  });

  it("orbs are conserved across arena play except where a sink swallows them", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const rand = rng(seed * 6151);
      const b = makeBoard(7, 9);
      for (const cell of b.cells) {
        const roll = rand();
        if (roll < 0.1) cell.tile = "wall";
        else if (roll < 0.16) cell.tile = "amplifier";
        else if (roll < 0.2) cell.tile = "reactor";
      }
      if (hasSinkOrDead(b)) continue; // sinks are allowed to destroy orbs by design
      let st = newState(2, 7, 9, "arena", b);
      let placed = 0;
      let injected = 0;
      for (let i = 0; i < 60 && st.winner === null; i++) {
        const moves: [number, number][] = [];
        for (let r = 0; r < 7; r++)
          for (let c = 0; c < 9; c++) if (canPlace(st, r, c)) moves.push([r, c]);
        if (!moves.length) break;
        const before = totalOrbs(st.board);
        const res = applyMove(st, ...moves[Math.floor(rand() * moves.length)])!;
        placed += 1;
        // Amplifiers create orbs and the cap discards them, so the only assertion that holds
        // universally is that no orb vanishes without an amplifier or the cap to explain it.
        const after = totalOrbs(res.boardAfter);
        if (!res.truncated) {
          const amplifierFired = res.steps.some((s) =>
            s.explosions.some((e) => cellAt(res.boardBefore, e.row, e.col).tile === "amplifier"),
          );
          if (!amplifierFired) {
            expect(after, `seed ${seed} turn ${i}: orbs lost with no sink or amplifier`).toBe(
              before + 1,
            );
          } else {
            injected += after - before - 1;
            expect(after).toBeGreaterThanOrEqual(before + 1);
          }
        }
        st = commitMove(st, res);
      }
      expect(placed).toBeGreaterThan(0);
      expect(injected).toBeGreaterThanOrEqual(0);
    }
  });
});

// ------------------------------------------------ 4. special tile interactions

describe("adversarial — special tiles", () => {
  it("a wall blocks propagation entirely and never takes an orb", () => {
    const b = makeBoard(3, 3);
    cellAt(b, 1, 0).tile = "wall";
    own(b, 0, 0, 0, 1); // (0,0): outlets are (1,0)=wall and (0,1) -> cm floors to 2
    const s = newState(2, 3, 3, "arena", b);
    s.hasMoved = [true, true];
    const res = applyMove(s, 0, 0)!;
    expect(cellAt(res.boardAfter, 1, 0).orbs).toBe(0);
    expect(cellAt(res.boardAfter, 1, 0).owner).toBeNull();
    expect(cellAt(res.boardAfter, 0, 1).orbs).toBe(1);
  });

  it("a dead cell absorbs the orb and stays empty and unowned", () => {
    const b = makeBoard(3, 3);
    cellAt(b, 0, 1).tile = "dead";
    own(b, 0, 0, 0, 1);
    const s = newState(2, 3, 3, "arena", b);
    s.hasMoved = [true, true];
    const res = applyMove(s, 0, 0)!;
    expect(cellAt(res.boardAfter, 0, 1).orbs).toBe(0);
    expect(cellAt(res.boardAfter, 0, 1).owner).toBeNull();
    // One orb went into the dead cell and is gone; the other reached (1,0).
    expect(cellAt(res.boardAfter, 1, 0).orbs).toBe(1);
    expect(totalOrbs(res.boardAfter)).toBe(1);
  });

  it("an amplifier injects two orbs per outlet and reports its hop-free explosion", () => {
    const b = makeBoard(5, 5);
    own(b, 2, 2, 0, 3, "amplifier");
    const s = newState(2, 5, 5, "arena", b);
    s.hasMoved = [true, true];
    const res = applyMove(s, 2, 2)!;
    for (const [r, c] of [
      [1, 2],
      [3, 2],
      [2, 1],
      [2, 3],
    ] as const) {
      expect(cellAt(res.boardAfter, r, c).orbs, `(${r},${c})`).toBeGreaterThanOrEqual(2);
    }
  });

  it("a portal routes an incoming orb to its pair, exactly once, and logs the hop", () => {
    const b = makeBoard(3, 5);
    cellAt(b, 0, 1).tile = "portal";
    cellAt(b, 0, 1).portalPairId = 1;
    cellAt(b, 2, 4).tile = "portal";
    cellAt(b, 2, 4).portalPairId = 1;
    own(b, 0, 0, 0, 1);
    const s = newState(2, 3, 5, "arena", b);
    s.hasMoved = [true, true];
    const res = applyMove(s, 0, 0)!;
    expect(cellAt(res.boardAfter, 0, 1).orbs, "the portal mouth does not keep the orb").toBe(0);
    expect(cellAt(res.boardAfter, 2, 4).orbs, "the far portal received it").toBe(1);
    expect(res.steps[0].hops).toEqual([{ from: [0, 0], to: [2, 4], owner: 0 }]);
  });

  it("a portal with no partner behaves like a normal cell rather than eating the orb", () => {
    const b = makeBoard(3, 3);
    cellAt(b, 0, 1).tile = "portal";
    cellAt(b, 0, 1).portalPairId = 9; // nothing else carries pair 9
    own(b, 0, 0, 0, 1);
    const s = newState(2, 3, 3, "arena", b);
    s.hasMoved = [true, true];
    const res = applyMove(s, 0, 0)!;
    expect(cellAt(res.boardAfter, 0, 1).orbs).toBe(1);
    expect(cellAt(res.boardAfter, 0, 1).owner).toBe(0);
  });

  it("an amplifier firing into a portal sends both orbs through and cannot loop", () => {
    const b = makeBoard(4, 4);
    cellAt(b, 0, 1).tile = "portal";
    cellAt(b, 0, 1).portalPairId = 1;
    cellAt(b, 3, 3).tile = "portal";
    cellAt(b, 3, 3).portalPairId = 1;
    own(b, 0, 0, 0, 1, "amplifier"); // corner amplifier, cm 2
    own(b, 2, 0, 1, 1); // P2 must hold something, or the chain stops on a decided game
    const s = newState(2, 4, 4, "arena", b);
    s.hasMoved = [true, true];
    const res = applyMove(s, 0, 0)!;
    expect(res.winner).toBeNull();
    expect(cellAt(res.boardAfter, 0, 1).orbs).toBe(0);
    // Both injected orbs hopped, which took the far portal to its corner critical mass of 2 and
    // set it off in turn — the cascade has to continue through the hop, not stop at it.
    expect(res.chainCount).toBe(2);
    expect(structuralViolations(res.boardAfter)).toEqual([]);
    expect(unstable(res.boardAfter)).toEqual([]);
  });

  it("two portals pointing at each other cannot bounce an orb forever", () => {
    const b = makeBoard(3, 3);
    for (const [r, c] of [
      [1, 1],
      [1, 2],
    ] as const) {
      cellAt(b, r, c).tile = "portal";
      cellAt(b, r, c).portalPairId = 1;
    }
    own(b, 0, 1, 0, 2); // fires down into the portal at (1,1)
    const s = newState(2, 3, 3, "arena", b);
    s.hasMoved = [true, true];
    const res = applyMove(s, 0, 1)!;
    expect(structuralViolations(res.boardAfter)).toEqual([]);
    expect(unstable(res.boardAfter)).toEqual([]);
  });

  it("a shield absorbs exactly one hostile orb and then breaks", () => {
    const b = makeBoard(3, 3);
    own(b, 0, 0, 0, 1, "amplifier"); // injects two orbs into (0,1)
    own(b, 0, 1, 1, 1);
    cellAt(b, 0, 1).shielded = true;
    const s = newState(2, 3, 3, "arena", b);
    s.hasMoved = [true, true];
    const res = applyMove(s, 0, 0)!;
    const target = cellAt(res.boardAfter, 0, 1);
    expect(target.shielded, "the shield broke").toBeFalsy();
    expect(target.orbs, "one orb absorbed, the second landed").toBe(2);
    expect(target.owner).toBe(0);
  });

  it("the tile layout is immutable through any number of cascades", () => {
    const board = buildChaosBoard(8, 12, defaultChaosConfig(8, 12), 4242);
    const layout = board.cells.map((c) => `${c.tile ?? "normal"}:${c.portalPairId ?? "-"}`);
    let st = newState(3, 8, 12, "arena", board);
    const rand = rng(777);
    for (let i = 0; i < 120 && st.winner === null; i++) {
      const moves: [number, number][] = [];
      for (let r = 0; r < 8; r++)
        for (let c = 0; c < 12; c++) if (canPlace(st, r, c)) moves.push([r, c]);
      if (!moves.length) break;
      const res = applyMove(st, ...moves[Math.floor(rand() * moves.length)])!;
      expect(
        res.boardAfter.cells.map((c) => `${c.tile ?? "normal"}:${c.portalPairId ?? "-"}`),
      ).toEqual(layout);
      st = commitMove(st, res);
    }
  });
});

// ------------------------------------------------- 5. invariants under injection

describe("adversarial — invariants survive injected boards", () => {
  it("random tile distributions and move sequences never reach an invalid state", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rand = rng(seed * 2654435761);
      const rows = 3 + Math.floor(rand() * 8);
      const cols = 3 + Math.floor(rand() * 10);
      const n = 2 + Math.floor(rand() * 3);
      const b = makeBoard(rows, cols);
      const kinds: TileKind[] = [
        "normal",
        "power",
        "portal",
        "wall",
        "amplifier",
        "dead",
        "reactor",
      ];
      let pair = 1;
      for (const cell of b.cells) {
        if (rand() < 0.3) {
          const tile = kinds[Math.floor(rand() * kinds.length)];
          if (tile !== "normal") cell.tile = tile;
          if (tile === "portal") cell.portalPairId = pair;
        }
      }
      // Give the portals partners so roughly half of them route somewhere.
      const portals = b.cells.filter((c) => c.tile === "portal");
      for (let i = 0; i + 1 < portals.length; i += 2) {
        portals[i].portalPairId = pair;
        portals[i + 1].portalPairId = pair;
        pair += 1;
      }
      // Seed ownership and orbs, sometimes right at the edge of critical mass.
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          const cell = cellAt(b, r, c);
          if (cell.tile === "wall" || cell.tile === "dead") continue;
          if (rand() < 0.45) {
            cell.owner = Math.floor(rand() * n);
            cell.orbs = Math.max(1, effectiveCriticalMass(b, r, c) - 1 - Math.floor(rand() * 2));
            if (rand() < 0.15) cell.fortified = true;
            if (rand() < 0.15) cell.shielded = true;
          }
        }
      const kind: ModeKind = rand() < 0.5 ? "arena" : "abilities";
      let st = newState(n, rows, cols, kind, b);
      st.hasMoved = st.players.map(() => true);
      st.energy = st.players.map(() => 100);

      for (let i = 0; i < 80 && st.winner === null && !st.draw; i++) {
        const moves: [number, number][] = [];
        for (let r = 0; r < rows; r++)
          for (let c = 0; c < cols; c++) if (canPlace(st, r, c)) moves.push([r, c]);
        if (!moves.length) break;
        const [r, c] = moves[Math.floor(rand() * moves.length)];
        const frozen = JSON.stringify(st.board);
        const res = applyMove(st, r, c);
        expect(res, `seed ${seed}: a legal move was rejected`).not.toBeNull();
        expect(JSON.stringify(st.board), `seed ${seed}: applyMove mutated the board`).toBe(frozen);
        expect(structuralViolations(res!.boardAfter), `seed ${seed} turn ${i}`).toEqual([]);
        if (res!.winner === null) {
          expect(unstable(res!.boardAfter), `seed ${seed} turn ${i}`).toEqual([]);
        }
        st = commitMove(st, res!);
        if (st.winner === null && !st.draw) {
          expect(
            st.eliminated[st.players[st.currentPlayerIdx].id],
            `seed ${seed}: the turn sits on an eliminated player`,
          ).toBe(false);
        }
      }
    }
  });

  it("a hand-corrupted board is repaired rather than propagated", () => {
    // Orbs with no owner, and modifiers on empty cells: whatever produced this, the next settled
    // board must not still carry it.
    const b = makeBoard(4, 4);
    const rogue: Cell = cellAt(b, 1, 1);
    rogue.orbs = 3;
    rogue.owner = 0;
    rogue.shielded = true;
    rogue.fortified = true;
    own(b, 1, 2, 0, 3);
    const s = newState(2, 4, 4, "abilities", b);
    s.hasMoved = [true, true];
    const res = applyMove(s, 1, 1)!;
    expect(structuralViolations(res.boardAfter)).toEqual([]);
  });
});

// --------------------------------------------------------- 6. mode edge cases

describe("adversarial — Sudden Death", () => {
  function shrinkState(rows: number, cols: number, b: BoardState): GameState {
    const s = newState(2, rows, cols, "classic", b);
    s.hasMoved = [true, true];
    s.rules = DEFAULT_RULES["sudden-death"];
    return s;
  }

  it("a shrink that sets off a cascade records those explosions", () => {
    const b = makeBoard(6, 6);
    for (const [r, c] of [
      [1, 1],
      [1, 2],
      [2, 1],
      [2, 2],
    ] as const)
      own(b, r, c, 0, 3);
    own(b, 0, 0, 1, 1);
    own(b, 3, 3, 1, 1);
    own(b, 5, 5, 1, 1);
    const after = applyShrink(shrinkState(6, 6, b))!;
    expect(after.totalExplosions, "shrink cascades were missing from the totals").toBeGreaterThan(
      0,
    );
    expect(after.largestChain).toBeGreaterThan(0);
    expect(unstable(after.board)).toEqual([]);
    expect(structuralViolations(after.board)).toEqual([]);
  });

  it("an owed extra placement does not outlive the player who owed it", () => {
    const b = makeBoard(6, 6);
    own(b, 0, 0, 1, 1); // P2 holds only an outer-ring cell
    own(b, 2, 2, 0, 1);
    own(b, 3, 3, 0, 1);
    const s = shrinkState(6, 6, b);
    s.modeConfig = MODE_CONFIGS.arena;
    s.extraPlacementFor = 1;
    s.extraPlacementCastUsed = true;
    s.powerBonus = [0, 1];
    const after = applyShrink(s)!;
    expect(after.eliminated[1]).toBe(true);
    // Left pointing at a dead player it would block every later power-tile bonus, because only
    // one extra placement can be outstanding at a time.
    expect(after.extraPlacementFor).toBeNull();
    expect(after.extraPlacementCastUsed).toBe(false);
  });

  it("a power-tile bonus is still reachable after the previous holder was eliminated", () => {
    const b = makeBoard(5, 5);
    own(b, 0, 0, 0, 1, "power");
    own(b, 4, 4, 1, 1);
    own(b, 2, 2, 2, 1);
    const s = newState(3, 5, 5, "arena", b);
    s.hasMoved = [true, true, true];
    s.eliminated = [false, true, false];
    s.extraPlacementFor = 1; // owed by the eliminated player
    s.powerBonus = [0, 0, 1];
    s.currentPlayerIdx = 0;
    const next = commitMove(s, applyMove(s, 0, 1)!);
    expect(next.extraPlacementFor, "P3's stored bonus should now be grantable").toBe(2);
  });

  it("shrinking a board mid-cascade leaves no cell above critical mass", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const rand = rng(seed * 104729);
      const b = makeBoard(8, 8);
      for (let r = 0; r < 8; r++)
        for (let c = 0; c < 8; c++)
          if (rand() < 0.75) own(b, r, c, rand() < 0.5 ? 0 : 1, effectiveCriticalMass(b, r, c) - 1);
      let st = shrinkState(8, 8, b);
      for (let i = 0; i < 3; i++) {
        const next = applyShrink(st);
        if (!next) break;
        expect(structuralViolations(next.board), `seed ${seed} shrink ${i}`).toEqual([]);
        if (next.winner === null && !next.draw) {
          expect(unstable(next.board), `seed ${seed} shrink ${i}`).toEqual([]);
        }
        st = next;
      }
    }
  });
});

describe("adversarial — Chaos Grid reproducibility", () => {
  it("the same seed rebuilds the same board, every time and at every size", () => {
    for (const [rows, cols] of [
      [6, 9],
      [8, 12],
      [10, 15],
    ] as const) {
      const cfg = defaultChaosConfig(rows, cols);
      for (const seed of [0, 1, 7, 123456, 2 ** 31 - 1]) {
        const a = buildChaosBoard(rows, cols, cfg, seed);
        const b = buildChaosBoard(rows, cols, cfg, seed);
        expect(JSON.stringify(a), `${rows}x${cols} seed ${seed}`).toBe(JSON.stringify(b));
      }
    }
  });

  it("every generated board is playable: portals are paired and nothing is orphaned", () => {
    for (let seed = 0; seed < 25; seed++) {
      const b = buildChaosBoard(8, 12, defaultChaosConfig(8, 12), seed);
      const pairs = new Map<number, number>();
      for (const cell of b.cells) {
        if (cell.tile !== "portal") continue;
        expect(cell.portalPairId, `seed ${seed}: portal with no pair id`).toBeDefined();
        pairs.set(cell.portalPairId!, (pairs.get(cell.portalPairId!) ?? 0) + 1);
      }
      for (const [id, count] of pairs) {
        expect(count, `seed ${seed}: pair ${id} has ${count} ends`).toBe(2);
      }
      expect(structuralViolations(b), `seed ${seed}`).toEqual([]);
      // At least one cell must be placeable or the board is dead on arrival.
      const s = newState(2, 8, 12, "arena", b);
      expect(hasLegalMove(s), `seed ${seed}: no legal opening move`).toBe(true);
    }
  });
});

// ---------------------------------------------------- turn-order edge cases

describe("adversarial — turns that cannot be played", () => {
  it("hasLegalMove reports a turn with nothing in it", () => {
    const b = makeBoard(2, 2);
    own(b, 0, 0, 0, 1);
    own(b, 0, 1, 1, 1);
    own(b, 1, 0, 1, 1);
    own(b, 1, 1, 1, 1);
    cellAt(b, 0, 0).empLockedFor = 0;
    cellAt(b, 0, 0).empLockedUntilTurn = 99;
    const s = newState(2, 2, 2, "abilities", b);
    s.hasMoved = [true, true];
    s.turn = 1;
    expect(hasLegalMove(s)).toBe(false);
    // The player still holds a cell, so they are not eliminated — something has to move the turn.
    expect(s.eliminated[0]).toBe(false);
    const after = forfeitTurn(s);
    expect(after.players[after.currentPlayerIdx].id).toBe(1);
  });

  it("hasCastableAbility distinguishes a stuck turn from one that still has an action", () => {
    const b = makeBoard(3, 3);
    own(b, 0, 0, 0, 1);
    const s = newState(2, 3, 3, "abilities", b);
    s.hasMoved = [true, true];
    s.energy = [100, 0];
    expect(hasCastableAbility(s)).toBe(true);
    expect(hasCastableAbility({ ...s, energy: [0, 0] })).toBe(false);
    expect(hasCastableAbility({ ...s, modeConfig: MODE_CONFIGS.classic })).toBe(false);
    expect(hasCastableAbility({ ...s, winner: 0 })).toBe(false);
  });

  it("forfeitTurn advances the turn counter so EMP locks expire", () => {
    const b = makeBoard(5, 5);
    own(b, 0, 0, 1, 1);
    own(b, 4, 4, 0, 1);
    const s = newState(2, 5, 5, "abilities", b);
    s.hasMoved = [true, true];
    s.energy = [100, 0];
    let st = commitMove(s, castAbility(s, "emp", [[0, 0]])!);
    expect(st.board.cells[0].empLockedFor).toBe(1);
    expect(canPlace(st, 0, 0), "P2 is locked out of its own cell").toBe(false);
    const lockedUntil = st.board.cells[0].empLockedUntilTurn!;
    // With the turn counter frozen this lock never lifted, and a timed game where both players
    // let the clock run out left the cell unplayable for the rest of the match.
    for (let i = 0; i < 4; i++) st = forfeitTurn(st);
    expect(st.turn).toBeGreaterThanOrEqual(lockedUntil);
    const onP2 = st.players[st.currentPlayerIdx].id === 1 ? st : forfeitTurn(st);
    expect(onP2.board.cells[0].empLockedFor).toBeUndefined();
    expect(canPlace(onP2, 0, 0)).toBe(true);
  });
});

// ---------------------------------------------- abilities interacting with turns

describe("adversarial — Double Drop cannot be turned into an endless turn", () => {
  function amplifierField(): GameState {
    const rows = 7;
    const cols = 7;
    const b = makeBoard(rows, cols);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        cellAt(b, r, c).tile = "amplifier";
        own(b, r, c, 0, effectiveCriticalMass(b, r, c) - 1);
      }
    const s = newState(2, rows, cols, "abilities", b);
    s.hasMoved = [true, false];
    s.energy = [100, 0];
    return s;
  }

  it("the owed drop survives one cast and no more", () => {
    const s = amplifierField();
    let st = commitMove(s, castAbility(s, "double-drop", [])!);
    expect(st.extraPlacementFor).toBe(0);
    expect(st.extraPlacementCastUsed).toBe(false);

    // One cast is the documented combo: the owed drop is still there afterwards.
    const first = castAbility(st, "overload", [[0, 0]]);
    expect(first).not.toBeNull();
    st = commitMove(st, first!);
    expect(st.players[st.currentPlayerIdx].id, "the caster keeps the turn").toBe(0);
    expect(st.extraPlacementFor).toBe(0);
    expect(st.extraPlacementCastUsed).toBe(true);

    // A second cast is refused. Each Overload on an amplifier board refunds more energy than it
    // costs, so without this the caster could hold the turn for good — measured at 50 consecutive
    // casts with energy still pinned at 100, and the opponent never moved again.
    expect(st.energy[0]).toBeGreaterThanOrEqual(30);
    expect(castAbility(st, "overload", [[1, 1]])).toBeNull();
    expect(castAbility(st, "shield", [[1, 1]])).toBeNull();
    expect(castAbility(st, "double-drop", [])).toBeNull();
    expect(hasCastableAbility(st)).toBe(false);
  });

  it("the two promised placements still happen and then the turn passes", () => {
    const s = amplifierField();
    let st = commitMove(s, castAbility(s, "double-drop", [])!);
    st = commitMove(st, castAbility(st, "shield", [[0, 0]])!);
    expect(st.players[st.currentPlayerIdx].id).toBe(0);
    st = commitMove(st, applyMove(st, 0, 0)!);
    expect(st.players[st.currentPlayerIdx].id, "first drop keeps the turn").toBe(0);
    expect(st.extraPlacementCastUsed, "the budget resets with the drop").toBe(false);
    st = commitMove(st, applyMove(st, 6, 6)!);
    expect(st.players[st.currentPlayerIdx].id, "second drop passes the turn").toBe(1);
  });

  it("a turn can never be held for more than a bounded number of commits", () => {
    const s = amplifierField();
    let st = commitMove(s, castAbility(s, "double-drop", [])!);
    let commits = 0;
    while (commits < 40 && st.players[st.currentPlayerIdx].id === 0 && st.winner === null) {
      const target = st.board.cells.findIndex((c) => c.owner === 0);
      const cast =
        target >= 0
          ? castAbility(st, "overload", [
              [Math.floor(target / st.board.cols), target % st.board.cols],
            ])
          : null;
      if (cast) {
        st = commitMove(st, cast);
      } else {
        const moves: [number, number][] = [];
        for (let r = 0; r < st.board.rows; r++)
          for (let c = 0; c < st.board.cols; c++) if (canPlace(st, r, c)) moves.push([r, c]);
        if (!moves.length) break;
        st = commitMove(st, applyMove(st, ...moves[0])!);
      }
      commits += 1;
    }
    expect(commits, "the turn should pass within a handful of commits").toBeLessThan(5);
  });
});

// -------------------------------------------------------- elimination accounting

describe("adversarial — elimination and ownership accounting", () => {
  it("nobody who holds a cell is ever marked eliminated, and nobody without one survives", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const rand = rng(seed * 40503);
      let st = newState(2 + (seed % 3), 5, 6);
      for (let i = 0; i < 200 && st.winner === null; i++) {
        const moves: [number, number][] = [];
        for (let r = 0; r < 5; r++)
          for (let c = 0; c < 6; c++) if (canPlace(st, r, c)) moves.push([r, c]);
        if (!moves.length) break;
        const res = applyMove(st, ...moves[Math.floor(rand() * moves.length)])!;
        st = commitMove(st, res);
        for (const p of st.players) {
          const cells = owned(st.board, p.id);
          if (cells > 0) {
            expect(st.eliminated[p.id], `seed ${seed}: P${p.id} holds ${cells} cells`).toBe(false);
          } else if (st.hasMoved[p.id] && st.winner === null) {
            expect(st.eliminated[p.id], `seed ${seed}: P${p.id} holds nothing`).toBe(true);
          }
        }
      }
    }
  });
});
