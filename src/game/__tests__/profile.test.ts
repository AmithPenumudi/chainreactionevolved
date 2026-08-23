import { describe, it, expect } from "vitest";
import {
  applyMatch,
  avatarFor,
  DEFAULT_PROFILE,
  favoriteAbility,
  levelInfo,
  loadProfile,
  saveProfile,
  totalStats,
  xpForLevel,
  xpForMatch,
  type MatchOutcome,
  type ModeStats,
} from "../profile";

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

describe("xpForLevel / levelInfo", () => {
  it("requires 250 * level xp to advance", () => {
    expect(xpForLevel(1)).toBe(250);
    expect(xpForLevel(4)).toBe(1000);
  });

  it("starts at level 1 with 0 xp", () => {
    expect(levelInfo(0)).toEqual({ level: 1, into: 0, need: 250, pct: 0 });
  });

  it("rolls over into the next level exactly at the threshold", () => {
    const info = levelInfo(250);
    expect(info.level).toBe(2);
    expect(info.into).toBe(0);
  });

  it("computes partial progress within a level", () => {
    const info = levelInfo(100);
    expect(info.level).toBe(1);
    expect(info.into).toBe(100);
    expect(info.pct).toBe(40);
  });
});

describe("xpForMatch", () => {
  it("awards the base completion amount for a loss with no chain", () => {
    expect(xpForMatch(outcome())).toBe(25);
  });

  it("adds the win bonus, per-elimination bonus, and chain bonus", () => {
    const xp = xpForMatch(outcome({ won: true, eliminations: 2, largestChain: 12 }));
    // complete(25) + win(75) + 2*perElimination(20) + chainBonus(10-19 -> 30)
    expect(xp).toBe(25 + 75 + 40 + 30);
  });

  it("chain bonus tiers correctly at boundaries", () => {
    expect(xpForMatch(outcome({ largestChain: 4 }))).toBe(25);
    expect(xpForMatch(outcome({ largestChain: 5 }))).toBe(25 + 15);
    expect(xpForMatch(outcome({ largestChain: 10 }))).toBe(25 + 30);
    expect(xpForMatch(outcome({ largestChain: 20 }))).toBe(25 + 60);
  });
});

describe("applyMatch", () => {
  it("accumulates per-mode stats", () => {
    const p1 = applyMatch(DEFAULT_PROFILE, outcome({ won: true, eliminations: 1, cellsCaptured: 5 }));
    expect(p1.stats.classic.games).toBe(1);
    expect(p1.stats.classic.wins).toBe(1);
    expect(p1.stats.classic.eliminations).toBe(1);
    expect(p1.stats.classic.cellsCaptured).toBe(5);
    // Other modes are untouched.
    expect(p1.stats.arena.games).toBe(0);
  });

  it("tracks win streaks and resets them on a loss", () => {
    let p = DEFAULT_PROFILE;
    p = applyMatch(p, outcome({ won: true }));
    p = applyMatch(p, outcome({ won: true }));
    expect(p.currentStreak).toBe(2);
    expect(p.longestStreak).toBe(2);
    p = applyMatch(p, outcome({ won: false }));
    expect(p.currentStreak).toBe(0);
    expect(p.longestStreak).toBe(2); // longest streak is preserved
  });

  it("keeps only the most recent 5 matches", () => {
    let p = DEFAULT_PROFILE;
    for (let i = 0; i < 8; i++) p = applyMatch(p, outcome());
    expect(p.recent.length).toBe(5);
  });

  it("merges ability counts across matches", () => {
    let p = DEFAULT_PROFILE;
    p = applyMatch(p, outcome({ abilityCounts: { shield: 1 } }));
    p = applyMatch(p, outcome({ abilityCounts: { shield: 2, emp: 1 } }));
    expect(p.stats.classic.abilityCounts).toEqual({ shield: 3, emp: 1 });
  });

  it("tracks the best single-match elimination count across matches", () => {
    let p = DEFAULT_PROFILE;
    p = applyMatch(p, outcome({ eliminations: 1 }));
    p = applyMatch(p, outcome({ eliminations: 3 }));
    p = applyMatch(p, outcome({ eliminations: 2 }));
    expect(p.bestMatchEliminations).toBe(3);
  });
});

describe("totalStats", () => {
  it("sums stats across all three modes", () => {
    let p = DEFAULT_PROFILE;
    p = applyMatch(p, outcome({ mode: "classic", cellsCaptured: 3 }));
    p = applyMatch(p, outcome({ mode: "arena", cellsCaptured: 4 }));
    p = applyMatch(p, outcome({ mode: "abilities", cellsCaptured: 5 }));
    expect(totalStats(p).cellsCaptured).toBe(12);
    expect(totalStats(p).games).toBe(3);
  });
});

describe("favoriteAbility", () => {
  it("returns null when no abilities have been used", () => {
    const s: ModeStats = {
      games: 0, wins: 0, eliminations: 0, cellsCaptured: 0, explosions: 0, largestChain: 0,
      abilitiesUsed: 0, energyEarned: 0, energySpent: 0, abilityCounts: {},
      portalTransfers: 0, amplifierExplosions: 0, powerTilesCaptured: 0,
    };
    expect(favoriteAbility(s)).toBeNull();
  });

  it("returns the most-used ability", () => {
    const s: ModeStats = {
      games: 0, wins: 0, eliminations: 0, cellsCaptured: 0, explosions: 0, largestChain: 0,
      abilitiesUsed: 0, energyEarned: 0, energySpent: 0,
      abilityCounts: { shield: 3, emp: 7, fortify: 1 },
      portalTransfers: 0, amplifierExplosions: 0, powerTilesCaptured: 0,
    };
    expect(favoriteAbility(s)).toBe("emp");
  });
});

describe("avatarFor", () => {
  it("returns the matching avatar", () => {
    expect(avatarFor("nova").glyph).toBe("★");
  });

  it("falls back to the first avatar for an unknown id", () => {
    expect(avatarFor("does-not-exist").id).toBe("core");
  });
});

describe("loadProfile / saveProfile round trip", () => {
  it("returns the default profile when nothing is stored", () => {
    window.localStorage.clear();
    expect(loadProfile()).toEqual(DEFAULT_PROFILE);
  });

  it("persists and reloads a profile", () => {
    const p = applyMatch(DEFAULT_PROFILE, outcome({ won: true }));
    saveProfile(p);
    const reloaded = loadProfile();
    expect(reloaded.xp).toBe(p.xp);
    expect(reloaded.recent.length).toBe(1);
  });

  it("falls back to defaults on corrupted storage", () => {
    window.localStorage.setItem("cr-profile-v1", "{not json");
    expect(loadProfile()).toEqual(DEFAULT_PROFILE);
  });
});
