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
  // Sorted, so the merged object is byte-identical whichever side was passed first. Contents were
  // already order-independent; key order was not, and a blob that differs only in key order still
  // reads as a change to anything that compares the serialised form.
  const abilityIds = [
    ...new Set([...Object.keys(a.abilityCounts), ...Object.keys(b.abilityCounts)]),
  ].sort();
  for (const id of abilityIds) {
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
  for (const m of [...a, ...b]) {
    const held = byId.get(m.id);
    // Two sides can hold the same id with different contents (an older build, a partial write).
    // Taking whichever arrived first made the result depend on argument order, so the tie is
    // broken on the contents themselves instead.
    if (!held || JSON.stringify(m) < JSON.stringify(held)) byId.set(m.id, m);
  }
  return [...byId.values()]
    .sort((x, y) => y.at - x.at || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
    .slice(0, MAX_RECENT);
}

const lastPlayed = (p: PlayerProfile) => p.recent[0]?.at ?? 0;

/**
 * The streak from whichever side played most recently. When neither has (or both landed in the
 * same millisecond) it takes the larger, which keeps the merge commutative and errs in the
 * player's favour rather than silently ending a streak they still hold.
 */
function freshestStreak(a: PlayerProfile, b: PlayerProfile): number {
  const byTime = lastPlayed(a) - lastPlayed(b);
  if (byTime > 0) return a.currentStreak;
  if (byTime < 0) return b.currentStreak;
  return Math.max(a.currentStreak, b.currentStreak);
}

/**
 * The side that owns the display fields: whoever edited last, and on a tie the one that sorts
 * first by name then avatar.
 *
 * The tie used to keep whatever the calling device held, which is not commutative — and the
 * consequence was worse than a cosmetic wobble. Two devices renamed in the same millisecond
 * (or, far more likely, both never renamed and left at `updatedAt: 0` with different defaults)
 * would each merge to their own name, write it, read the other's back, and write again: a sync
 * that never reaches a fixed point and so never stops writing.
 */
function identitySide(local: PlayerProfile, remote: PlayerProfile): PlayerProfile {
  const byTime = (local.updatedAt ?? 0) - (remote.updatedAt ?? 0);
  if (byTime !== 0) return byTime > 0 ? local : remote;
  const key = (p: PlayerProfile) => `${p.username}\u0000${p.avatarId}`;
  return key(local) <= key(remote) ? local : remote;
}

export function mergeProfiles(local: PlayerProfile, remote: PlayerProfile): PlayerProfile {
  const identity = identitySide(local, remote);
  const modes: StatsMode[] = ["classic", "abilities", "arena"];
  return {
    username: identity.username,
    avatarId: identity.avatarId,
    updatedAt: larger(local.updatedAt ?? 0, remote.updatedAt ?? 0),
    xp: larger(local.xp, remote.xp),
    // A streak resets on a loss, so it is not monotonic and max() would be wrong: the device
    // that played most recently holds the truthful value. `updatedAt` cannot answer this —
    // it only moves when the name or avatar changes, so it is tied on almost every sync and
    // the two devices would disagree forever. The last match's timestamp is the real signal.
    currentStreak: freshestStreak(local, remote),
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
  const out: PuzzleProgress = {};
  // Key order is settled by sorting rather than by which side was spread first, for the same
  // reason as `abilityCounts` above.
  for (const id of [...new Set([...Object.keys(local), ...Object.keys(remote)])].sort()) {
    const l = local[id];
    const r = remote[id];
    out[id] = l && r ? mergePuzzleRecord(l, r) : (l ?? r);
  }
  return out;
}

const DAILY_IDS = new Set(DAILY_POOL.map((d) => d.id));
const WEEKLY_IDS = new Set(WEEKLY_POOL.map((d) => d.id));

/** `YYYY-M-D` (daily) or `wYYYY-M-D` (weekly) as a sortable number, or null if not that shape. */
function periodOrder(key: string): number | null {
  const m = /^w?(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(key);
  if (!m) return null;
  return Number(m[1]) * 10_000 + Number(m[2]) * 100 + Number(m[3]);
}

/**
 * The later of two period keys, chosen the same way whichever side is passed first.
 *
 * String order will not do: the keys are not zero-padded, so `"2026-1-9" > "2026-1-10"`.
 */
function newerPeriod(a: string, b: string): string {
  if (a === b) return a;
  const oa = periodOrder(a);
  const ob = periodOrder(b);
  if (oa !== null && ob !== null) return oa >= ob ? a : b;
  if (oa !== null) return a;
  if (ob !== null) return b;
  return a > b ? a : b; // unrecognised shapes: any total order will do, as long as it is stable
}

/**
 * Merging two copies of the challenge board.
 *
 * The period key is resolved first, and a side still sitting on an earlier day or week is treated
 * as describing a different set of challenges: its daily (or weekly) progress, claims and sets are
 * dropped rather than merged. That includes `claimed`, which is the part that used to be wrong.
 * `claimed` only ever growing is right *within* a period, but the daily pool rotates and repeats,
 * so a claim carried across a rollover came back attached to a fresh challenge with the same id
 * and made it permanently unclaimable — the player simply never got that reward. Mastery ids
 * belong to no period and always merge.
 */
export function mergeChallengeState(local: ChallengeState, remote: ChallengeState): ChallengeState {
  const dailyKey = newerPeriod(local.dailyKey, remote.dailyKey);
  const weeklyKey = newerPeriod(local.weeklyKey, remote.weeklyKey);
  const counts = (side: ChallengeState, id: string) =>
    DAILY_IDS.has(id)
      ? side.dailyKey === dailyKey
      : WEEKLY_IDS.has(id)
        ? side.weeklyKey === weeklyKey
        : true;

  const ids = [
    ...new Set<string>([
      ...Object.keys(local.progress),
      ...Object.keys(remote.progress),
      ...Object.keys(local.claimed),
      ...Object.keys(remote.claimed),
      ...Object.keys(local.sets ?? {}),
      ...Object.keys(remote.sets ?? {}),
    ]),
  ].sort();

  const progress: Record<string, number> = {};
  const claimed: Record<string, boolean> = {};
  const sets: Record<string, string[]> = {};
  for (const id of ids) {
    const l = counts(local, id);
    const r = counts(remote, id);
    if (!l && !r) continue;
    const lp = l ? (local.progress[id] ?? 0) : 0;
    const rp = r ? (remote.progress[id] ?? 0) : 0;
    if (lp || rp) progress[id] = larger(lp, rp);
    if ((l && local.claimed[id]) || (r && remote.claimed[id])) claimed[id] = true;
    const union = new Set<string>([
      ...(l ? (local.sets?.[id] ?? []) : []),
      ...(r ? (remote.sets?.[id] ?? []) : []),
    ]);
    // Sorted, because two devices that collected the same keys in a different order would
    // otherwise merge to two different arrays and keep rewriting each other's row.
    if (union.size) sets[id] = [...union].sort();
  }

  // Whichever side holds the winning key also holds the id list that goes with it.
  const pickIds = (a: string[], b: string[], aOk: boolean, bOk: boolean) => {
    if (aOk !== bOk) return aOk ? a : b;
    return a.join("\u0000") <= b.join("\u0000") ? a : b;
  };

  return {
    dailyKey,
    weeklyKey,
    dailyIds: pickIds(
      local.dailyIds,
      remote.dailyIds,
      local.dailyKey === dailyKey,
      remote.dailyKey === dailyKey,
    ),
    weeklyIds: pickIds(
      local.weeklyIds,
      remote.weeklyIds,
      local.weeklyKey === weeklyKey,
      remote.weeklyKey === weeklyKey,
    ),
    progress,
    claimed,
    sets,
    xpClaimed: larger(local.xpClaimed, remote.xpClaimed),
  };
}
