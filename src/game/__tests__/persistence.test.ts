import { describe, it, expect, beforeEach } from "vitest";
import {
  applyMatch,
  DEFAULT_PROFILE,
  levelInfo,
  loadProfile,
  saveProfile,
  totalStats,
  xpForLevel,
  xpForMatch,
  type MatchOutcome,
} from "../profile";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, speedFactor } from "../settings";
import {
  MASTERY_CHALLENGES,
  applyOutcome,
  DAILY_POOL,
  dailyKey,
  freshState,
  loadChallenges,
  msUntilDailyReset,
  msUntilWeeklyReset,
  pickDaily,
  pickWeekly,
  rollPeriods,
  saveChallenges,
  weeklyKey,
  WEEKLY_POOL,
} from "../challenges";
import {
  applySolve,
  isUnlocked,
  loadPuzzleProgress,
  PUZZLE_ORDER,
  PUZZLES,
  savePuzzleProgress,
} from "../puzzles";

const KEYS = ["cr-profile-v1", "cr-settings-v1", "cr-challenges-v1", "cr_puzzles_v1"];

const ALL_DEFS = [...DAILY_POOL, ...WEEKLY_POOL, ...MASTERY_CHALLENGES];

beforeEach(() => {
  window.localStorage.clear();
});

/** Every kind of garbage a damaged / hand-edited / older-version store might hold. */
const GARBAGE = [
  "",
  "{",
  "not json",
  "null",
  "undefined",
  "5",
  '"a string"',
  "[]",
  "[1,2,3]",
  "true",
  '{"xp":"abc"}',
  '{"stats":null,"recent":{}}',
  '{"stats":{"classic":"x","abilities":[],"arena":5},"recent":"oops"}',
  '{"xp":-500,"currentStreak":-3,"sfxVolume":"loud"}',
  '{"xp":1e308}',
  '{"recent":[null,1,"x",{"id":5}]}',
  '{"dailyIds":"nope","progress":[],"claimed":5,"sets":{"a":"b"}}',
];

describe("corrupt storage never crashes a load", () => {
  for (const key of KEYS) {
    it(`${key}: survives every kind of garbage`, () => {
      for (const junk of GARBAGE) {
        window.localStorage.setItem(key, junk);
        expect(() => loadProfile(), junk).not.toThrow();
        expect(() => loadSettings(), junk).not.toThrow();
        expect(() => loadChallenges(), junk).not.toThrow();
        expect(() => loadPuzzleProgress(), junk).not.toThrow();
      }
    });
  }

  it("localStorage that throws on read (blocked storage) falls back to defaults", () => {
    const orig = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error("SecurityError");
    };
    try {
      expect(loadProfile()).toEqual(DEFAULT_PROFILE);
      expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
      expect(loadPuzzleProgress()).toEqual({});
      expect(loadChallenges().dailyIds).toHaveLength(3);
    } finally {
      Storage.prototype.getItem = orig;
    }
  });

  it("localStorage that throws on write (quota / private mode) is swallowed", () => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    try {
      expect(() => saveProfile(DEFAULT_PROFILE)).not.toThrow();
      expect(() => saveSettings(DEFAULT_SETTINGS)).not.toThrow();
      expect(() => saveChallenges(freshState())).not.toThrow();
      expect(() => savePuzzleProgress({})).not.toThrow();
    } finally {
      Storage.prototype.setItem = orig;
    }
  });
});

