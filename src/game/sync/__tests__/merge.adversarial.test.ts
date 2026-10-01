import { describe, expect, it } from "vitest";
import { mergeChallengeState, mergeModeStats, mergeProfiles, mergePuzzleProgress } from "../merge";
import { mergeData, type PlayerData } from "../sync";
import { applyMatch, DEFAULT_PROFILE, type MatchOutcome, type PlayerProfile } from "../../profile";
import { applySolve, PUZZLE_ORDER, type Medal, type PuzzleProgress } from "../../puzzles";
import { DAILY_POOL, WEEKLY_POOL, freshState, type ChallengeState } from "../../challenges";

/*
 * Adversarial sync suite.
 *
 * The merge layer claims three properties, and the whole design leans on them: it is commutative
 * (so it does not matter which device syncs first), idempotent (so a retry cannot change the
 * result), and it settles to a fixed point (so sync stops writing instead of looping). This file
 * tries to break each one with the shapes a real pair of devices actually produce — two phones in
 * different time zones, one that rolled over to a new day and one that has not, two that were
 * never renamed, and the same pass run twice.
 */

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

/** A profile shaped by a random run of matches, so the merge sees realistic contents. */
function randomProfile(rand: () => number): PlayerProfile {
  let p: PlayerProfile = { ...DEFAULT_PROFILE };
  const names = ["PLAYER", "ALPHA", "BETA", "ZED"];
  const avatars = ["core", "spark", "orbit", "nova"];
  for (let i = 0; i < Math.floor(rand() * 8); i++) {
    p = applyMatch(
      p,
      outcome({
        mode: (["classic", "abilities", "arena"] as const)[Math.floor(rand() * 3)],
        won: rand() < 0.5,
        eliminations: Math.floor(rand() * 4),
        cellsCaptured: Math.floor(rand() * 30),
        explosions: Math.floor(rand() * 40),
        largestChain: Math.floor(rand() * 15),
        abilitiesUsed: Math.floor(rand() * 5),
        abilityCounts: rand() < 0.5 ? { overload: 1 } : { shield: 2 },
      }),
    );
  }
  if (rand() < 0.7) {
    p = {
      ...p,
      username: names[Math.floor(rand() * names.length)],
      avatarId: avatars[Math.floor(rand() * avatars.length)],
      // A tie on `updatedAt` is the common case, not a freak one: a player who never renamed
      // leaves it at 0 on every device.
      updatedAt: rand() < 0.5 ? 0 : Math.floor(rand() * 3) * 1000,
    };
  }
  return p;
}

function randomPuzzles(rand: () => number): PuzzleProgress {
  const medals: Medal[] = ["gold", "silver", "bronze"];
  let prog: PuzzleProgress = {};
  for (const def of PUZZLE_ORDER.slice(0, 8)) {
    if (rand() < 0.5) continue;
    prog = applySolve(
      prog,
      def,
      1 + Math.floor(rand() * 6),
      medals[Math.floor(rand() * medals.length)],
    ).progress;
  }
  return prog;
}

function randomChallenges(rand: () => number): ChallengeState {
  const day = 1 + Math.floor(rand() * 12);
  const base: ChallengeState = {
    ...freshState(),
    dailyKey: `2026-1-${day}`,
    weeklyKey: `w2026-1-${1 + Math.floor(rand() * 3) * 7}`,
    dailyIds: DAILY_POOL.slice(0, 3).map((d) => d.id),
    weeklyIds: WEEKLY_POOL.slice(0, 5).map((d) => d.id),
    progress: {},
    claimed: {},
    sets: {},
    xpClaimed: Math.floor(rand() * 500),
  };
  for (const d of [...DAILY_POOL.slice(0, 3), ...WEEKLY_POOL.slice(0, 5)]) {
    if (rand() < 0.6) base.progress[d.id] = Math.floor(rand() * d.goal * 1.5);
    if (rand() < 0.3) base.claimed[d.id] = true;
    if (rand() < 0.3) base.sets[d.id] = ["a", "b", "c"].slice(0, 1 + Math.floor(rand() * 3));
  }
  return base;
}

function randomData(rand: () => number): PlayerData {
  return {
    profile: randomProfile(rand),
    puzzles: randomPuzzles(rand),
    challenges: randomChallenges(rand),
  };
}

