import { describe, it, expect } from "vitest";
import {
  activeDefs,
  applyOutcome,
  challengeById,
  claimableCount,
  dailyKey,
  DAILY_POOL,
  formatCountdown,
  freshState,
  isComplete,
  MASTERY_CHALLENGES,
  pickDaily,
  pickWeekly,
  progressOf,
  rollPeriods,
  weeklyKey,
  WEEKLY_POOL,
} from "../challenges";
import type { MatchOutcome } from "../profile";

function outcome(overrides: Partial<MatchOutcome> = {}): MatchOutcome {
  return {
    mode: "classic",
    won: false,
    players: 2,
    turns: 10,
    eliminations: 0,
    cellsCaptured: 0,
    explosions: 0,
    largestChain: 0,
    abilitiesUsed: 0,
    energyEarned: 0,
    energySpent: 0,
    abilityCounts: {},
    portalTransfers: 0,
    amplifierExplosions: 0,
    powerTilesCaptured: 0,
    ...overrides,
  };
}

describe("dailyKey / weeklyKey", () => {
  it("formats a daily key as year-month-day", () => {
    // 2026-03-05 12:00:00 local
    const t = new Date(2026, 2, 5, 12).getTime();
    expect(dailyKey(t)).toBe("2026-3-5");
  });

  it("weeklyKey resolves to the same Monday for every day in that week", () => {
    // Monday 2026-03-02 through Sunday 2026-03-08
    const monday = new Date(2026, 2, 2, 10).getTime();
    const wednesday = new Date(2026, 2, 4, 23).getTime();
    const sunday = new Date(2026, 2, 8, 0, 1).getTime();
    expect(weeklyKey(monday)).toBe(weeklyKey(wednesday));
    expect(weeklyKey(monday)).toBe(weeklyKey(sunday));
  });

  it("weeklyKey changes across a Monday boundary", () => {
    const sunday = new Date(2026, 2, 8, 23).getTime();
    const nextMonday = new Date(2026, 2, 9, 1).getTime();
    expect(weeklyKey(sunday)).not.toBe(weeklyKey(nextMonday));
  });
});

describe("formatCountdown", () => {
  it("formats hours and minutes when under a day", () => {
    expect(formatCountdown(3 * 3600_000 + 20 * 60_000)).toBe("3h 20m");
  });

  it("formats days and hours when a day or more remains", () => {
    expect(formatCountdown(2 * 86_400_000 + 5 * 3600_000)).toBe("2d 5h");
  });
});

describe("pickDaily / pickWeekly", () => {
  it("is deterministic for the same key", () => {
    expect(pickDaily("2026-3-5")).toEqual(pickDaily("2026-3-5"));
    expect(pickWeekly("w2026-3-2")).toEqual(pickWeekly("w2026-3-2"));
  });

  it("picks the configured count with no duplicates", () => {
    const daily = pickDaily("2026-3-5");
    expect(daily.length).toBe(3);
    expect(new Set(daily).size).toBe(3);

    const weekly = pickWeekly("w2026-3-2");
    expect(weekly.length).toBe(5);
    expect(new Set(weekly).size).toBe(5);
  });

  it("only picks ids that exist in the respective pool", () => {
    const dailyIds = new Set(DAILY_POOL.map((c) => c.id));
    for (const id of pickDaily("2026-1-1")) expect(dailyIds.has(id)).toBe(true);

    const weeklyIds = new Set(WEEKLY_POOL.map((c) => c.id));
    for (const id of pickWeekly("w2026-1-1")) expect(weeklyIds.has(id)).toBe(true);
  });
});

describe("challengeById", () => {
  it("finds challenges across all three pools", () => {
    expect(challengeById(DAILY_POOL[0].id)?.id).toBe(DAILY_POOL[0].id);
    expect(challengeById(WEEKLY_POOL[0].id)?.id).toBe(WEEKLY_POOL[0].id);
    expect(challengeById(MASTERY_CHALLENGES[0].id)?.id).toBe(MASTERY_CHALLENGES[0].id);
  });

  it("returns undefined for an unknown id", () => {
    expect(challengeById("nope")).toBeUndefined();
  });
});