describe("profile — sanitising", () => {
  it("wrong-typed fields are replaced, never propagated", () => {
    window.localStorage.setItem(
      "cr-profile-v1",
      JSON.stringify({
        username: 42,
        avatarId: "not-an-avatar",
        xp: "999",
        currentStreak: -4,
        recent: { a: 1 },
        stats: { classic: { games: "many", abilityCounts: { nova: "x", shield: 3 } } },
      }),
    );
    const p = loadProfile();
    expect(p.username).toBe("PLAYER");
    expect(p.avatarId).toBe("core");
    expect(p.xp).toBe(0);
    expect(p.currentStreak).toBe(0);
    expect(p.recent).toEqual([]);
    expect(p.stats.classic.games).toBe(0);
    expect(p.stats.classic.abilityCounts).toEqual({ nova: 0, shield: 3 });
    // and the profile is still usable end to end
    expect(() => applyMatch(p, outcome())).not.toThrow();
    expect(() => totalStats(p)).not.toThrow();
  });

  it("an absurd XP value cannot hang level calculation", () => {
    window.localStorage.setItem("cr-profile-v1", JSON.stringify({ xp: 1e308 }));
    const t0 = Date.now();
    const info = levelInfo(loadProfile().xp);
    expect(Date.now() - t0).toBeLessThan(200);
    expect(Number.isFinite(info.level)).toBe(true);
  });

  it("username is trimmed and length-capped", () => {
    window.localStorage.setItem(
      "cr-profile-v1",
      JSON.stringify({ username: "  " + "x".repeat(100) }),
    );
    expect(loadProfile().username.length).toBeLessThanOrEqual(24);
    window.localStorage.setItem("cr-profile-v1", JSON.stringify({ username: "   " }));
    expect(loadProfile().username).toBe("PLAYER");
  });

  it("longestStreak is never below currentStreak", () => {
    window.localStorage.setItem(
      "cr-profile-v1",
      JSON.stringify({ currentStreak: 7, longestStreak: 2 }),
    );
    expect(loadProfile().longestStreak).toBe(7);
  });

  it("a valid saved profile round-trips unchanged", () => {
    const p = applyMatch(applyMatch(DEFAULT_PROFILE, outcome({ won: true })), outcome());
    saveProfile(p);
    expect(loadProfile()).toEqual(p);
  });

  it("recent matches keep only well-formed entries, capped at 5", () => {
    let p = DEFAULT_PROFILE;
    for (let i = 0; i < 9; i++) p = applyMatch(p, outcome({ won: i % 2 === 0 }));
    expect(p.recent).toHaveLength(5);
    saveProfile(p);
    expect(loadProfile().recent).toHaveLength(5);
  });
});

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

describe("levelInfo — boundaries", () => {
  /** Reference implementation: the original per-level loop. */
  function slow(xp: number) {
    let level = 1;
    let remaining = Math.max(0, Math.floor(xp));
    while (remaining >= xpForLevel(level)) {
      remaining -= xpForLevel(level);
      level += 1;
    }
    return { level, into: remaining };
  }

  it("matches the original loop for every XP value up to 200k, incl. every boundary", () => {
    for (let xp = 0; xp <= 200_000; xp += 1) {
      const a = levelInfo(xp);
      const b = slow(xp);
      if (a.level !== b.level || a.into !== b.into) {
        throw new Error(`xp ${xp}: got L${a.level}+${a.into}, expected L${b.level}+${b.into}`);
      }
    }
  });

  it("handles negative, fractional, NaN and Infinity", () => {
    expect(levelInfo(-100).level).toBe(1);
    expect(levelInfo(249.9).level).toBe(1);
    expect(levelInfo(250).level).toBe(2);
    expect(levelInfo(NaN).level).toBe(1);
    expect(levelInfo(Infinity).level).toBe(1);
    expect(levelInfo(0).pct).toBe(0);
  });

  it("pct is always within 0..100", () => {
    for (const xp of [0, 1, 249, 250, 749, 750, 1e6]) {
      const { pct } = levelInfo(xp);
      expect(pct).toBeGreaterThanOrEqual(0);
      expect(pct).toBeLessThanOrEqual(100);
    }
  });
});

describe("profile — match accounting edge cases", () => {
  it("a loss resets the streak but keeps the longest", () => {
    let p = DEFAULT_PROFILE;
    p = applyMatch(p, outcome({ won: true }));
    p = applyMatch(p, outcome({ won: true }));
    p = applyMatch(p, outcome({ won: false }));
    expect(p.currentStreak).toBe(0);
    expect(p.longestStreak).toBe(2);
  });

  it("stats land in the correct mode bucket and never mutate the previous profile", () => {
    const before = JSON.stringify(DEFAULT_PROFILE);
    const p = applyMatch(
      DEFAULT_PROFILE,
      outcome({ mode: "arena", won: true, portalTransfers: 3 }),
    );
    expect(p.stats.arena.games).toBe(1);
    expect(p.stats.arena.portalTransfers).toBe(3);
    expect(p.stats.classic.games).toBe(0);
    expect(JSON.stringify(DEFAULT_PROFILE)).toBe(before);
  });

  it("chain bonus thresholds are exact (4→0, 5→15, 10→30, 20→60)", () => {
    const xp = (n: number) => xpForMatch(outcome({ largestChain: n })) - 25;
    expect([xp(4), xp(5), xp(9), xp(10), xp(19), xp(20), xp(500)]).toEqual([
      0, 15, 15, 30, 30, 60, 60,
    ]);
  });
});

