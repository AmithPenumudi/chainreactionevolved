import { describe, expect, it, vi } from "vitest";
import { chooseAIAction, chooseAIMove, shrinkUrgency, type AIDifficulty } from "../ai";
import { castAbility } from "../abilities";
import {
  applyMove,
  applyShrink,
  commitMove,
  DEFAULT_RULES,
  makeInitialState,
  MODE_CONFIGS,
  type GameMode,
  type GameState,
} from "../engine";

function seedRandom(n: number) {
  let a = n >>> 0;
  vi.spyOn(Math, "random").mockImplementation(() => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  });
}

function state(
  mode: GameMode,
  rows: number,
  cols: number,
  difficulty: AIDifficulty = "normal",
): GameState {
  const players = [0, 1].map((i) => ({
    id: i,
    name: `Bot ${i}`,
    colorIndex: i,
    isAI: true,
    difficulty,
  }));
  return makeInitialState(players, rows, cols, mode, DEFAULT_RULES[mode], MODE_CONFIGS.classic);
}

const own = (s: GameState, r: number, c: number, owner: number, orbs: number) =>
  Object.assign(s.board.cells[r * s.board.cols + c], { owner, orbs });

const onRing = (s: GameState, r: number, c: number) =>
  r === 0 || c === 0 || r === s.board.rows - 1 || c === s.board.cols - 1;

describe("shrinkUrgency", () => {
  it("is 0 whenever shrinking is off, or the board cannot shrink further", () => {
    expect(shrinkUrgency(state("classic", 8, 8))).toBe(0);
    expect(shrinkUrgency(state("blitz", 8, 8))).toBe(0);
    const tiny = state("sudden-death", 4, 4);
    tiny.turn = 7;
    expect(shrinkUrgency(tiny)).toBe(0);
  });

  it("is 1 when the shrink fires right after this move (turns 7, 15, 23 … of 8)", () => {
    for (const turn of [7, 15, 23, 71]) {
      const s = state("sudden-death", 8, 12);
      s.turn = turn;
      expect(shrinkUrgency(s), `turn ${turn}`).toBe(1);
    }
  });

  it("fades linearly over the four moves before a shrink, then is 0", () => {
    const at = (turn: number) => {
      const s = state("sudden-death", 8, 12);
      s.turn = turn;
      return shrinkUrgency(s);
    };
    expect([at(6), at(5), at(4), at(3), at(0)]).toEqual([0.75, 0.5, 0.25, 0, 0]);
  });

  it("always stays within 0..1 for every turn number", () => {
    const s = state("sudden-death", 8, 12);
    for (let t = 0; t < 200; t++) {
      s.turn = t;
      const u = shrinkUrgency(s);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThanOrEqual(1);
    }
  });
});

describe("shrink-aware decisions", () => {
  it("normal and hard never play the doomed ring when the shrink is imminent and the interior is open", () => {
    for (const d of ["normal", "hard"] as AIDifficulty[]) {
      for (let seed = 1; seed <= 6; seed++) {
        seedRandom(seed);
        const s = state("sudden-death", 8, 8, d);
        s.hasMoved = [true, true];
        s.turn = 7;
        own(s, 3, 3, 0, 1);
        own(s, 4, 4, 1, 1);
        const m = chooseAIMove(s, d)!;
        expect(onRing(s, m.r, m.c), `${d} seed ${seed} chose (${m.r},${m.c})`).toBe(false);
      }
    }
  });

  it("a bot whose only cell is on the ring uses its move to get an interior cell", () => {
    for (const d of ["normal", "hard"] as AIDifficulty[]) {
      seedRandom(3);
      const s = state("sudden-death", 8, 8, d);
      s.hasMoved = [true, true];
      s.turn = 7;
      own(s, 0, 0, 0, 1); // about to be deleted
      own(s, 4, 4, 1, 1);
      const a = chooseAIAction(s, d)!;
      expect(a.type).toBe("move");
      expect(onRing(s, a.r, a.c), `${d} chose (${a.r},${a.c})`).toBe(false);
      // and it really survives the shrink
      const after = applyShrink(commitMove(s, applyMove(s, a.r, a.c)!))!;
      expect(after.eliminated[0]).toBe(false);
    }
  });

  it("without a shrink coming, edges are still valued (behaviour unchanged for other modes)", () => {
    let ring = 0;
    for (let seed = 1; seed <= 20; seed++) {
      seedRandom(seed);
      const s = state("classic", 8, 8, "normal");
      s.hasMoved = [true, true];
      own(s, 3, 3, 0, 1);
      own(s, 4, 4, 1, 1);
      const m = chooseAIMove(s, "normal")!;
      if (onRing(s, m.r, m.c)) ring++;
    }
    expect(ring).toBeGreaterThan(0);
  });

  it("easy bots avoid the ring more often when the shrink is imminent", () => {
    const rate = (mode: GameMode, turn: number) => {
      let ring = 0;
      for (let seed = 1; seed <= 60; seed++) {
        seedRandom(seed);
        const s = state(mode, 8, 8, "easy");
        s.hasMoved = [true, true];
        s.turn = turn;
        own(s, 3, 3, 0, 1);
        own(s, 4, 4, 1, 1);
        const m = chooseAIMove(s, "easy")!;
        if (onRing(s, m.r, m.c)) ring++;
      }
      return ring;
    };
    expect(rate("sudden-death", 7)).toBeLessThan(rate("classic", 7));
  });
});

describe("Sudden Death bot matches", () => {
  function play(seed: number) {
    seedRandom(seed);
    let s = state("sudden-death", 8, 12);
    for (let t = 0; t < 500 && s.winner === null && !s.draw; t++) {
      const a = chooseAIAction(s, "normal")!;
      const res =
        a.type === "ability"
          ? castAbility(s, a.abilityId!, a.targets ?? [])!
          : applyMove(s, a.r, a.c)!;
      s = commitMove(s, res);
      if (s.winner === null && s.turn % s.rules.shrinkIntervalRounds === 0) {
        const shrunk = applyShrink(s);
        if (shrunk) s = shrunk;
      }
      if (s.winner === null && !s.draw) {
        expect(s.eliminated[s.players[s.currentPlayerIdx].id], `seed ${seed} turn ${t}`).toBe(
          false,
        );
      }
    }
    return s;
  }

  it("almost never end at the very first shrink any more, and always finish", () => {
    let atFirstShrink = 0;
    const N = 14;
    for (let i = 1; i <= N; i++) {
      const s = play(i * 17);
      expect(s.winner !== null || s.draw, `seed ${i * 17} did not finish`).toBe(true);
      if (s.turn <= 8) atFirstShrink++;
    }
    // Measured before the fix: about half of all matches ended here.
    expect(atFirstShrink).toBeLessThanOrEqual(2);
  }, 240_000);
});
