import { describe, expect, it } from "vitest";
import { mergeChallengeState, mergeModeStats, mergeProfiles, mergePuzzleProgress } from "../merge";
import {
  applyMatch,
  DEFAULT_PROFILE,
  emptyModeStats,
  type MatchOutcome,
  type PlayerProfile,
} from "../../profile";
import { applySolve, PUZZLE_ORDER, type PuzzleProgress } from "../../puzzles";
import { DAILY_POOL, freshState, WEEKLY_POOL, type ChallengeState } from "../../challenges";

function outcome(o: Partial<MatchOutcome> = {}): MatchOutcome {
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
    ...o,
  };
}

/** A profile that has played `n` winning matches. */
function played(n: number, o: Partial<MatchOutcome> = {}): PlayerProfile {
  let p = DEFAULT_PROFILE;
  for (let i = 0; i < n; i++) p = applyMatch(p, outcome({ won: true, ...o }));
  return p;
}

describe("mergeModeStats", () => {
  it("keeps the larger value for every counter", () => {
    const a = { ...emptyModeStats(), games: 5, wins: 2, largestChain: 12 };
    const b = { ...emptyModeStats(), games: 3, wins: 3, largestChain: 20 };
    const m = mergeModeStats(a, b);
    expect(m.games).toBe(5);
    expect(m.wins).toBe(3);
    expect(m.largestChain).toBe(20);
  });

  it("merges ability counts key by key, keeping keys unique to either side", () => {
    const a = { ...emptyModeStats(), abilityCounts: { shield: 4, emp: 1 } };
    const b = { ...emptyModeStats(), abilityCounts: { shield: 2, overload: 7 } };
    expect(mergeModeStats(a, b).abilityCounts).toEqual({ shield: 4, emp: 1, overload: 7 });
  });

  it("is commutative", () => {
    const a = { ...emptyModeStats(), games: 9, abilityCounts: { emp: 3 } };
    const b = { ...emptyModeStats(), wins: 4, abilityCounts: { emp: 1, shield: 2 } };
    expect(mergeModeStats(a, b)).toEqual(mergeModeStats(b, a));
  });
});

describe("mergeProfiles", () => {
  it("never loses progress: the merged total is at least each side's", () => {
    const a = played(7);
    const b = played(3, { eliminations: 2 });
    for (const m of [mergeProfiles(a, b), mergeProfiles(b, a)]) {
      expect(m.xp).toBeGreaterThanOrEqual(Math.max(a.xp, b.xp));
      expect(m.stats.classic.games).toBe(7);
      expect(m.bestMatchEliminations).toBe(2);
    }
  });

  it("is fully commutative — sync order cannot change the result", () => {
    const a = { ...played(4), username: "AAA", updatedAt: 100 };
    const b = { ...played(6), username: "BBB", updatedAt: 200 };
    expect(mergeProfiles(a, b)).toEqual(mergeProfiles(b, a));
  });

  it("orders recent matches deterministically even when timestamps tie", () => {
    // Several matches finish in the same millisecond, so `at` alone is not a total order.
    const at = 1_700_000_000_000;
    const rec = (id: string) => ({ ...played(1).recent[0], id, at });
    const a = { ...DEFAULT_PROFILE, recent: [rec("c"), rec("a")] };
    const b = { ...DEFAULT_PROFILE, recent: [rec("b"), rec("d")] };
    const ids = (p: PlayerProfile) => p.recent.map((r) => r.id);
    expect(ids(mergeProfiles(a, b))).toEqual(ids(mergeProfiles(b, a)));
    expect(ids(mergeProfiles(a, b))).toEqual(["a", "b", "c", "d"]);
  });

  it("is idempotent — syncing twice changes nothing", () => {
    const a = played(5);
    const b = played(2);
    const once = mergeProfiles(a, b);
    expect(mergeProfiles(once, b)).toEqual(once);
    expect(mergeProfiles(once, once)).toEqual(once);
  });

  it("the most recently edited side owns username and avatar", () => {
    const older = { ...played(9), username: "OLD", avatarId: "core", updatedAt: 1_000 };
    const newer = { ...played(1), username: "NEW", avatarId: "nova", updatedAt: 2_000 };
    for (const m of [mergeProfiles(older, newer), mergeProfiles(newer, older)]) {
      expect(m.username).toBe("NEW");
      expect(m.avatarId).toBe("nova");
      expect(m.xp).toBe(Math.max(older.xp, newer.xp)); // ...without losing the older side's XP
    }
  });

  it("takes the current streak from the newer side, since a streak can legitimately drop", () => {
    const stale = { ...played(5), currentStreak: 5, updatedAt: 1_000 };
    const fresh = { ...played(1), currentStreak: 0, updatedAt: 2_000 };
    const m = mergeProfiles(fresh, stale);
    expect(m.currentStreak).toBe(0);
    expect(m.longestStreak).toBe(Math.max(stale.longestStreak, fresh.longestStreak));
  });

  it("keeps the five newest recent matches across both devices, without duplicates", () => {
    const a = played(3);
    const b = played(3);
    const m = mergeProfiles(a, b);
    expect(m.recent).toHaveLength(5);
    expect(new Set(m.recent.map((r) => r.id)).size).toBe(5);
    const times = m.recent.map((r) => r.at);
    expect([...times].sort((x, y) => y - x)).toEqual(times);
  });

  it("merging with an untouched profile is a no-op", () => {
    // Distinct timestamps, so `recent` already has the one order merge could produce.
    const a = played(4);
    a.recent = a.recent.map((r, i) => ({ ...r, at: 2_000_000 - i }));
    expect(mergeProfiles(a, DEFAULT_PROFILE)).toEqual({ ...a, updatedAt: 0 });
  });
});

