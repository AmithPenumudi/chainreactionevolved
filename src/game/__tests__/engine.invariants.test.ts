import { describe, it, expect } from "vitest";
import {
  applyMove,
  applyShrink,
  canPlace,
  cloneBoard,
  commitMove,
  DEFAULT_RULES,
  effectiveCriticalMass,
  forfeitTurn,
  makeBoard,
  makeInitialState,
  MODE_CONFIGS,
  nextPlayerIdx,
  type BoardState,
  type GameState,
  type ModeKind,
  type PlayerConfig,
} from "../engine";
import { ARENA_MAPS } from "../arena-maps";

// ------------------------------------------------------------------ helpers

/** Deterministic PRNG so any failure is reproducible from its seed. */
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

function legal(state: GameState): [number, number][] {
  const out: [number, number][] = [];
  for (let r = 0; r < state.board.rows; r++)
    for (let c = 0; c < state.board.cols; c++) if (canPlace(state, r, c)) out.push([r, c]);
  return out;
}

function totalOrbs(b: BoardState) {
  return b.cells.reduce((s, c) => s + c.orbs, 0);
}

/** Every structural rule that must hold on any settled board. Returns violations. */
function settledViolations(b: BoardState, requireStable = true): string[] {
  const bad: string[] = [];
  for (let r = 0; r < b.rows; r++) {
    for (let c = 0; c < b.cols; c++) {
      const cell = b.cells[r * b.cols + c];
      const at = `(${r},${c})`;
      if (cell.orbs < 0) bad.push(`${at} negative orbs`);
      if (cell.tile === "wall" || cell.tile === "dead") {
        if (cell.orbs !== 0 || cell.owner !== null) bad.push(`${at} orbs/owner on wall or dead`);
        continue;
      }
      if (cell.orbs === 0 && cell.owner !== null) bad.push(`${at} empty but owned`);
      if (cell.orbs > 0 && cell.owner === null) bad.push(`${at} orbs but unowned`);
      if (
        cell.owner === null &&
        (cell.shielded || cell.fortified || cell.empLockedFor !== undefined)
      )
        bad.push(`${at} modifier on an unowned cell`);
      if (requireStable && cell.owner !== null && cell.orbs >= effectiveCriticalMass(b, r, c))
        bad.push(`${at} unstable (${cell.orbs} >= ${effectiveCriticalMass(b, r, c)})`);
    }
  }
  return bad;
}

function assertSettled(b: BoardState, label: string, requireStable = true) {
  expect(settledViolations(b, requireStable), label).toEqual([]);
}

/** Plays a random game and checks invariants after every commit. */
function playRandomGame(seed: number, opts: { n: number; rows: number; cols: number }) {
  const rand = rng(seed);
  let state = newState(opts.n, opts.rows, opts.cols);
  let expectedOrbs = 0;
  for (let i = 0; i < 600 && state.winner === null; i++) {
    const moves = legal(state);
    expect(moves.length, `seed ${seed}: current player has no legal move`).toBeGreaterThan(0);
    const [r, c] = moves[Math.floor(rand() * moves.length)];
    const frozen = seed % 5 === 0 ? JSON.stringify(state.board) : null;
    const res = applyMove(state, r, c)!;
    expect(res, `seed ${seed}: legal move rejected`).not.toBeNull();
    // applyMove is pure.
    if (frozen) expect(JSON.stringify(state.board), `seed ${seed}: applyMove mutated`).toBe(frozen);
    // Classic board (no tiles): an explosion only redistributes orbs, never loses them
    // — except that orbs are not destroyed, so the total is exactly +1 per placement.
    expectedOrbs += 1;
    expect(totalOrbs(res.boardAfter), `seed ${seed} turn ${i}: orb conservation`).toBe(
      expectedOrbs,
    );
    // A decided game stops mid-chain by design, so only live boards must be stable.
    assertSettled(res.boardAfter, `seed ${seed} turn ${i}`, res.winner === null);
    state = commitMove(state, res);
    if (state.winner === null) {
      expect(
        state.eliminated[state.players[state.currentPlayerIdx].id],
        `seed ${seed}: eliminated player is on turn`,
      ).toBe(false);
    }
  }
  return state;
}