const j = (v: unknown) => JSON.stringify(v);

// -------------------------------------------------------------- commutativity

describe("adversarial sync — commutativity", () => {
  it("every merge gives the same answer whichever side is passed first", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rand = rng(seed * 2246822519);
      const a = randomData(rand);
      const b = randomData(rand);
      expect(j(mergeProfiles(a.profile, b.profile)), `seed ${seed}: profiles`).toBe(
        j(mergeProfiles(b.profile, a.profile)),
      );
      expect(j(mergePuzzleProgress(a.puzzles, b.puzzles)), `seed ${seed}: puzzles`).toBe(
        j(mergePuzzleProgress(b.puzzles, a.puzzles)),
      );
      expect(j(mergeChallengeState(a.challenges, b.challenges)), `seed ${seed}: challenges`).toBe(
        j(mergeChallengeState(b.challenges, a.challenges)),
      );
      expect(j(mergeModeStats(a.profile.stats.classic, b.profile.stats.classic))).toBe(
        j(mergeModeStats(b.profile.stats.classic, a.profile.stats.classic)),
      );
    }
  });

  it("two devices that were never renamed agree on a name instead of trading it back and forth", () => {
    // Both at updatedAt 0 with different defaults. Keeping "whatever this device shows" meant each
    // side merged to its own name, wrote it, read the other's back and wrote again — a sync that
    // never reaches a fixed point and therefore never stops writing.
    const a = { ...DEFAULT_PROFILE, username: "ALPHA", updatedAt: 0 };
    const b = { ...DEFAULT_PROFILE, username: "BETA", updatedAt: 0 };
    expect(mergeProfiles(a, b).username).toBe(mergeProfiles(b, a).username);
    // A real edit still wins outright.
    const renamed = { ...b, username: "RENAMED", updatedAt: 5000 };
    expect(mergeProfiles(a, renamed).username).toBe("RENAMED");
    expect(mergeProfiles(renamed, a).username).toBe("RENAMED");
  });

  it("devices in different time zones settle on one period key", () => {
    // `dailyKey` is built from the device's local calendar day, so a phone and a tablet either side
    // of a date line disagree permanently. Keeping the caller's key made every sync a fresh write.
    const east: ChallengeState = { ...freshState(), dailyKey: "2026-3-9", weeklyKey: "w2026-3-9" };
    const west: ChallengeState = { ...freshState(), dailyKey: "2026-3-8", weeklyKey: "w2026-3-2" };
    const ab = mergeChallengeState(east, west);
    const ba = mergeChallengeState(west, east);
    expect(ab.dailyKey).toBe(ba.dailyKey);
    expect(ab.weeklyKey).toBe(ba.weeklyKey);
    expect(ab.dailyKey, "the later period wins").toBe("2026-3-9");
  });

  it("period keys are compared chronologically, not as strings", () => {
    // Unpadded keys sort wrong: "2026-1-9" > "2026-1-10" as text.
    const ninth: ChallengeState = { ...freshState(), dailyKey: "2026-1-9" };
    const tenth: ChallengeState = { ...freshState(), dailyKey: "2026-1-10" };
    expect(mergeChallengeState(ninth, tenth).dailyKey).toBe("2026-1-10");
    expect(mergeChallengeState(tenth, ninth).dailyKey).toBe("2026-1-10");
  });
});

// ----------------------------------------------------- idempotence / fixed point

describe("adversarial sync — idempotence and the fixed point", () => {
  it("merging a result with itself changes nothing", () => {
    for (let seed = 1; seed <= 150; seed++) {
      const rand = rng(seed * 374761393);
      const merged = mergeData(randomData(rand), randomData(rand));
      expect(j(mergeData(merged, merged)), `seed ${seed}`).toBe(j(merged));
    }
  });

  it("a second sync pass produces no further change, so sync stops writing", () => {
    for (let seed = 1; seed <= 150; seed++) {
      const rand = rng(seed * 3266489917);
      const local = randomData(rand);
      const remote = randomData(rand);
      // Pass 1: this device merges and both sides now hold `first`.
      const first = mergeData(local, remote);
      // Pass 2 from either device must be a no-op, or every pass triggers another write.
      expect(j(mergeData(first, first)), `seed ${seed}: same device`).toBe(j(first));
      expect(j(mergeData(remote, first)), `seed ${seed}: the other device`).toBe(
        j(mergeData(first, remote)),
      );
      const second = mergeData(mergeData(remote, first), first);
      const third = mergeData(second, first);
      expect(j(third), `seed ${seed}: reached a fixed point`).toBe(j(second));
    }
  });

  it("merging is associative enough for three devices to converge on one answer", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const rand = rng(seed * 668265263);
      const a = randomData(rand);
      const b = randomData(rand);
      const c = randomData(rand);
      const left = mergeData(mergeData(a, b), c);
      const right = mergeData(a, mergeData(b, c));
      // Not required to agree on the first pass, but one more round must settle them.
      expect(j(mergeData(left, right)), `seed ${seed}`).toBe(j(mergeData(right, left)));
    }
  });
});