describe("rollPeriods", () => {
  it("keeps state unchanged within the same day/week", () => {
    const now = new Date(2026, 2, 5, 10).getTime();
    const state = freshState(now);
    const rolled = rollPeriods(state, now + 3600_000);
    expect(rolled).toEqual(state);
  });

  it("repicks daily ids and clears their progress once the day rolls over", () => {
    const day1 = new Date(2026, 2, 5, 10).getTime();
    const day2 = new Date(2026, 2, 6, 10).getTime();
    let state = freshState(day1);
    state = {
      ...state,
      progress: { [state.dailyIds[0]]: 5 },
      claimed: { [state.dailyIds[0]]: false },
    };

    const rolled = rollPeriods(state, day2);
    expect(rolled.dailyKey).toBe(dailyKey(day2));
    expect(rolled.progress[state.dailyIds[0]]).toBeUndefined();
  });
});

describe("applyOutcome", () => {
  it("increments sum-accumulated challenge progress", () => {
    const now = new Date(2026, 2, 5, 10).getTime();
    let state = freshState(now);
    state = applyOutcome(state, outcome({ explosions: 6 }), now);
    state = applyOutcome(state, outcome({ explosions: 5 }), now);
    const def = challengeById("d-chain-starter")!;
    expect(progressOf(state, def)).toBe(10); // clamped to goal (10)
  });

  it("uses max accumulation for chain-mastery challenges", () => {
    const now = new Date(2026, 2, 5, 10).getTime();
    let state = freshState(now);
    state = applyOutcome(state, outcome({ largestChain: 15 }), now);
    state = applyOutcome(state, outcome({ largestChain: 8 }), now);
    const def = challengeById("m-chain-1")!; // goal 10
    expect(progressOf(state, def)).toBe(10); // clamped to goal, from the 15-chain match
  });

  it("uses union accumulation for the full-arsenal challenge", () => {
    const now = new Date(2026, 2, 5, 10).getTime();
    let state = freshState(now);
    state = applyOutcome(state, outcome({ abilityCounts: { shield: 1, emp: 2 } }), now);
    state = applyOutcome(state, outcome({ abilityCounts: { shield: 1, fortify: 1 } }), now);
    const def = challengeById("m-abil-all")!;
    expect(progressOf(state, def)).toBe(3); // distinct: shield, emp, fortify
  });

  it("does not update progress for an already-claimed challenge", () => {
    const now = new Date(2026, 2, 5, 10).getTime();
    let state = freshState(now);
    state = { ...state, claimed: { "d-chain-starter": true } };
    state = applyOutcome(state, outcome({ explosions: 10 }), now);
    expect(state.progress["d-chain-starter"]).toBeUndefined();
  });
});

describe("isComplete / claimableCount", () => {
  it("marks a challenge complete once progress reaches its goal", () => {
    const now = new Date(2026, 2, 5, 10).getTime();
    let state = freshState(now);
    const def = challengeById("d-victor")!; // goal 1
    state = applyOutcome(state, outcome({ won: true }), now);
    expect(isComplete(state, def)).toBe(true);
  });

  it("counts claimable (complete, unclaimed) challenges", () => {
    const now = new Date(2026, 2, 5, 10).getTime();
    let state = freshState(now);
    state = applyOutcome(state, outcome({ won: true, explosions: 99, cellsCaptured: 99 }), now);
    const before = claimableCount(state);
    expect(before).toBeGreaterThan(0);

    // Claiming one should reduce the count.
    const completedId = activeDefs(state, "daily").find((d) => isComplete(state, d))!.id;
    state = { ...state, claimed: { ...state.claimed, [completedId]: true } };
    expect(claimableCount(state)).toBe(before - 1);
  });
});