describe("settings — sanitising", () => {
  it("out-of-range volumes are clamped, bad types fall back", () => {
    window.localStorage.setItem(
      "cr-settings-v1",
      JSON.stringify({
        sfxVolume: 900,
        musicVolume: -5,
        chainSpeed: "turbo",
        music: "yes",
        orbMotion: 0,
      }),
    );
    const s = loadSettings();
    expect(s.sfxVolume).toBe(100);
    expect(s.musicVolume).toBe(0);
    expect(s.chainSpeed).toBe("normal");
    expect(s.music).toBe(DEFAULT_SETTINGS.music);
    expect(s.orbMotion).toBe(DEFAULT_SETTINGS.orbMotion);
  });

  it("unknown keys from other versions are dropped and missing keys default", () => {
    window.localStorage.setItem(
      "cr-settings-v1",
      JSON.stringify({ futureFlag: true, music: true }),
    );
    const s = loadSettings() as unknown as Record<string, unknown>;
    expect(s.futureFlag).toBeUndefined();
    expect(s.music).toBe(true);
    expect(s.masterSound).toBe(true);
  });

  it("speedFactor: reduced motion beats every chain speed", () => {
    for (const chainSpeed of ["slow", "normal", "fast"] as const) {
      expect(speedFactor({ ...DEFAULT_SETTINGS, chainSpeed, reducedMotion: true })).toBe(0.45);
    }
    expect(speedFactor({ ...DEFAULT_SETTINGS, chainSpeed: "slow" })).toBeGreaterThan(1);
    expect(speedFactor({ ...DEFAULT_SETTINGS, chainSpeed: "fast" })).toBeLessThan(1);
  });

  it("round-trips", () => {
    const s = { ...DEFAULT_SETTINGS, music: true, sfxVolume: 12, chainSpeed: "fast" as const };
    saveSettings(s);
    expect(loadSettings()).toEqual(s);
  });
});