// ------------------------------------------------------------------ no data loss

describe("adversarial sync — nothing is lost and nothing is paid twice", () => {
  it("no counter ever comes back smaller than either side had", () => {
    for (let seed = 1; seed <= 120; seed++) {
      const rand = rng(seed * 2135587861);
      const a = randomData(rand);
      const b = randomData(rand);
      const m = mergeData(a, b);
      expect(m.profile.xp).toBeGreaterThanOrEqual(Math.max(a.profile.xp, b.profile.xp));
      expect(m.profile.longestStreak).toBeGreaterThanOrEqual(
        Math.max(a.profile.longestStreak, b.profile.longestStreak),
      );
      for (const mode of ["classic", "abilities", "arena"] as const) {
        expect(m.profile.stats[mode].games).toBeGreaterThanOrEqual(
          Math.max(a.profile.stats[mode].games, b.profile.stats[mode].games),
        );
        expect(m.profile.stats[mode].wins).toBeGreaterThanOrEqual(
          Math.max(a.profile.stats[mode].wins, b.profile.stats[mode].wins),
        );
      }
      for (const id of new Set([...Object.keys(a.puzzles), ...Object.keys(b.puzzles)])) {
        const best = Math.max(a.puzzles[id]?.xpAwarded ?? 0, b.puzzles[id]?.xpAwarded ?? 0);
        expect(m.puzzles[id]?.xpAwarded ?? 0, `puzzle ${id}`).toBe(best);
      }
      expect(m.challenges.xpClaimed).toBeGreaterThanOrEqual(
        Math.max(a.challenges.xpClaimed, b.challenges.xpClaimed),
      );
    }
  });

  it("a puzzle never pays out twice and its best result only improves", () => {
    const def = PUZZLE_ORDER[0];
    const a = applySolve({}, def, 3, "gold").progress;
    const b = applySolve({}, def, 7, "bronze").progress;
    const m = mergePuzzleProgress(a, b);
    expect(m[def.id].bestMoves).toBe(3);
    expect(m[def.id].medal, "the better medal wins").toBe("gold");
    expect(m[def.id].xpAwarded).toBe(Math.max(a[def.id].xpAwarded, b[def.id].xpAwarded));
    // Re-merging cannot inflate the payout.
    expect(mergePuzzleProgress(m, m)[def.id].xpAwarded).toBe(m[def.id].xpAwarded);
    expect(mergePuzzleProgress(b, a)[def.id].xpAwarded).toBe(m[def.id].xpAwarded);
  });

  it("a claim made in the current period is never forgotten", () => {
    const d = DAILY_POOL[0].id;
    const key = "2026-2-4";
    const local: ChallengeState = { ...freshState(), dailyKey: key, claimed: {}, progress: {} };
    const remote: ChallengeState = {
      ...freshState(),
      dailyKey: key,
      claimed: { [d]: true },
      progress: { [d]: 9 },
    };
    expect(mergeChallengeState(local, remote).claimed[d], "a claim would be paid twice").toBe(true);
    expect(mergeChallengeState(remote, local).claimed[d]).toBe(true);
  });
});

// -------------------------------------------------------- the rollover regression

