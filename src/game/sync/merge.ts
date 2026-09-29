import {
  emptyModeStats,
  type MatchRecord,
  type ModeStats,
  type PlayerProfile,
  type StatsMode,
} from "../profile";
import { medalRank, type PuzzleProgress, type PuzzleRecord } from "../puzzles";
import { DAILY_POOL, WEEKLY_POOL, type ChallengeState } from "../challenges";

/*
 * Merging two copies of a player's progress — the local device and whatever the server holds.
 *
 * Every function here is pure and commutative, so it does not matter which side is "newer" or
 * how many times a sync is retried. Aggregates merge with max() because each one only ever
 * grows; identity fields merge last-write-wins because a conflict there is harmless.
 *
 * Known limitation: two devices playing offline at the same time will keep the larger total
 * rather than the sum, so some XP can be lost. It can never go backwards, which is the
 * failure worth avoiding. Deriving totals from an append-only match log would make this exact;
 * that is the upgrade path when leaderboards need numbers a server can vouch for.
 */

const MAX_RECENT = 5;

/** Counters only grow, so the larger value is the more complete one. */
const larger = (a: number, b: number) => (Number.isFinite(a) ? Math.max(a, b || 0) : b || 0);

export function mergeModeStats(a: ModeStats, b: ModeStats): ModeStats {
  const out = emptyModeStats();
  for (const key of Object.keys(out) as (keyof ModeStats)[]) {
    if (key === "abilityCounts") continue;
    (out[key] as number) = larger(a[key] as number, b[key] as number);
  }
  for (const id of new Set([...Object.keys(a.abilityCounts), ...Object.keys(b.abilityCounts)])) {
    out.abilityCounts[id] = larger(a.abilityCounts[id] ?? 0, b.abilityCounts[id] ?? 0);
  }
  return out;
}

/**
 * Newest first, de-duplicated by id, capped like the local list. Matches finished in the same
 * millisecond tie on `at`, so id breaks the tie: without a total order the result would depend
 * on which side was passed first, and each sync would rewrite the blob and trigger another.
 */
function mergeRecent(a: MatchRecord[], b: MatchRecord[]): MatchRecord[] {
  const byId = new Map<string, MatchRecord>();
  for (const m of [...a, ...b]) if (!byId.has(m.id)) byId.set(m.id, m);
  return [...byId.values()]
    .sort((x, y) => y.at - x.at || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
    .slice(0, MAX_RECENT);
}

export function mergeProfiles(local: PlayerProfile, remote: PlayerProfile): PlayerProfile {
  // The side edited more recently owns the display fields; a tie keeps what this device shows.
  const localIsNewer = (local.updatedAt ?? 0) >= (remote.updatedAt ?? 0);
  const identity = localIsNewer ? local : remote;
  const modes: StatsMode[] = ["classic", "abilities", "arena"];
  return {
    username: identity.username,
    avatarId: identity.avatarId,
    updatedAt: larger(local.updatedAt ?? 0, remote.updatedAt ?? 0),
    xp: larger(local.xp, remote.xp),
    // A streak resets on a loss, so it is not monotonic: the newer side is the truthful one.
    currentStreak: identity.currentStreak,
    longestStreak: larger(local.longestStreak, remote.longestStreak),
    bestMatchEliminations: larger(local.bestMatchEliminations, remote.bestMatchEliminations),
    stats: Object.fromEntries(
      modes.map((m) => [m, mergeModeStats(local.stats[m], remote.stats[m])]),
    ) as Record<StatsMode, ModeStats>,
    recent: mergeRecent(local.recent, remote.recent),
  };
}

function mergePuzzleRecord(a: PuzzleRecord, b: PuzzleRecord): PuzzleRecord {
  const best = medalRank(a.medal) >= medalRank(b.medal) ? a : b;
  return {
    medal: best.medal,
    bestMoves: Math.min(a.bestMoves, b.bestMoves),
    // XP already paid out on either device; keeping the larger avoids paying twice.
    xpAwarded: larger(a.xpAwarded, b.xpAwarded),
  };
}

export function mergePuzzleProgress(local: PuzzleProgress, remote: PuzzleProgress): PuzzleProgress {
  const out: PuzzleProgress = { ...remote };
  for (const [id, rec] of Object.entries(local)) {
    const other = out[id];
    out[id] = other ? mergePuzzleRecord(rec, other) : rec;
  }
  return out;
}

const DAILY_IDS = new Set(DAILY_POOL.map((d) => d.id));
const WEEKLY_IDS = new Set(WEEKLY_POOL.map((d) => d.id));

export function mergeChallengeState(local: ChallengeState, remote: ChallengeState): ChallengeState {
  const sameDaily = local.dailyKey === remote.dailyKey;
  const sameWeekly = local.weeklyKey === remote.weeklyKey;
  // Progress is only comparable within one period: once a side has rolled over, its numbers
  // describe a different set of challenges. Mastery never resets, so it always merges.
  const comparable = (id: string) =>
    DAILY_IDS.has(id) ? sameDaily : WEEKLY_IDS.has(id) ? sameWeekly : true;

  const progress = { ...local.progress };
  for (const [id, value] of Object.entries(remote.progress)) {
    if (!comparable(id)) continue;
    progress[id] = larger(local.progress[id] ?? 0, value);
  }

  const sets = { ...local.sets };
  for (const [id, values] of Object.entries(remote.sets ?? {})) {
    if (!comparable(id)) continue;
    sets[id] = [...new Set([...(local.sets?.[id] ?? []), ...values])];
  }

  return {
    ...local,
    // `claimed` must only ever grow: forgetting a claim would pay the same reward twice.
    claimed: { ...remote.claimed, ...local.claimed },
    progress,
    sets,
    xpClaimed: larger(local.xpClaimed, remote.xpClaimed),
  };
}