describe("mergePuzzleProgress", () => {
  const p0 = PUZZLE_ORDER[0];
  const p1 = PUZZLE_ORDER[1];

  it("keeps the better medal and the fewer moves", () => {
    const local: PuzzleProgress = { [p0.id]: { medal: "bronze", bestMoves: 5, xpAwarded: 100 } };
    const remote: PuzzleProgress = { [p0.id]: { medal: "gold", bestMoves: 1, xpAwarded: 200 } };
    for (const m of [mergePuzzleProgress(local, remote), mergePuzzleProgress(remote, local)]) {
      expect(m[p0.id]).toEqual({ medal: "gold", bestMoves: 1, xpAwarded: 200 });
    }
  });

  it("never lowers xpAwarded, so the same puzzle cannot pay out twice", () => {
    const local: PuzzleProgress = { [p0.id]: { medal: "gold", bestMoves: 1, xpAwarded: 200 } };
    const remote: PuzzleProgress = { [p0.id]: { medal: "gold", bestMoves: 1, xpAwarded: 0 } };
    expect(mergePuzzleProgress(local, remote)[p0.id].xpAwarded).toBe(200);
  });

  it("keeps puzzles solved on only one device", () => {
    const local = applySolve({}, p0, 1, "gold").progress;
    const remote = applySolve({}, p1, 2, "silver").progress;
    const m = mergePuzzleProgress(local, remote);
    expect(Object.keys(m).sort()).toEqual([p0.id, p1.id].sort());
  });

  it("is commutative and idempotent", () => {
    const local = applySolve(applySolve({}, p0, 3, "bronze").progress, p1, 1, "gold").progress;
    const remote = applySolve({}, p0, 1, "gold").progress;
    expect(mergePuzzleProgress(local, remote)).toEqual(mergePuzzleProgress(remote, local));
    const once = mergePuzzleProgress(local, remote);
    expect(mergePuzzleProgress(once, once)).toEqual(once);
  });
});

describe("mergeChallengeState", () => {
  const now = new Date(2026, 5, 10, 12).getTime();

  function state(over: Partial<ChallengeState> = {}): ChallengeState {
    return { ...freshState(now), ...over };
  }

  it("keeps the higher progress within the same period", () => {
    const id = DAILY_POOL[0].id;
    const a = state({ progress: { [id]: 3 } });
    const b = state({ progress: { [id]: 7 } });
    expect(mergeChallengeState(a, b).progress[id]).toBe(7);
    expect(mergeChallengeState(b, a).progress[id]).toBe(7);
  });

  it("never forgets a claim, so a reward cannot be collected twice", () => {
    const id = DAILY_POOL[0].id;
    const claimedHere = state({ claimed: { [id]: true } });
    const notClaimedThere = state();
    expect(mergeChallengeState(notClaimedThere, claimedHere).claimed[id]).toBe(true);
    expect(mergeChallengeState(claimedHere, notClaimedThere).claimed[id]).toBe(true);
  });

  it("ignores daily/weekly progress from a period that has already rolled over", () => {
    const daily = DAILY_POOL[0].id;
    const weekly = WEEKLY_POOL[0].id;
    const local = state({ progress: { [daily]: 1, [weekly]: 1 } });
    const stale = state({
      dailyKey: "2020-1-1",
      weeklyKey: "w2020-1-1",
      progress: { [daily]: 99, [weekly]: 99 },
    });
    const m = mergeChallengeState(local, stale);
    expect(m.progress[daily]).toBe(1);
    expect(m.progress[weekly]).toBe(1);
  });

  it("still merges mastery progress across different periods, because it never resets", () => {
    const local = state({ progress: { "mastery-anything": 2 } });
    const stale = state({
      dailyKey: "2020-1-1",
      weeklyKey: "w2020-1-1",
      progress: { "mastery-anything": 40 },
    });
    expect(mergeChallengeState(local, stale).progress["mastery-anything"]).toBe(40);
  });

  it("unions the distinct-key sets and keeps the larger lifetime XP", () => {
    const id = WEEKLY_POOL[0].id;
    const a = state({ sets: { [id]: ["shield", "emp"] }, xpClaimed: 300 });
    const b = state({ sets: { [id]: ["emp", "overload"] }, xpClaimed: 100 });
    const m = mergeChallengeState(a, b);
    expect([...m.sets[id]].sort()).toEqual(["emp", "overload", "shield"]);
    expect(m.xpClaimed).toBe(300);
  });

  it("is idempotent", () => {
    const id = DAILY_POOL[0].id;
    const a = state({ progress: { [id]: 4 }, claimed: { [id]: true } });
    const b = state({ progress: { [id]: 9 } });
    const once = mergeChallengeState(a, b);
    expect(mergeChallengeState(once, once)).toEqual(once);
    expect(mergeChallengeState(once, b)).toEqual(once);
  });
});