// -------------------------------------------------------------------- fuzz

describe("engine fuzz — classic boards", () => {
  const sizes: [number, number, number][] = [
    [2, 2, 2],
    [2, 3, 3],
    [2, 5, 5],
    [3, 6, 6],
    [4, 8, 8],
    [6, 10, 10],
    [8, 5, 5],
    [2, 6, 9],
  ];
  for (const [n, rows, cols] of sizes) {
    it(`${n} players on ${rows}x${cols}: invariants hold across 15 random games`, () => {
      for (let seed = 1; seed <= 15; seed++)
        playRandomGame(seed * 131 + rows * cols, { n, rows, cols });
    });
  }

  it("games between 2 players always terminate with a winner on small boards", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const end = playRandomGame(seed, { n: 2, rows: 4, cols: 4 });
      expect(end.winner, `seed ${seed}`).not.toBeNull();
    }
  });
});

describe("engine fuzz — arena maps with special tiles", () => {
  for (const map of ARENA_MAPS) {
    it(`${map.label}: boards always settle and keep tile invariants`, () => {
      for (let seed = 1; seed <= 6; seed++) {
        const rand = rng(seed * 977);
        let state = newState(2 + (seed % 3), map.rows, map.cols, "arena", map.build());
        for (let i = 0; i < 250 && state.winner === null; i++) {
          const moves = legal(state);
          expect(moves.length).toBeGreaterThan(0);
          const [r, c] = moves[Math.floor(rand() * moves.length)];
          const res = applyMove(state, r, c)!;
          assertSettled(res.boardAfter, `${map.id} seed ${seed} turn ${i}`, res.winner === null);
          // tile layout is immutable
          res.boardAfter.cells.forEach((cell, k) => {
            expect(cell.tile).toBe(state.board.cells[k].tile);
            expect(cell.portalPairId).toBe(state.board.cells[k].portalPairId);
          });
          state = commitMove(state, res);
          if (state.winner === null) {
            // In arena, a queued power bonus is consumed by playing the extra placement.
            const cur = state.players[state.currentPlayerIdx].id;
            if (state.extraPlacementFor === cur) {
              const r2 = applyMove(state, ...legal(state)[0])!;
              r2.keepTurn = true;
              r2.usedPowerBonus = true;
              state = commitMove(state, r2);
            }
          }
        }
      }
    }, 60_000);
  }
});

// ------------------------------------------------------------ edge cases

describe("engine edge cases — geometry", () => {
  it("a 1x1 board: cm floors at 2, so a single orb never explodes", () => {
    const s = newState(2, 1, 1);
    const res = applyMove(s, 0, 0)!;
    expect(res.chainCount).toBe(0);
    expect(res.boardAfter.cells[0].orbs).toBe(1);
  });

  it("2x2 board: every cell is a corner with critical mass 2", () => {
    const b = makeBoard(2, 2);
    for (let r = 0; r < 2; r++)
      for (let c = 0; c < 2; c++) expect(effectiveCriticalMass(b, r, c)).toBe(2);
  });

  it("applyMove out of bounds does not throw a non-null result", () => {
    const s = newState(2, 3, 3);
    // Out-of-range indices point at undefined cells; the engine must not silently accept them.
    expect(() => applyMove(s, 5, 5)).toThrow();
  });
});

