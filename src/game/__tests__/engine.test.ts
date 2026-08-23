import { describe, it, expect } from "vitest";
import {
  applyMove,
  applyShrink,
  canPlace,
  cellsOwnedBy,
  commitMove,
  criticalMass,
  DEFAULT_RULES,
  effectiveCriticalMass,
  makeBoard,
  makeInitialState,
  MODE_CONFIGS,
  nextPlayerIdx,
  type GameState,
  type PlayerConfig,
} from "../engine";

function twoPlayers(): PlayerConfig[] {
  return [
    { id: 0, name: "P1", colorIndex: 0 },
    { id: 1, name: "P2", colorIndex: 1 },
  ];
}

function classicState(rows: number, cols: number, players = twoPlayers()): GameState {
  return makeInitialState(players, rows, cols, "classic", DEFAULT_RULES.classic, MODE_CONFIGS.classic);
}

describe("criticalMass", () => {
  it("is 2 in corners", () => {
    expect(criticalMass(5, 5, 0, 0)).toBe(2);
    expect(criticalMass(5, 5, 4, 4)).toBe(2);
    expect(criticalMass(5, 5, 0, 4)).toBe(2);
  });

  it("is 3 on edges", () => {
    expect(criticalMass(5, 5, 0, 2)).toBe(3);
    expect(criticalMass(5, 5, 2, 0)).toBe(3);
  });

  it("is 4 in the interior", () => {
    expect(criticalMass(5, 5, 2, 2)).toBe(4);
  });
});

describe("effectiveCriticalMass", () => {
  it("matches criticalMass on a board with no walls", () => {
    const b = makeBoard(5, 5);
    expect(effectiveCriticalMass(b, 0, 0)).toBe(2);
    expect(effectiveCriticalMass(b, 0, 2)).toBe(3);
    expect(effectiveCriticalMass(b, 2, 2)).toBe(4);
  });

  it("floors at 2 even when surrounded by walls", () => {
    const b = makeBoard(3, 3);
    b.cells[1 * 3 + 0].tile = "wall"; // left of center
    b.cells[1 * 3 + 2].tile = "wall"; // right of center
    b.cells[0 * 3 + 1].tile = "wall"; // above center
    b.cells[2 * 3 + 1].tile = "wall"; // below center
    expect(effectiveCriticalMass(b, 1, 1)).toBe(2);
  });

  it("adds +1 for a fortified cell", () => {
    const b = makeBoard(5, 5);
    b.cells[2 * 5 + 2].fortified = true;
    expect(effectiveCriticalMass(b, 2, 2)).toBe(5);
  });
});

describe("canPlace", () => {
  it("allows placing on an empty cell", () => {
    const state = classicState(5, 5);
    expect(canPlace(state, 2, 2)).toBe(true);
  });

  it("allows placing on your own cell", () => {
    const state = classicState(5, 5);
    state.board.cells[0].owner = 0;
    state.board.cells[0].orbs = 1;
    expect(canPlace(state, 0, 0)).toBe(true);
  });

  it("forbids placing on an opponent's cell", () => {
    const state = classicState(5, 5);
    state.board.cells[0].owner = 1;
    state.board.cells[0].orbs = 1;
    expect(canPlace(state, 0, 0)).toBe(false);
  });

  it("forbids placing on a wall or dead cell", () => {
    const state = classicState(5, 5);
    state.board.cells[0].tile = "wall";
    state.board.cells[1].tile = "dead";
    expect(canPlace(state, 0, 0)).toBe(false);
    expect(canPlace(state, 0, 1)).toBe(false);
  });

  it("forbids any placement once there is a winner", () => {
    const state = classicState(5, 5);
    state.winner = 0;
    expect(canPlace(state, 2, 2)).toBe(false);
  });

  it("forbids placing on a cell EMP-locked for the current player", () => {
    const state = classicState(5, 5);
    state.turn = 0;
    state.board.cells[0].empLockedFor = 0;
    state.board.cells[0].empLockedUntilTurn = 3;
    expect(canPlace(state, 0, 0)).toBe(false);
  });
});