describe("challenges — robustness", () => {
  it("daily / weekly rotation terminates and yields distinct valid ids for 20 years of dates", () => {
    const start = new Date(2025, 0, 1).getTime();
    for (let d = 0; d < 20 * 366; d++) {
      const t = start + d * 86_400_000;
      const daily = pickDaily(dailyKey(t));
      const weekly = pickWeekly(weeklyKey(t));
      expect(new Set(daily).size).toBe(3);
      expect(new Set(weekly).size).toBe(5);
      expect(daily.every((id) => DAILY_POOL.some((x) => x.id === id))).toBe(true);
      expect(weekly.every((id) => WEEKLY_POOL.some((x) => x.id === id))).toBe(true);
    }
  });

  it("daily and weekly pools never share a challenge id (period rollover deletes by id)", () => {
    const daily = new Set(DAILY_POOL.map((d) => d.id));
    expect(WEEKLY_POOL.filter((w) => daily.has(w.id))).toEqual([]);
    expect(ALL_DEFS.length).toBeGreaterThan(0);
    const ids = ALL_DEFS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("reset countdowns are always within their period, including at DST-ish boundaries", () => {
    const start = new Date(2026, 0, 1).getTime();
    for (let h = 0; h < 24 * 400; h += 7) {
      const t = start + h * 3_600_000;
      const d = msUntilDailyReset(t);
      const w = msUntilWeeklyReset(t);
      expect(d).toBeGreaterThan(0);
      expect(d).toBeLessThanOrEqual(25 * 3_600_000);
      expect(w).toBeGreaterThan(0);
      expect(w).toBeLessThanOrEqual(7 * 25 * 3_600_000);
    }
  });

  it("rolling to the next day resets only the daily set; weekly progress survives midweek", () => {
    const monday = new Date(2026, 2, 2, 12).getTime(); // a Monday
    let s = freshState(monday);
    s = { ...s, progress: { [s.dailyIds[0]]: 1, [s.weeklyIds[0]]: 1, "mastery-x": 4 } };
    const tuesday = monday + 86_400_000;
    const rolled = rollPeriods(s, tuesday);
    expect(rolled.dailyKey).not.toBe(s.dailyKey);
    expect(rolled.weeklyKey).toBe(s.weeklyKey);
    expect(rolled.progress[s.dailyIds[0]]).toBeUndefined();
    expect(rolled.progress[s.weeklyIds[0]]).toBe(1);
    expect(rolled.progress["mastery-x"]).toBe(4);
  });

  it("a stored state from long ago is rolled forward on load", () => {
    const old = freshState(new Date(2020, 5, 5).getTime());
    old.progress = { [old.dailyIds[0]]: 1 };
    saveChallenges(old);
    const loaded = loadChallenges();
    expect(loaded.dailyKey).toBe(dailyKey());
    expect(loaded.weeklyKey).toBe(weeklyKey());
  });

  it("unknown challenge ids in storage are replaced instead of crashing the screen", () => {
    const s = freshState();
    window.localStorage.setItem(
      "cr-challenges-v1",
      JSON.stringify({ ...s, dailyIds: ["ghost-1", "ghost-2", "ghost-3"] }),
    );
    const loaded = loadChallenges();
    expect(loaded.dailyIds).toHaveLength(3);
    expect(loaded.dailyIds.every((id) => !id.startsWith("ghost"))).toBe(true);
  });

  it("applyOutcome never lets progress exceed the goal and ignores claimed challenges", () => {
    let s = freshState();
    for (let i = 0; i < 40; i++)
      s = applyOutcome(
        s,
        outcome({ won: true, eliminations: 3, largestChain: 25, explosions: 50 }),
      );
    for (const [id, v] of Object.entries(s.progress)) {
      const def = ALL_DEFS.find((d) => d.id === id)!;
      if (def.accumulate !== "max") expect(v, id).toBeLessThanOrEqual(def.goal);
    }
    const id = s.dailyIds[0];
    const claimed = { ...s, claimed: { [id]: true }, progress: { ...s.progress, [id]: 0 } };
    const after = applyOutcome(claimed, outcome({ won: true, eliminations: 3, largestChain: 25 }));
    expect(after.progress[id] ?? 0).toBe(0);
  });
});

describe("puzzle progress", () => {
  it("only the first puzzle is unlocked on a fresh install; solving unlocks the next in order", () => {
    let progress = {};
    expect(PUZZLE_ORDER.filter((p) => isUnlocked(progress, p))).toHaveLength(1);
    for (let i = 0; i < PUZZLE_ORDER.length - 1; i++) {
      const def = PUZZLE_ORDER[i];
      progress = applySolve(progress, def, def.medals.gold, "gold").progress;
      expect(isUnlocked(progress, PUZZLE_ORDER[i + 1]), `after ${def.id}`).toBe(true);
    }
  });

  it("improving a medal pays only the XP difference; a worse replay pays nothing and keeps the best", () => {
    const def = PUZZLES[0];
    let r = applySolve({}, def, 3, "bronze");
    const first = r.xpGained;
    expect(first).toBe(Math.round(def.xp * 0.5));
    r = applySolve(r.progress, def, 1, "gold");
    expect(first + r.xpGained).toBe(def.xp);
    const again = applySolve(r.progress, def, 3, "bronze");
    expect(again.xpGained).toBe(0);
    expect(again.progress[def.id].medal).toBe("gold");
    expect(again.progress[def.id].bestMoves).toBe(1);
  });

  it("damaged puzzle records are dropped individually, good ones survive", () => {
    window.localStorage.setItem(
      "cr_puzzles_v1",
      JSON.stringify({
        good: { medal: "gold", bestMoves: 1, xpAwarded: 100 },
        bad1: { medal: "platinum", bestMoves: 1, xpAwarded: 1 },
        bad2: { medal: "gold", bestMoves: "x", xpAwarded: 1 },
        bad3: null,
      }),
    );
    expect(Object.keys(loadPuzzleProgress())).toEqual(["good"]);
  });
});