describe("engine edge cases — elimination and turn order", () => {
  it("a player who has not moved yet is never eliminated, even with 0 cells", () => {
    const s = newState(3, 4, 4);
    s.board.cells[0].owner = 0;
    s.board.cells[0].orbs = 1; // corner about to fire into (0,1),(1,0) — nothing of P3's
    s.hasMoved = [true, true, false];
    // P2 owns (0,1) with 2 orbs (edge cm 3) — will be captured.
    s.board.cells[1].owner = 1;
    s.board.cells[1].orbs = 1;
    s.board.cells[4].owner = 1;
    s.board.cells[4].orbs = 1;
    const res = applyMove(s, 0, 0)!;
    expect(res.eliminatedPlayers).toContain(1);
    expect(res.eliminatedPlayers).not.toContain(2);
    expect(res.winner).toBeNull(); // P3 hasn't moved, but game is not over: only P1 activated+alive?
  });

  it("3 players: winner is only declared once two are eliminated", () => {
    const s = newState(3, 3, 3);
    s.hasMoved = [true, true, true];
    // P1 corner about to fire; P2 owns (0,1) (cm3, 2 orbs); P3 owns (1,0) (cm3, 2 orbs)
    Object.assign(s.board.cells[0], { owner: 0, orbs: 1 });
    Object.assign(s.board.cells[1], { owner: 1, orbs: 2 });
    Object.assign(s.board.cells[3], { owner: 2, orbs: 2 });
    const res = applyMove(s, 0, 0)!;
    expect(res.eliminatedPlayers.sort()).toEqual([1, 2]);
    expect(res.winner).toBe(0);
  });

  it("nextPlayerIdx skips consecutive eliminated players and wraps around", () => {
    const s = newState(4, 3, 3);
    s.eliminated = [false, true, true, false];
    s.currentPlayerIdx = 0;
    expect(nextPlayerIdx(s)).toBe(3);
    s.currentPlayerIdx = 3;
    expect(nextPlayerIdx(s)).toBe(0);
  });

  it("nextPlayerIdx with everyone else eliminated returns the current player", () => {
    const s = newState(3, 3, 3);
    s.eliminated = [false, true, true];
    expect(nextPlayerIdx(s)).toBe(0);
  });

  it("commitMove records winner and does not rotate the turn", () => {
    const s = newState(2, 3, 3);
    s.hasMoved = [true, true];
    Object.assign(s.board.cells[0], { owner: 0, orbs: 1 });
    Object.assign(s.board.cells[1], { owner: 1, orbs: 2 });
    const next = commitMove(s, applyMove(s, 0, 0)!);
    expect(next.winner).toBe(0);
    expect(next.currentPlayerIdx).toBe(0);
  });
});

describe("engine edge cases — repeated eliminations", () => {
  it("an already-eliminated player is not eliminated again by a later chain", () => {
    const s = newState(3, 4, 4);
    s.hasMoved = [true, true, true];
    s.eliminated = [false, true, false]; // P2 is long gone
    Object.assign(s.board.cells[0], { owner: 0, orbs: 1 }); // corner fires
    Object.assign(s.board.cells[15], { owner: 2, orbs: 1 });
    const res = applyMove(s, 0, 0)!;
    expect(res.chainCount).toBeGreaterThan(0);
    expect(res.eliminatedPlayers).not.toContain(1);
  });
});