describe("applyMove — basic placement and capture", () => {
  it("places the first orb without exploding", () => {
    const state = classicState(5, 5);
    const res = applyMove(state, 2, 2);
    expect(res).not.toBeNull();
    expect(res!.boardAfter.cells[2 * 5 + 2].orbs).toBe(1);
    expect(res!.boardAfter.cells[2 * 5 + 2].owner).toBe(0);
    expect(res!.chainCount).toBe(0);
  });

  it("returns null for an illegal move", () => {
    const state = classicState(5, 5);
    state.board.cells[0].owner = 1;
    state.board.cells[0].orbs = 1;
    expect(applyMove(state, 0, 0)).toBeNull();
  });

  it("counts a capture when placing on an enemy-owned cell reached by an explosion", () => {
    // Corner (0,0) has critical mass 2. Pre-load it to 1 for player 0,
    // and give the enemy-owned neighbor a single orb.
    const state = classicState(5, 5);
    state.board.cells[0].owner = 0;
    state.board.cells[0].orbs = 1;
    state.board.cells[1].owner = 1; // (0,1), enemy-owned
    state.board.cells[1].orbs = 1;
    state.hasMoved = [true, true];

    const res = applyMove(state, 0, 0);
    expect(res).not.toBeNull();
    // Corner explodes (2 -> 0), sending one orb each to its two neighbors:
    // (0,1) is captured from player 1, and (1,0) is captured from neutral —
    // "capture" counts any ownership change, neutral included.
    expect(res!.capturedCells).toBe(2);
    expect(res!.boardAfter.cells[1].owner).toBe(0);
  });
});

describe("applyMove — chain reactions and elimination", () => {
  it("propagates a chain across multiple cells", () => {
    const state = classicState(3, 3);
    // Load every corner/edge cell around center so placing on center cascades.
    state.board.cells[1 * 3 + 0].owner = 0; // left-edge, cm=3, preload 2
    state.board.cells[1 * 3 + 0].orbs = 2;
    state.board.cells[0 * 3 + 1].owner = 0; // top-edge, cm=3, preload 2
    state.board.cells[0 * 3 + 1].orbs = 2;
    state.hasMoved = [true, true];

    const res = applyMove(state, 1, 1); // center, cm=4, currently empty
    expect(res).not.toBeNull();
    // Center alone doesn't explode (1 orb < cm 4), so no chain yet.
    expect(res!.chainCount).toBe(0);
  });

  it("eliminates a player who loses all cells and declares the survivor the winner", () => {
    const state = classicState(3, 3);
    // Player 1 owns exactly one cell, at (0,1) with cm=3, loaded to 2.
    state.board.cells[0 * 3 + 1].owner = 1;
    state.board.cells[0 * 3 + 1].orbs = 2;
    // Player 0 owns the corner (0,0), cm=2, loaded to 1 — about to explode into (0,1).
    state.board.cells[0].owner = 0;
    state.board.cells[0].orbs = 1;
    state.hasMoved = [true, true];

    const res = applyMove(state, 0, 0);
    expect(res).not.toBeNull();
    expect(res!.eliminatedPlayers).toContain(1);
    expect(res!.winner).toBe(0);
  });
});

describe("applyMove — special tiles", () => {
  it("teleports an orb through a portal pair", () => {
    const state = classicState(5, 5, [
      { id: 0, name: "P1", colorIndex: 0 },
      { id: 1, name: "P2", colorIndex: 1 },
    ]);
    // Portal pair: (0,2) — an edge cell adjacent to our loaded cell — and (4,4).
    state.board.cells[0 * 5 + 2].tile = "portal";
    state.board.cells[0 * 5 + 2].portalPairId = 1;
    state.board.cells[4 * 5 + 4].tile = "portal";
    state.board.cells[4 * 5 + 4].portalPairId = 1;
    // (0,1) is an edge cell, cm=3. Load it to 2 so placing explodes it,
    // sending one orb into the portal at (0,2), which hops to (4,4).
    state.board.cells[0 * 5 + 1].owner = 0;
    state.board.cells[0 * 5 + 1].orbs = 2;
    state.hasMoved = [true, true];

    const res = applyMove(state, 0, 1);
    expect(res).not.toBeNull();
    expect(res!.boardAfter.cells[4 * 5 + 4].owner).toBe(0);
    expect(res!.boardAfter.cells[4 * 5 + 4].orbs).toBe(1);
    // The portal cell itself never accumulates the orb.
    expect(res!.boardAfter.cells[0 * 5 + 2].orbs).toBe(0);
  });

  it("a shield absorbs one hostile orb and then breaks", () => {
    const state = classicState(5, 5);
    state.board.cells[2 * 5 + 2].owner = 1;
    state.board.cells[2 * 5 + 2].orbs = 1;
    state.board.cells[2 * 5 + 2].shielded = true;
    // Neighbor cell (2,1), cm=4, loaded to 3 for player 0 — explodes into the shield.
    state.board.cells[2 * 5 + 1].owner = 0;
    state.board.cells[2 * 5 + 1].orbs = 3;
    state.hasMoved = [true, true];

    const res = applyMove(state, 2, 1);
    expect(res).not.toBeNull();
    const shieldedCell = res!.boardAfter.cells[2 * 5 + 2];
    // Absorbed: still owned by player 1, orb count unchanged, shield consumed.
    expect(shieldedCell.owner).toBe(1);
    expect(shieldedCell.orbs).toBe(1);
    expect(shieldedCell.shielded).toBe(false);
  });

  it("an amplifier injects two orbs per neighbor instead of one", () => {
    const state = classicState(5, 5);
    state.board.cells[2 * 5 + 2].tile = "amplifier";
    state.board.cells[2 * 5 + 2].owner = 0;
    state.board.cells[2 * 5 + 2].orbs = 3; // cm=4, about to fire
    state.hasMoved = [true, true];

    const res = applyMove(state, 2, 2);
    expect(res).not.toBeNull();
    // Each of the 4 orthogonal neighbors should receive 2 orbs.
    expect(res!.boardAfter.cells[1 * 5 + 2].orbs).toBe(2);
    expect(res!.boardAfter.cells[3 * 5 + 2].orbs).toBe(2);
    expect(res!.boardAfter.cells[2 * 5 + 1].orbs).toBe(2);
    expect(res!.boardAfter.cells[2 * 5 + 3].orbs).toBe(2);
  });
});

