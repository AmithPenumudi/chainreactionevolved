import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyMove,
  applyShrink,
  canPlace,
  commitMove,
  DEFAULT_RULES,
  effectiveCriticalMass,
  hasLegalMove,
  makeBoard,
  makeInitialState,
  MODE_CONFIGS,
  type BoardState,
  type GameState,
  type ModeKind,
  type PlayerConfig,
} from "../engine";
import { abilityById, castAbility } from "../abilities";
import { chooseAIAction, chooseAIMove, shuffled, shrinkUrgency, type AIDifficulty } from "../ai";
import { getArenaMap } from "../arena-maps";

/*
 * Adversarial AI suite. `ai.test.ts` and `ai.fuzz.test.ts` cover the bots playing normally; this
 * file asks whether a bot can be made to do something it must never do — return a move it is not
 * allowed to play, cast an ability it cannot pay for, walk past a win it had in hand, mutate the
 * position it was handed, or leave a turn unplayed.
 */

const DIFFICULTIES: AIDifficulty[] = ["easy", "normal", "hard"];

/** A seeded stand-in for Math.random, so every bot decision in this file is reproducible. */
function seedRandom(seed: number) {
  let a = seed >>> 0;
  vi.spyOn(Math, "random").mockImplementation(() => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

function bots(spec: AIDifficulty[]): PlayerConfig[] {
  return spec.map((difficulty, i) => ({
    id: i,
    name: `BOT${i + 1}`,
    colorIndex: i,
    isAI: true,
    difficulty,
  }));
}

function newState(
  players: PlayerConfig[],
  rows: number,
  cols: number,
  kind: ModeKind = "classic",
  board?: BoardState,
  mode: keyof typeof DEFAULT_RULES = "classic",
): GameState {
  return makeInitialState(
    players,
    rows,
    cols,
    mode,
    DEFAULT_RULES[mode],
    MODE_CONFIGS[kind],
    board,
  );
}

const cellAt = (b: BoardState, r: number, c: number) => b.cells[r * b.cols + c];

function own(b: BoardState, r: number, c: number, p: number, orbs: number) {
  const cell = cellAt(b, r, c);
  cell.owner = p;
  cell.orbs = orbs;
}

/** Plays out a whole match between bots, asserting every action is one the engine accepts. */
function playBotMatch(
  state: GameState,
  opts: { maxTurns?: number; shrink?: boolean; label: string },
): GameState {
  let st = state;
  const limit = opts.maxTurns ?? 400;
  for (let i = 0; i < limit && st.winner === null && !st.draw; i++) {
    const player = st.players[st.currentPlayerIdx];
    const frozen = JSON.stringify(st);
    const action = chooseAIAction(st, player.difficulty ?? "normal");
    expect(JSON.stringify(st), `${opts.label} turn ${i}: the search mutated the position`).toBe(
      frozen,
    );
    if (!action) {
      // Only legitimate when there is genuinely nothing to play.
      expect(hasLegalMove(st), `${opts.label} turn ${i}: gave up with a legal move available`).toBe(
        false,
      );
      break;
    }
    if (action.type === "ability") {
      expect(action.abilityId, `${opts.label} turn ${i}`).toBeDefined();
      const def = abilityById(action.abilityId!);
      expect(
        st.energy[player.id],
        `${opts.label} turn ${i}: cast ${def.id} it could not afford`,
      ).toBeGreaterThanOrEqual(def.cost);
      const res = castAbility(st, action.abilityId!, action.targets ?? []);
      expect(res, `${opts.label} turn ${i}: illegal ability cast ${def.id}`).not.toBeNull();
      st = commitMove(st, res!);
    } else {
      expect(
        canPlace(st, action.r, action.c),
        `${opts.label} turn ${i}: illegal placement (${action.r},${action.c})`,
      ).toBe(true);
      const res = applyMove(st, action.r, action.c);
      expect(res, `${opts.label} turn ${i}: rejected move`).not.toBeNull();
      st = commitMove(st, res!);
    }
    if (opts.shrink) {
      const every = st.rules.shrinkIntervalRounds;
      if (st.winner === null && !st.draw && st.rules.enableShrink && st.turn % every === 0) {
        st = applyShrink(st) ?? st;
      }
    }
    if (st.winner === null && !st.draw) {
      expect(
        st.eliminated[st.players[st.currentPlayerIdx].id],
        `${opts.label} turn ${i}: the turn landed on an eliminated bot`,
      ).toBe(false);
    }
  }
  return st;
}

// ------------------------------------------------------------ legality / purity

describe("adversarial AI — every action is one the engine accepts", () => {
  it("all nine difficulty pairings play a full classic match legally", () => {
    for (const a of DIFFICULTIES) {
      for (const b of DIFFICULTIES) {
        seedRandom(a.length * 31 + b.length * 17 + 1);
        const end = playBotMatch(newState(bots([a, b]), 4, 4), { label: `${a} vs ${b}` });
        expect(end.winner !== null || end.draw, `${a} vs ${b} never finished`).toBe(true);
        vi.restoreAllMocks();
      }
    }
  });

  it("four bots on an arena map never produce an illegal action", () => {
    const map = getArenaMap("chaos");
    for (const seed of [1, 2]) {
      seedRandom(seed * 7919);
      playBotMatch(
        newState(
          bots(["easy", "normal", "hard", "normal"]),
          map.rows,
          map.cols,
          "arena",
          map.build(),
        ),
        { maxTurns: 120, label: `arena seed ${seed}` },
      );
      vi.restoreAllMocks();
    }
  });

  it("abilities mode: a bot never casts an ability it cannot pay for or target", () => {
    for (const seed of [1, 2]) {
      seedRandom(seed * 104729);
      const st = newState(bots(["hard", "normal"]), 6, 6, "abilities");
      // Start both bots rich so the ability branches are actually explored.
      playBotMatch({ ...st, energy: [100, 100] }, { maxTurns: 120, label: `abilities ${seed}` });
      vi.restoreAllMocks();
    }
  });

  it("Sudden Death: bots keep playing legally across repeated shrinks", () => {
    for (const seed of [1, 2]) {
      seedRandom(seed * 40503);
      const st = newState(bots(["hard", "hard"]), 10, 10, "classic", undefined, "sudden-death");
      playBotMatch(st, { maxTurns: 200, shrink: true, label: `sudden-death ${seed}` });
      vi.restoreAllMocks();
    }
  });

  it("chooseAIMove and chooseAIAction return null rather than an illegal move when stuck", () => {
    // Every cell belongs to the opponent, and the bot's own cell is EMP-locked.
    const b = makeBoard(2, 2);
    own(b, 0, 0, 0, 1);
    own(b, 0, 1, 1, 1);
    own(b, 1, 0, 1, 1);
    own(b, 1, 1, 1, 1);
    cellAt(b, 0, 0).empLockedFor = 0;
    cellAt(b, 0, 0).empLockedUntilTurn = 99;
    const st = { ...newState(bots(["hard", "hard"]), 2, 2, "abilities", b), turn: 1 };
    expect(hasLegalMove(st)).toBe(false);
    for (const d of DIFFICULTIES) {
      expect(chooseAIMove(st, d), d).toBeNull();
      expect(chooseAIAction(st, d), d).toBeNull();
    }
  });

  it("a decided position is never handed a move", () => {
    const st = newState(bots(["hard", "hard"]), 4, 4);
    for (const finished of [
      { ...st, winner: 0 },
      { ...st, draw: true },
    ]) {
      for (const d of DIFFICULTIES) {
        const action = chooseAIAction(finished, d);
        // Either it declines, or whatever it names must still be refused by the engine.
        if (action && action.type === "move")
          expect(canPlace(finished, action.r, action.c)).toBe(false);
      }
    }
  });
});

// ------------------------------------------------------------------ sampling

describe("adversarial AI — the move sampler is actually random", () => {
  it("shuffled keeps every element exactly once and does not touch the input", () => {
    const input = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (let seed = 1; seed <= 20; seed++) {
      seedRandom(seed * 2654435761);
      const out = shuffled(input);
      expect(out).toHaveLength(input.length);
      expect([...out].sort((a, b) => a - b)).toEqual([...input]);
      vi.restoreAllMocks();
    }
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("every position reaches every slot, which the sort-based shuffle it replaced did not", () => {
    // `sort(() => Math.random() - 0.5)` is not a shuffle: the comparator is inconsistent, so the
    // result stays close to the original order. Both callers used it to take a random sample, so
    // the "sample" was mostly the first few cells in scan order — a bias invisible from outside,
    // which is why it survived. A real shuffle moves element 0 off the front most of the time.
    const n = 10;
    const runs = 400;
    const landedAt = Array.from({ length: n }, () => new Set<number>());
    let firstStayedFirst = 0;
    const real = Math.random;
    let a = 123456789 >>> 0;
    vi.spyOn(Math, "random").mockImplementation(() => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    });
    const input = Array.from({ length: n }, (_, i) => i);
    for (let i = 0; i < runs; i++) {
      const out = shuffled(input);
      out.forEach((v, slot) => landedAt[v].add(slot));
      if (out[0] === 0) firstStayedFirst += 1;
    }
    vi.restoreAllMocks();
    expect(Math.random).toBe(real);
    // Over 400 shuffles of 10 items, every element should have visited every slot at least once.
    for (let v = 0; v < n; v++) {
      expect(landedAt[v].size, `element ${v} only reached ${landedAt[v].size} slots`).toBe(n);
    }
    // And the first element should stay first about 1 time in 10, not most of the time.
    expect(firstStayedFirst).toBeLessThan(runs / 4);
  });
});

// ------------------------------------------------------------- tactical minimum

describe("adversarial AI — the moves it must not miss", () => {
  /** P1 can win outright by firing the corner; anything else hands the game back. */
  function winInOne(): GameState {
    const b = makeBoard(4, 4);
    own(b, 0, 0, 0, 1); // corner, cm 2 — one more orb fires it
    own(b, 0, 1, 1, 2); // P2's only cell, captured by that explosion
    const st = newState(bots(["hard", "hard"]), 4, 4, "classic", b);
    return { ...st, hasMoved: [true, true] };
  }

  it("normal and hard both take an immediate win", () => {
    for (const d of ["normal", "hard"] as AIDifficulty[]) {
      for (const seed of [1, 2, 3, 4, 5]) {
        seedRandom(seed * 2654435761);
        const st = winInOne();
        const action = chooseAIAction(st, d)!;
        expect(action.type).toBe("move");
        const res = applyMove(st, action.r, action.c)!;
        expect(res.winner, `${d} seed ${seed} walked past a win at (${action.r},${action.c})`).toBe(
          0,
        );
        vi.restoreAllMocks();
      }
    }
  });

  it("a win is preferred over any ability, however much energy is banked", () => {
    for (const seed of [1, 2, 3]) {
      seedRandom(seed * 668265263);
      const base = winInOne();
      const st = { ...base, modeConfig: MODE_CONFIGS.abilities, energy: [100, 0] };
      const action = chooseAIAction(st, "hard")!;
      const res =
        action.type === "ability"
          ? castAbility(st, action.abilityId!, action.targets ?? [])
          : applyMove(st, action.r, action.c);
      expect(res?.winner, `seed ${seed}: passed up a win for an ability`).toBe(0);
      vi.restoreAllMocks();
    }
  });

  it("hard does not walk into a cell an enemy is about to capture when a safe cell exists", () => {
    // (0,0) is P1's, one orb below firing. Playing next to it at (0,1) or (1,0) is giving orbs
    // away; the far corner is free and safe.
    const b = makeBoard(5, 5);
    own(b, 0, 0, 1, 1); // enemy corner at cm-1
    own(b, 4, 4, 0, 1); // our own safe corner
    const st = { ...newState(bots(["hard", "hard"]), 5, 5, "classic", b), hasMoved: [true, true] };
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      seedRandom(seed * 374761393);
      const action = chooseAIAction(st, "hard")!;
      const adjacentToEnemy =
        (action.r === 0 && action.c === 1) || (action.r === 1 && action.c === 0);
      expect(adjacentToEnemy, `seed ${seed}: fed the enemy corner`).toBe(false);
      vi.restoreAllMocks();
    }
  });

  it("shrinkUrgency rises as the shrink approaches and is zero when it cannot happen", () => {
    const base = newState(bots(["hard", "hard"]), 10, 10, "classic", undefined, "sudden-death");
    expect(shrinkUrgency({ ...base, rules: DEFAULT_RULES.classic })).toBe(0);
    // A board already at the floor can never shrink again.
    expect(shrinkUrgency({ ...base, board: makeBoard(4, 4) })).toBe(0);
    const every = base.rules.shrinkIntervalRounds;
    const onBoundary = shrinkUrgency({ ...base, turn: every - 1 });
    expect(onBoundary, "the shrink fires right after this move").toBe(1);
    expect(shrinkUrgency({ ...base, turn: every - 2 })).toBeLessThan(onBoundary);
    expect(shrinkUrgency({ ...base, turn: 0 })).toBeLessThan(onBoundary);
  });
});

// --------------------------------------------------------------- async desync

describe("adversarial AI — the position moving on under the search", () => {
  it("an action chosen against a stale position is refused, not applied blindly", () => {
    // The search is async, so the board can have moved by the time the answer arrives. The engine
    // has to be the one that says no.
    const b = makeBoard(4, 4);
    own(b, 1, 1, 0, 1);
    own(b, 2, 2, 1, 1);
    const stale = {
      ...newState(bots(["hard", "hard"]), 4, 4, "classic", b),
      hasMoved: [true, true],
    };
    seedRandom(99);
    const action = chooseAIAction(stale, "hard")!;
    // While the search was running the bot's turn timed out and came back round, and by then the
    // opponent had taken the cell it picked. Replaying the stale answer must be refused rather than
    // silently stealing the cell.
    const afterOpponent: GameState = {
      ...stale,
      board: {
        ...stale.board,
        cells: stale.board.cells.map((cell, i) =>
          i === action.r * 4 + action.c ? { orbs: 1, owner: 1 } : cell,
        ),
      },
    };
    expect(afterOpponent.players[afterOpponent.currentPlayerIdx].id).toBe(0);
    expect(canPlace(afterOpponent, action.r, action.c)).toBe(false);
    expect(applyMove(afterOpponent, action.r, action.c)).toBeNull();
    // A decided game is the other way the position can move on: every answer is void.
    expect(applyMove({ ...stale, winner: 1 }, action.r, action.c)).toBeNull();
  });

  it("an ability chosen before the energy was spent is refused", () => {
    const b = makeBoard(5, 5);
    own(b, 2, 2, 0, 1);
    own(b, 4, 4, 1, 1);
    const st = {
      ...newState(bots(["hard", "hard"]), 5, 5, "abilities", b),
      hasMoved: [true, true],
      energy: [100, 0],
    };
    seedRandom(7);
    const cast = castAbility(st, "overcharge", [[2, 2]]);
    expect(cast).not.toBeNull();
    // The same cast against a state whose energy has since been spent must fail.
    expect(castAbility({ ...st, energy: [10, 0] }, "overcharge", [[2, 2]])).toBeNull();
    // ...and so must one whose target changed hands.
    const taken = {
      ...st,
      board: {
        ...st.board,
        cells: st.board.cells.map((c, i) => (i === 12 ? { orbs: 1, owner: 1 } : c)),
      },
    };
    expect(castAbility(taken, "overcharge", [[2, 2]])).toBeNull();
  });

  it("out-of-range or non-integer ability targets are rejected", () => {
    const b = makeBoard(4, 4);
    own(b, 1, 1, 0, 1);
    const st = {
      ...newState(bots(["hard", "hard"]), 4, 4, "abilities", b),
      hasMoved: [true, true],
      energy: [100, 0],
    };
    for (const target of [
      [-1, 0],
      [0, -1],
      [4, 0],
      [0, 4],
      [1.5, 1],
      [Number.NaN, 1],
      [Number.POSITIVE_INFINITY, 0],
    ] as [number, number][]) {
      expect(castAbility(st, "overload", [target]), `${target}`).toBeNull();
    }
    expect(castAbility(st, "overload", []), "wrong target count").toBeNull();
    expect(
      castAbility(st, "overload", [
        [1, 1],
        [2, 2],
      ]),
      "too many targets",
    ).toBeNull();
  });
});

// ------------------------------------------------------- strength / performance

describe("adversarial AI — strength and cost", () => {
  /** An opponent that always plays the lowest-critical-mass cell it can: the classic corner camper. */
  function cornerCamper(state: GameState): { r: number; c: number } | null {
    let best: { r: number; c: number; cm: number } | null = null;
    for (let r = 0; r < state.board.rows; r++) {
      for (let c = 0; c < state.board.cols; c++) {
        if (!canPlace(state, r, c)) continue;
        const cm = effectiveCriticalMass(state.board, r, c);
        if (!best || cm < best.cm) best = { r, c, cm };
      }
    }
    return best;
  }

  it("hard holds its own against a corner-camping exploit strategy", () => {
    let hardWins = 0;
    const games = 8;
    for (let seed = 1; seed <= games; seed++) {
      seedRandom(seed * 2246822519);
      let st = newState(
        [
          { id: 0, name: "HARD", colorIndex: 0, isAI: true, difficulty: "hard" },
          { id: 1, name: "CAMP", colorIndex: 1 },
        ],
        5,
        5,
      );
      for (let i = 0; i < 300 && st.winner === null && !st.draw; i++) {
        const mine = st.players[st.currentPlayerIdx].id === 0;
        const move = mine ? chooseAIMove(st, "hard") : cornerCamper(st);
        if (!move) break;
        const res = applyMove(st, move.r, move.c);
        if (!res) break;
        st = commitMove(st, res);
      }
      if (st.winner === 0) hardWins += 1;
      vi.restoreAllMocks();
    }
    // Deliberately loose: the point is that a trivially exploitable strategy does not beat the
    // strongest bot most of the time, not that the heuristic scores any particular number.
    expect(
      hardWins,
      `hard won ${hardWins}/${games} against a corner camper`,
    ).toBeGreaterThanOrEqual(games / 2);
  });

  it("hard answers on the largest board without running away with the clock", () => {
    seedRandom(5);
    const map = getArenaMap("power-grid"); // 10x15, the biggest layout that ships
    let st = newState(bots(["hard", "hard"]), map.rows, map.cols, "arena", map.build());
    // A mid-game position is the expensive one: many legal moves and long chains.
    const rand = Math.random;
    for (let i = 0; i < 40 && st.winner === null; i++) {
      const moves: [number, number][] = [];
      for (let r = 0; r < map.rows; r++)
        for (let c = 0; c < map.cols; c++) if (canPlace(st, r, c)) moves.push([r, c]);
      st = commitMove(st, applyMove(st, ...moves[Math.floor(rand() * moves.length)])!);
    }
    const started = Date.now();
    const action = chooseAIAction(st, "hard");
    const elapsed = Date.now() - started;
    expect(action).not.toBeNull();
    // Generous for a loaded CI box; a real regression here is orders of magnitude, not percent.
    expect(elapsed, `hard took ${elapsed}ms on a 10x15`).toBeLessThan(20_000);
  });

  it("a saturated amplifier board does not make the search hang", () => {
    const map = getArenaMap("chaos");
    const board = map.build();
    for (let r = 0; r < map.rows; r++)
      for (let c = 0; c < map.cols; c++) {
        const cell = cellAt(board, r, c);
        if (cell.tile === "wall" || cell.tile === "dead") continue;
        cell.owner = (r + c) % 2;
        cell.orbs = Math.max(1, effectiveCriticalMass(board, r, c) - 1);
      }
    const st = {
      ...newState(bots(["hard", "hard"]), map.rows, map.cols, "arena", board),
      hasMoved: [true, true],
    };
    seedRandom(11);
    const started = Date.now();
    const action = chooseAIAction(st, "hard");
    const elapsed = Date.now() - started;
    expect(action).not.toBeNull();
    expect(canPlace(st, action!.r, action!.c)).toBe(true);
    expect(elapsed, `saturated board search took ${elapsed}ms`).toBeLessThan(30_000);
  });
});