describe("engine edge cases — forfeitTurn", () => {
  it("passes the turn to the next living player and clears a pending extra placement", () => {
    const s = newState(3, 4, 4);
    s.eliminated = [false, true, false];
    s.extraPlacementFor = 0;
    const next = forfeitTurn(s);
    expect(next.players[next.currentPlayerIdx].id).toBe(2);
    expect(next.extraPlacementFor).toBeNull();
  });

  it("is a no-op once the game has a winner or draw", () => {
    const s = newState(2, 4, 4);
    s.winner = 1;
    expect(forfeitTurn(s)).toBe(s);
    const d = newState(2, 4, 4);
    d.draw = true;
    expect(forfeitTurn(d)).toBe(d);
  });

  it("does not mutate the input state or board", () => {
    const s = newState(2, 4, 4);
    const before = JSON.stringify(s);
    forfeitTurn(s);
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe("engine edge cases — Sudden Death shrink", () => {
  function sd(n: number, rows: number, cols: number) {
    return makeInitialState(
      players(n),
      rows,
      cols,
      "sudden-death",
      DEFAULT_RULES["sudden-death"],
      MODE_CONFIGS.classic,
    );
  }

  it("keeps the interior cells intact and drops the outer ring", () => {
    const s = sd(2, 6, 6);
    Object.assign(s.board.cells[2 * 6 + 2], { owner: 0, orbs: 2 });
    const next = applyShrink(s)!;
    expect(next.board.rows).toBe(4);
    expect(next.board.cells[1 * 4 + 1]).toMatchObject({ owner: 0, orbs: 2 });
  });

  it("a player whose cells all sat on the outer ring is eliminated", () => {
    const s = sd(2, 6, 6);
    s.hasMoved = [true, true];
    Object.assign(s.board.cells[0], { owner: 1, orbs: 1 }); // corner ring
    Object.assign(s.board.cells[2 * 6 + 2], { owner: 0, orbs: 1 });
    const next = applyShrink(s)!;
    expect(next.eliminated[1]).toBe(true);
    expect(next.winner).toBe(0);
  });

  it("reports a draw when nobody is left", () => {
    const s = sd(2, 6, 6);
    s.hasMoved = [true, true];
    Object.assign(s.board.cells[0], { owner: 0, orbs: 1 });
    Object.assign(s.board.cells[35], { owner: 1, orbs: 1 });
    const next = applyShrink(s)!;
    expect(next.draw).toBe(true);
    expect(next.endedAt).not.toBeNull();
  });

  it("never leaves an eliminated player holding the turn after a shrink", () => {
    // P1 is on turn after the commit; the shrink wipes P1 out. The turn must move on.
    const s = sd(3, 6, 6);
    s.hasMoved = [true, true, true];
    s.currentPlayerIdx = 1;
    Object.assign(s.board.cells[0], { owner: 1, orbs: 1 }); // P2 only on the ring
    Object.assign(s.board.cells[2 * 6 + 2], { owner: 0, orbs: 1 });
    Object.assign(s.board.cells[3 * 6 + 3], { owner: 2, orbs: 1 });
    const next = applyShrink(s)!;
    expect(next.eliminated[1]).toBe(true);
    expect(next.eliminated[next.players[next.currentPlayerIdx].id]).toBe(false);
  });

  it("shrinking repeatedly bottoms out at 4x4 without corrupting the board", () => {
    let s: GameState | null = sd(2, 10, 10);
    let guard = 0;
    while (s && guard++ < 10) {
      const n = applyShrink(s);
      if (!n) break;
      assertSettled(n.board, `shrink ${guard}`);
      s = n;
    }
    expect(s!.board.rows).toBe(4);
  });

  it("a shrunk board always settles even when the ring held loaded cells", () => {
    const s = sd(2, 6, 6);
    s.hasMoved = [true, true];
    for (let r = 1; r < 5; r++)
      for (let c = 1; c < 5; c++)
        Object.assign(s.board.cells[r * 6 + c], { owner: (r + c) % 2, orbs: 3 });
    const next = applyShrink(s)!;
    // A shrink that ends the game may stop mid-chain; otherwise the board must settle.
    assertSettled(next.board, "post-shrink", next.winner === null && !next.draw);
  });
});

describe("engine edge cases — stale cell flags", () => {
  it("shield / fortify / EMP flags are cleared when a cell is emptied by exploding", () => {
    const s = newState(2, 3, 3);
    s.hasMoved = [true, true];
    const corner = s.board.cells[0];
    Object.assign(corner, { owner: 0, orbs: 1, shielded: true, fortified: false });
    const res = applyMove(s, 0, 0)!;
    const after = res.boardAfter.cells[0];
    expect(after.owner).toBeNull();
    expect(after.shielded, "shield must not survive on an empty cell").toBeFalsy();
  });

  it("a captured cell does not keep the previous owner's fortification", () => {
    const s = newState(2, 5, 5);
    s.hasMoved = [true, true];
    // P2's fortified interior cell, then P1 explodes into it.
    Object.assign(s.board.cells[2 * 5 + 2], { owner: 1, orbs: 1, fortified: true });
    Object.assign(s.board.cells[2 * 5 + 1], { owner: 0, orbs: 3 });
    const res = applyMove(s, 2, 1)!;
    const captured = res.boardAfter.cells[2 * 5 + 2];
    expect(captured.owner).toBe(0);
    expect(captured.fortified, "fortify is a defence for its owner only").toBeFalsy();
  });

  it("cloneBoard is a deep copy", () => {
    const b = makeBoard(2, 2);
    const c = cloneBoard(b);
    c.cells[0].orbs = 5;
    expect(b.cells[0].orbs).toBe(0);
  });
});
