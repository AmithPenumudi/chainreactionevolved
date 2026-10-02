import { describe, it, expect, vi } from "vitest";
import { chooseAIAction, chooseAIMove, type AIDifficulty } from "../ai";
import { castAbility } from "../abilities";
import { ARENA_MAPS } from "../arena-maps";
import {
  applyMove,
  canPlace,
  commitMove,
  DEFAULT_RULES,
  makeInitialState,
  MODE_CONFIGS,
  type BoardState,
  type GameState,
  type ModeKind,
  type PlayerConfig,
} from "../engine";

function seedRandom(seed: number) {
  let a = seed >>> 0;
  vi.spyOn(Math, "random").mockImplementation(() => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  });
}

function mk(
  diffs: AIDifficulty[],
  rows: number,
  cols: number,
  kind: ModeKind,
  board?: BoardState,
): GameState {
  const players: PlayerConfig[] = diffs.map((d, i) => ({
    id: i,
    name: `AI${i}`,
    colorIndex: i,
    isAI: true,
    difficulty: d,
  }));
  return makeInitialState(
    players,
    rows,
    cols,
    "classic",
    DEFAULT_RULES.classic,
    MODE_CONFIGS[kind],
    board,
  );
}

/** Applies whatever the AI chose and returns the next state; fails the test on any illegality. */
function step(state: GameState, label: string): GameState {
  const cur = state.players[state.currentPlayerIdx];
  const action = chooseAIAction(state, cur.difficulty ?? "normal");
  expect(action, `${label}: AI returned no action`).not.toBeNull();
  const a = action!;
  if (a.type === "ability") {
    expect(state.modeConfig.abilities, `${label}: ability chosen in a mode without abilities`).toBe(
      true,
    );
    const res = castAbility(state, a.abilityId!, a.targets ?? []);
    expect(res, `${label}: AI chose an invalid ${a.abilityId} cast`).not.toBeNull();
    return commitMove(state, res!);
  }
  expect(canPlace(state, a.r, a.c), `${label}: illegal placement (${a.r},${a.c})`).toBe(true);
  return commitMove(state, applyMove(state, a.r, a.c)!);
}

function playOut(state: GameState, maxTurns: number, label: string) {
  let s = state;
  let n = 0;
  while (s.winner === null && !s.draw && n++ < maxTurns) s = step(s, `${label} turn ${n}`);
  return { s, turns: n };
}

const DIFFS: AIDifficulty[] = ["easy", "normal", "hard"];

describe("AI — degenerate inputs", () => {
  it("returns null when the current player has no legal move", () => {
    const s = mk(["hard", "hard"], 6, 9, "classic");
    // Every cell belongs to the opponent.
    s.board.cells.forEach((c) => Object.assign(c, { owner: 1, orbs: 1 }));
    for (const d of DIFFS) {
      expect(chooseAIMove(s, d), d).toBeNull();
      expect(chooseAIAction(s, d), d).toBeNull();
    }
  });

  it("with a single legal move, every difficulty plays it", () => {
    const s = mk(["easy", "easy"], 6, 9, "classic");
    s.board.cells.forEach((c) => Object.assign(c, { owner: 1, orbs: 1 }));
    Object.assign(s.board.cells[10], { owner: null, orbs: 0 });
    for (const d of DIFFS) expect(chooseAIMove(s, d), d).toEqual({ r: 1, c: 1 });
  });

  it("takes an immediate winning move on normal and hard", () => {
    for (const d of ["normal", "hard"] as AIDifficulty[]) {
      const s = mk([d, d], 6, 9, "classic");
      s.hasMoved = [true, true];
      Object.assign(s.board.cells[0], { owner: 0, orbs: 1 }); // corner about to fire
      Object.assign(s.board.cells[1], { owner: 1, orbs: 2 }); // P2's only cell
      Object.assign(s.board.cells[9], { owner: 0, orbs: 1 }); // (1,0)
      const m = chooseAIMove(s, d)!;
      expect(applyMove(s, m.r, m.c)!.winner, d).toBe(0);
    }
  });

  it("never picks a wall, dead cell, or an opponent's cell on a special-tile board", () => {
    const map = ARENA_MAPS.find((m) => m.id === "chaos")!;
    for (let seed = 1; seed <= 10; seed++) {
      seedRandom(seed);
      const s = mk(["easy", "normal", "hard"], map.rows, map.cols, "arena", map.build());
      for (const d of DIFFS) {
        const m = chooseAIMove(s, d)!;
        expect(canPlace(s, m.r, m.c), `${d} seed ${seed}`).toBe(true);
      }
    }
  }, 60_000);
});

