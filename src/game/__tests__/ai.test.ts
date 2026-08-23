import { describe, it, expect } from "vitest";
import { chooseAIMove } from "../ai";
import {
  canPlace,
  DEFAULT_RULES,
  makeInitialState,
  MODE_CONFIGS,
  type GameState,
  type PlayerConfig,
} from "../engine";

function twoPlayers(): PlayerConfig[] {
  return [
    { id: 0, name: "P1", colorIndex: 0, isAI: true, difficulty: "hard" },
    { id: 1, name: "P2", colorIndex: 1 },
  ];
}

function classicState(rows: number, cols: number): GameState {
  return makeInitialState(
    twoPlayers(),
    rows,
    cols,
    "classic",
    DEFAULT_RULES.classic,
    MODE_CONFIGS.classic,
  );
}

describe("chooseAIMove", () => {
  it("returns null when there are no legal moves", () => {
    const state = classicState(1, 1);
    state.board.cells[0].tile = "wall";
    expect(chooseAIMove(state, "easy")).toBeNull();
  });

  it.each(["easy", "normal", "hard"] as const)(
    "%s difficulty always returns a legal move",
    (difficulty) => {
      const state = classicState(5, 5);
      for (let i = 0; i < 10; i++) {
        const move = chooseAIMove(state, difficulty);
        expect(move).not.toBeNull();
        expect(canPlace(state, move!.r, move!.c)).toBe(true);
      }
    },
  );

  it("hard AI takes an immediately winning move when one is available", () => {
    const state = classicState(3, 3);
    // Player 1 (opponent) owns exactly one cell; player 0 (AI, 'me') has a
    // loaded corner that explodes directly into it, eliminating player 1.
    state.board.cells[0 * 3 + 1].owner = 1;
    state.board.cells[0 * 3 + 1].orbs = 2;
    state.board.cells[0].owner = 0;
    state.board.cells[0].orbs = 1;
    state.hasMoved = [true, true];

    const move = chooseAIMove(state, "hard");
    expect(move).toEqual({ r: 0, c: 0 });
  });

  it("never suggests a move onto an opponent-owned cell", () => {
    const state = classicState(4, 4);
    state.board.cells[5].owner = 1;
    state.board.cells[5].orbs = 1;
    for (let i = 0; i < 20; i++) {
      const move = chooseAIMove(state, "normal");
      expect(move).not.toEqual({ r: 1, c: 1 });
    }
  });
});