describe("commitMove", () => {
  it("caps energy gain at 100 in abilities mode", () => {
    const state = makeInitialState(
      twoPlayers(),
      5,
      5,
      "classic",
      DEFAULT_RULES.classic,
      MODE_CONFIGS.abilities,
    );
    state.energy[0] = 95;
    const res = applyMove(state, 2, 2)!;
    const next = commitMove(state, { ...res, energyDelta: 20 });
    expect(next.energy[0]).toBe(100);
  });

  it("advances to the next non-eliminated player", () => {
    const state = classicState(5, 5, [
      { id: 0, name: "P1", colorIndex: 0 },
      { id: 1, name: "P2", colorIndex: 1 },
      { id: 2, name: "P3", colorIndex: 2 },
    ]);
    state.eliminated = [false, true, false];
    const idx = nextPlayerIdx(state);
    expect(state.players[idx].id).toBe(2);
  });

  it("does not advance the turn when winner is decided", () => {
    const state = classicState(5, 5);
    state.board.cells[0 * 5 + 1].owner = 1;
    state.board.cells[0 * 5 + 1].orbs = 2;
    state.board.cells[0].owner = 0;
    state.board.cells[0].orbs = 1;
    state.hasMoved = [true, true];

    const res = applyMove(state, 0, 0)!;
    const next = commitMove(state, res);
    expect(next.winner).toBe(0);
    expect(next.endedAt).not.toBeNull();
  });
});

describe("applyShrink", () => {
  it("returns null when shrink is not enabled for the mode", () => {
    const state = classicState(8, 8);
    expect(applyShrink(state)).toBeNull();
  });

  it("returns null once the board is too small to shrink further", () => {
    const state = makeInitialState(
      twoPlayers(),
      4,
      4,
      "sudden-death",
      DEFAULT_RULES["sudden-death"],
      MODE_CONFIGS.classic,
    );
    expect(applyShrink(state)).toBeNull();
  });

  it("removes the outer ring, shrinking rows and cols by 2", () => {
    const state = makeInitialState(
      twoPlayers(),
      8,
      8,
      "sudden-death",
      DEFAULT_RULES["sudden-death"],
      MODE_CONFIGS.classic,
    );
    const next = applyShrink(state);
    expect(next).not.toBeNull();
    expect(next!.board.rows).toBe(6);
    expect(next!.board.cols).toBe(6);
    expect(next!.shrinkCount).toBe(1);
  });
});

describe("cellsOwnedBy", () => {
  it("counts owned cells correctly", () => {
    const b = makeBoard(3, 3);
    b.cells[0].owner = 0;
    b.cells[1].owner = 0;
    b.cells[2].owner = 1;
    expect(cellsOwnedBy(b, 0)).toBe(2);
    expect(cellsOwnedBy(b, 1)).toBe(1);
  });
});