describe("AI — full games", () => {
  for (const d of DIFFS) {
    it(`${d} vs ${d} on a 6x9 classic board always finishes with a winner`, () => {
      for (let seed = 1; seed <= 3; seed++) {
        seedRandom(seed * 7);
        const { s, turns } = playOut(mk([d, d], 6, 9, "classic"), 400, `${d}#${seed}`);
        expect(s.winner, `${d} seed ${seed} not finished after ${turns} turns`).not.toBeNull();
      }
    }, 90_000);
  }

  it("mixed 4-player game (easy/normal/normal/hard) finishes and never leaves a dead player on turn", () => {
    seedRandom(99);
    let s = mk(["easy", "normal", "normal", "hard"], 6, 9, "classic");
    let n = 0;
    while (s.winner === null && n++ < 500) {
      s = step(s, `4p turn ${n}`);
      if (s.winner === null)
        expect(s.eliminated[s.players[s.currentPlayerIdx].id], `turn ${n}`).toBe(false);
    }
    expect(s.winner).not.toBeNull();
  }, 120_000);

  it("Abilities mode: AI casts only valid abilities, energy stays in 0..100", () => {
    for (const d of ["normal", "hard"] as AIDifficulty[]) {
      seedRandom(5);
      let s = mk([d, d], 6, 9, "abilities");
      let casts = 0;
      for (let n = 0; n < 200 && s.winner === null; n++) {
        const before = s.energy.slice();
        const cur = s.players[s.currentPlayerIdx].id;
        const next = step(s, `${d} abilities turn ${n}`);
        if (next.energy[cur] < before[cur] - 1 && next.winner === null) casts++;
        for (const e of next.energy) {
          expect(e).toBeGreaterThanOrEqual(0);
          expect(e).toBeLessThanOrEqual(100);
        }
        s = next;
      }
      expect(casts, `${d} never used an ability in 200 turns`).toBeGreaterThan(0);
    }
  }, 180_000);

  for (const map of ARENA_MAPS) {
    it(`Arena — ${map.label}: AI plays 60 legal turns on every difficulty without error`, () => {
      for (const d of DIFFS) {
        seedRandom(11);
        const s0 = mk(
          [d, d, d].slice(0, map.rows > 8 ? 3 : 2),
          map.rows,
          map.cols,
          "arena",
          map.build(),
        );
        const { s, turns } = playOut(s0, 60, `${map.id}/${d}`);
        expect(turns).toBeGreaterThan(0);
        expect(s.board.cells.every((c) => c.orbs >= 0)).toBe(true);
      }
    }, 120_000);
  }
});

describe("AI — responsiveness", () => {
  /*
   * This deliberately does NOT assert a millisecond budget.
   *
   * It used to: `expect(ms).toBeLessThan(1500)`. That failed at 2271ms purely because an Android
   * emulator was saturating the CPU, while passing in isolation on the same commit. Budgeting
   * against `applyMove` instead of the clock was tried next and was still not stable — the same
   * search measured 8,700 applyMove-equivalents in isolation and 21,274 inside the parallel
   * suite, because a long operation absorbs far more contention than the short calibration
   * beside it. Any wall-clock assertion inside a parallel suite measures the machine at least as
   * much as the code.
   *
   * The guarantee that actually matters is asserted where it is real:
   *   - `npm run test:android` drives the app on a device and fails if the hard bot stalls the
   *     UI for more than 400ms;
   *   - `AI_WORKER_TIMEOUT_MS` (src/game/ai-client.ts) bounds it in production, with a
   *     main-thread fallback.
   *
   * What is left here is deterministic: the search on the biggest, busiest board terminates and
   * returns something the engine will accept. The ceiling is generous on purpose — it catches a
   * runaway (an accidentally unbounded search), not a slow machine.
   */
  const RUNAWAY_CEILING_MS = 20_000;

  it("hard AI terminates on the biggest board mid-game and returns a legal action", () => {
    seedRandom(3);
    const map = ARENA_MAPS.find((m) => m.id === "power-grid")!;
    let s = mk(["easy", "easy"], map.rows, map.cols, "arena", map.build());
    s = playOut(s, 40, "warmup").s;
    if (s.winner !== null) return;

    const t0 = performance.now();
    const action = chooseAIAction(s, "hard");
    const ms = performance.now() - t0;

    expect(action, "hard AI returned nothing on a board with legal moves").not.toBeNull();
    if (action!.type === "move") {
      expect(
        canPlace(s, action!.r, action!.c),
        `hard AI chose an illegal placement at ${action!.r},${action!.c}`,
      ).toBe(true);
    }
    expect(ms, `hard AI took ${Math.round(ms)}ms - that is runaway, not slow`).toBeLessThan(
      RUNAWAY_CEILING_MS,
    );
  }, 60_000);
});