describe("adversarial sync — a period rollover", () => {
  const d = DAILY_POOL[0].id;
  const w = WEEKLY_POOL[0].id;

  it("a claim from yesterday does not come back and lock today's challenge", () => {
    // The daily pool rotates and repeats, so the same id comes round again. A device that rolled
    // over deletes the claim locally; pulling the other device's stale `claimed: true` back in made
    // the fresh challenge look already-claimed, and the player simply never got that reward.
    const rolled: ChallengeState = {
      ...freshState(),
      dailyKey: "2026-2-5",
      dailyIds: [d],
      progress: {},
      claimed: {},
    };
    const behind: ChallengeState = {
      ...freshState(),
      dailyKey: "2026-2-4",
      dailyIds: [d],
      progress: { [d]: 4 },
      claimed: { [d]: true },
    };
    for (const m of [mergeChallengeState(rolled, behind), mergeChallengeState(behind, rolled)]) {
      expect(m.dailyKey).toBe("2026-2-5");
      expect(m.claimed[d], "a stale claim survived the rollover").toBeUndefined();
      expect(m.progress[d], "stale progress survived the rollover").toBeUndefined();
    }
  });

  it("the same holds for a weekly rollover, and mastery is never dropped", () => {
    const mastery = "m-something-not-in-either-pool";
    const rolled: ChallengeState = {
      ...freshState(),
      weeklyKey: "w2026-2-9",
      weeklyIds: [w],
      progress: { [mastery]: 12 },
      claimed: { [mastery]: true },
    };
    const behind: ChallengeState = {
      ...freshState(),
      weeklyKey: "w2026-2-2",
      weeklyIds: [w],
      progress: { [w]: 3, [mastery]: 4 },
      claimed: { [w]: true },
    };
    for (const m of [mergeChallengeState(rolled, behind), mergeChallengeState(behind, rolled)]) {
      expect(m.weeklyKey).toBe("w2026-2-9");
      expect(m.claimed[w]).toBeUndefined();
      expect(m.progress[w]).toBeUndefined();
      // Mastery belongs to no period, so it always merges.
      expect(m.progress[mastery]).toBe(12);
      expect(m.claimed[mastery]).toBe(true);
    }
  });

  it("union sets merge in a stable order so two devices stop rewriting each other", () => {
    const key = "2026-2-6";
    const id = WEEKLY_POOL.find((x) => x.accumulate === "union")?.id ?? WEEKLY_POOL[0].id;
    const a: ChallengeState = {
      ...freshState(),
      weeklyKey: key,
      sets: { [id]: ["shield", "emp"] },
    };
    const b: ChallengeState = {
      ...freshState(),
      weeklyKey: key,
      sets: { [id]: ["emp", "overload"] },
    };
    const ab = mergeChallengeState(a, b);
    const ba = mergeChallengeState(b, a);
    expect(ab.sets[id]).toEqual(ba.sets[id]);
    expect(ab.sets[id]).toEqual(["emp", "overload", "shield"]);
  });

  it("progress within one period still takes the larger value", () => {
    const key = "2026-2-7";
    const a: ChallengeState = { ...freshState(), dailyKey: key, progress: { [d]: 2 } };
    const b: ChallengeState = { ...freshState(), dailyKey: key, progress: { [d]: 9 } };
    expect(mergeChallengeState(a, b).progress[d]).toBe(9);
    expect(mergeChallengeState(b, a).progress[d]).toBe(9);
  });
});

// ----------------------------------------------------- two devices, offline then on

describe("adversarial sync — two devices going offline and back", () => {
  it("both devices converge to the same blob after one exchange each", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const rand = rng(seed * 1597334677);
      // Both start from the same synced blob, then play offline.
      const shared = mergeData(randomData(rand), randomData(rand));
      const phone = mergeData(shared, randomData(rand));
      const tablet = mergeData(shared, randomData(rand));

      // The phone syncs first: server holds `s1`.
      const s1 = mergeData(phone, shared);
      // Then the tablet reads and merges: server holds `s2`.
      const s2 = mergeData(tablet, s1);
      // The phone comes back and reads: it must not undo anything, and the next pass is a no-op.
      const s3 = mergeData(s1, s2);
      const s4 = mergeData(s3, s2);
      expect(j(s4), `seed ${seed}: sync never settled`).toBe(j(s3));
      // And no counter went backwards for either device along the way.
      expect(s3.profile.xp).toBeGreaterThanOrEqual(Math.max(phone.profile.xp, tablet.profile.xp));
      expect(s3.challenges.xpClaimed).toBeGreaterThanOrEqual(
        Math.max(phone.challenges.xpClaimed, tablet.challenges.xpClaimed),
      );
    }
  });
});
