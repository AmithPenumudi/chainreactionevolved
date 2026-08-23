import { describe, it, expect } from "vitest";
import {
  applySolve,
  buildPuzzleBoard,
  isUnlocked,
  medalFor,
  medalRank,
  PUZZLE_ORDER,
  PUZZLES,
  type PuzzleProgress,
} from "../puzzles";

describe("PUZZLES data integrity", () => {
  it("every puzzle has unique id", () => {
    const ids = new Set(PUZZLES.map((p) => p.id));
    expect(ids.size).toBe(PUZZLES.length);
  });

  it("medal thresholds are ordered gold <= silver <= bronze <= maxMoves", () => {
    for (const p of PUZZLES) {
      expect(p.medals.gold, `${p.id} gold<=silver`).toBeLessThanOrEqual(p.medals.silver);
      expect(p.medals.silver, `${p.id} silver<=bronze`).toBeLessThanOrEqual(p.medals.bronze);
      expect(p.medals.bronze, `${p.id} bronze<=maxMoves`).toBeLessThanOrEqual(p.maxMoves);
    }
  });

  it("every cell spec lies within the puzzle's board bounds", () => {
    for (const p of PUZZLES) {
      for (const cell of p.cells) {
        expect(cell.row, `${p.id} row in bounds`).toBeGreaterThanOrEqual(0);
        expect(cell.row).toBeLessThan(p.rows);
        expect(cell.col, `${p.id} col in bounds`).toBeGreaterThanOrEqual(0);
        expect(cell.col).toBeLessThan(p.cols);
      }
    }
  });

  it("no two cell specs occupy the same coordinate", () => {
    for (const p of PUZZLES) {
      const seen = new Set<string>();
      for (const cell of p.cells) {
        const key = `${cell.row}:${cell.col}`;
        expect(seen.has(key), `${p.id} duplicate cell ${key}`).toBe(false);
        seen.add(key);
      }
    }
  });

  it("an 'eliminate' objective references a valid opponent index", () => {
    for (const p of PUZZLES) {
      if (p.objective.kind === "eliminate") {
        expect(p.objective.playerIdx).toBeGreaterThan(0);
        expect(p.objective.playerIdx).toBeLessThan(p.playerColors.length);
      }
    }
  });

  it("PUZZLE_ORDER contains exactly the same puzzles as PUZZLES", () => {
    expect(PUZZLE_ORDER.length).toBe(PUZZLES.length);
    expect(new Set(PUZZLE_ORDER.map((p) => p.id))).toEqual(new Set(PUZZLES.map((p) => p.id)));
  });
});

describe("buildPuzzleBoard", () => {
  it("places owners, orbs, and tiles from the cell specs", () => {
    const def = PUZZLES[0];
    const board = buildPuzzleBoard(def);
    expect(board.rows).toBe(def.rows);
    expect(board.cols).toBe(def.cols);
    for (const spec of def.cells) {
      const cell = board.cells[spec.row * def.cols + spec.col];
      if (spec.owner !== undefined) {
        expect(cell.owner).toBe(spec.owner);
        expect(cell.orbs).toBe(spec.orbs ?? 1);
      }
      if (spec.tile) expect(cell.tile).toBe(spec.tile);
    }
  });
});

describe("medalFor / medalRank", () => {
  const def = { medals: { gold: 3, silver: 5, bronze: 8 }, maxMoves: 10 } as never;

  it("awards gold at or under the gold threshold", () => {
    expect(medalFor(def, 3)).toBe("gold");
    expect(medalFor(def, 1)).toBe("gold");
  });

  it("awards silver between gold and silver thresholds", () => {
    expect(medalFor(def, 4)).toBe("silver");
    expect(medalFor(def, 5)).toBe("silver");
  });

  it("awards bronze between silver and bronze thresholds", () => {
    expect(medalFor(def, 6)).toBe("bronze");
    expect(medalFor(def, 8)).toBe("bronze");
  });

  it("awards no medal beyond the bronze threshold", () => {
    expect(medalFor(def, 9)).toBeNull();
  });

  it("ranks medals gold > silver > bronze > none", () => {
    expect(medalRank("gold")).toBeGreaterThan(medalRank("silver"));
    expect(medalRank("silver")).toBeGreaterThan(medalRank("bronze"));
    expect(medalRank("bronze")).toBeGreaterThan(medalRank(null));
  });
});

describe("applySolve", () => {
  const def = PUZZLES[0];

  it("grants xp on a first solve", () => {
    const { progress, xpGained } = applySolve({}, def, def.medals.gold, "gold");
    expect(xpGained).toBe(def.xp);
    expect(progress[def.id].medal).toBe("gold");
    expect(progress[def.id].bestMoves).toBe(def.medals.gold);
  });

  it("does not downgrade a better medal on a worse replay", () => {
    let progress: PuzzleProgress = {};
    ({ progress } = applySolve(progress, def, def.medals.gold, "gold"));
    const second = applySolve(progress, def, def.medals.bronze + 1, "bronze");
    expect(second.progress[def.id].medal).toBe("gold");
    expect(second.xpGained).toBe(0);
  });

  it("only pays the xp delta when improving from bronze to gold", () => {
    let progress: PuzzleProgress = {};
    ({ progress } = applySolve(progress, def, def.medals.bronze, "bronze"));
    const bronzeXp = progress[def.id].xpAwarded;
    const upgraded = applySolve(progress, def, def.medals.gold, "gold");
    expect(upgraded.xpGained).toBe(def.xp - bronzeXp);
    expect(upgraded.progress[def.id].medal).toBe("gold");
  });

  it("keeps the best (lowest) move count across replays", () => {
    let progress: PuzzleProgress = {};
    ({ progress } = applySolve(progress, def, def.medals.gold + 2, "silver"));
    const better = applySolve(progress, def, def.medals.gold, "gold");
    expect(better.progress[def.id].bestMoves).toBe(def.medals.gold);
  });
});

describe("isUnlocked", () => {
  it("the first puzzle is always unlocked", () => {
    expect(isUnlocked({}, PUZZLE_ORDER[0])).toBe(true);
  });

  it("a later puzzle is locked until the previous one has a record", () => {
    expect(isUnlocked({}, PUZZLE_ORDER[1])).toBe(false);
  });

  it("unlocks once the previous puzzle has any progress entry", () => {
    const progress: PuzzleProgress = {
      [PUZZLE_ORDER[0].id]: { medal: "bronze", bestMoves: 99, xpAwarded: 1 },
    };
    expect(isUnlocked(progress, PUZZLE_ORDER[1])).toBe(true);
  });
});
