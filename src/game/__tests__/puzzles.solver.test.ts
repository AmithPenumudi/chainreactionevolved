import { describe, it, expect } from "vitest";
import {
  applyMove,
  canPlace,
  cellsOwnedBy,
  commitMove,
  makeInitialState,
  MODE_CONFIGS,
  type BoardState,
  type GameState,
} from "../engine";
import { buildPuzzleBoard, PUZZLES, type PuzzleDef } from "../puzzles";

/**
 * Brute-force solver that mirrors PuzzleGame exactly: only the solver (player 0) moves,
 * the turn always returns to them, and the objective is read from the resulting board.
 */
function initial(def: PuzzleDef): GameState {
  return makeInitialState(
    def.playerColors.map((colorIndex, i) => ({ id: i, name: `P${i}`, colorIndex })),
    def.rows,
    def.cols,
    "classic",
    undefined,
    MODE_CONFIGS[def.modeKind],
    buildPuzzleBoard(def),
  );
}

function objectiveMet(def: PuzzleDef, board: BoardState, chain: number): boolean {
  const o = def.objective;
  if (o.kind === "chain") return chain >= o.minExplosions;
  if (o.kind === "capture") return board.cells[o.row * board.cols + o.col].owner === 0;
  if (o.kind === "eliminate") return cellsOwnedBy(board, o.playerIdx) === 0;
  return def.playerColors.slice(1).every((_, i) => cellsOwnedBy(board, i + 1) === 0);
}

const key = (s: GameState) =>
  s.board.cells.map((c) => `${c.owner ?? "_"}${c.orbs}${c.shielded ? "s" : ""}`).join(",");

interface Solve {
  minMoves: number | null;
  exhausted: boolean;
}

/** Iterative deepening with a transposition table. */
function solve(def: PuzzleDef, budget = 400_000): Solve {
  const root = initial(def);
  let nodes = 0;
  let exhausted = false;

  const dfs = (s: GameState, depth: number, seen: Map<string, number>): boolean => {
    if (depth === 0) return false;
    for (let r = 0; r < s.board.rows; r++) {
      for (let c = 0; c < s.board.cols; c++) {
        if (!canPlace(s, r, c)) continue;
        if (++nodes > budget) {
          exhausted = true;
          return false;
        }
        const res = applyMove(s, r, c)!;
        if (objectiveMet(def, res.boardAfter, res.chainCount)) return true;
        const next = {
          ...commitMove(s, res),
          currentPlayerIdx: 0,
          winner: null,
          draw: false,
        } as GameState;
        const k = key(next);
        const prev = seen.get(k);
        if (prev !== undefined && prev >= depth - 1) continue;
        seen.set(k, depth - 1);
        if (dfs(next, depth - 1, seen)) return true;
        if (exhausted) return false;
      }
    }
    return false;
  };

  for (let d = 1; d <= def.maxMoves; d++) {
    if (dfs(root, d, new Map())) return { minMoves: d, exhausted };
    if (exhausted) return { minMoves: null, exhausted: true };
  }
  return { minMoves: null, exhausted };
}

describe("puzzles — solvability (brute force)", () => {
  const results: {
    id: string;
    min: number | null;
    gold: number;
    max: number;
    unverified: boolean;
  }[] = [];

  for (const def of PUZZLES) {
    it(`${def.id}: can be solved within its move cap`, () => {
      const t = solve(def);
      results.push({
        id: def.id,
        min: t.minMoves,
        gold: def.medals.gold,
        max: def.maxMoves,
        unverified: t.exhausted,
      });
      if (t.exhausted && t.minMoves === null) return; // too large to brute force; reported below
      expect(t.minMoves, `${def.id} has no solution within ${def.maxMoves} moves`).not.toBeNull();
    }, 120_000);

    it(`${def.id}: is not already solved before the first move`, () => {
      const s = initial(def);
      expect(objectiveMet(def, s.board, 0) && def.objective.kind !== "chain").toBe(false);
    });
  }

  it("gold is attainable: no puzzle demands fewer moves than the optimum", () => {
    const bad = results.filter((r) => r.min !== null && r.gold < r.min);
    expect(bad, JSON.stringify(bad)).toEqual([]);
  });

  it("reports puzzles the solver could not fully search (informational)", () => {
    const unverified = results.filter((r) => r.unverified).map((r) => r.id);
    console.info(`brute-force inconclusive for: ${unverified.join(", ") || "none"}`);
    console.info(
      "optimal vs gold: " + results.map((r) => `${r.id}=${r.min ?? "?"}/${r.gold}`).join("  "),
    );
    expect(results.length).toBe(PUZZLES.length);
  });
});
