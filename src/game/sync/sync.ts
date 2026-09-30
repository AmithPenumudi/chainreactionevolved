import {
  DEFAULT_PROFILE,
  loadProfile,
  sanitizeProfile,
  saveProfile,
  type PlayerProfile,
} from "../profile";
import { loadPuzzleProgress, savePuzzleProgress, type PuzzleProgress } from "../puzzles";
import { freshState, loadChallenges, saveChallenges, type ChallengeState } from "../challenges";
import { mergeChallengeState, mergeProfiles, mergePuzzleProgress } from "./merge";
import { ensureUserId, currentUserId, getClient } from "./client";

/** The three blobs that follow a player between devices. Settings stay device-local. */
export interface PlayerData {
  profile: PlayerProfile;
  puzzles: PuzzleProgress;
  challenges: ChallengeState;
}

/** Storage the sync talks to, so the logic can be tested without a network. */
export interface RemoteStore {
  read(userId: string): Promise<PlayerData | null>;
  write(userId: string, data: PlayerData): Promise<void>;
}

/** Nothing should take longer than this; the game must never wait on the network to be playable. */
export const SYNC_TIMEOUT_MS = 4000;

/**
 * Settles to `{ ok: false }` on failure or timeout, never rejecting.
 *
 * The distinction matters: a read that failed and a read that found no row both produce "no
 * data", but only the second means it is safe to push. Collapsing them to `null` would let a
 * device that briefly lost its connection overwrite another device's progress.
 */
function attempt<T>(
  work: Promise<T>,
  ms = SYNC_TIMEOUT_MS,
): Promise<{ ok: true; value: T } | { ok: false }> {
  return Promise.race([
    work.then((value) => ({ ok: true as const, value })).catch(() => ({ ok: false as const })),
    new Promise<{ ok: false }>((resolve) => setTimeout(() => resolve({ ok: false }), ms)),
  ]);
}

export function readLocal(): PlayerData {
  return { profile: loadProfile(), puzzles: loadPuzzleProgress(), challenges: loadChallenges() };
}

/**
 * Announced after a sync replaces what is on the device, so the providers — which read local
 * storage once on mount — pick the merged copy up without a restart.
 */
export const SYNC_APPLIED_EVENT = "cr-sync-applied";

export function writeLocal(data: PlayerData): void {
  saveProfile(data.profile);
  savePuzzleProgress(data.puzzles);
  saveChallenges(data.challenges);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SYNC_APPLIED_EVENT));
  }
}

/** Merges the two sides. Pure, so the interesting half of sync is tested without a backend. */
export function mergeData(local: PlayerData, remote: PlayerData): PlayerData {
  return {
    profile: mergeProfiles(local.profile, remote.profile),
    puzzles: mergePuzzleProgress(local.puzzles, remote.puzzles),
    challenges: mergeChallengeState(local.challenges, remote.challenges),
  };
}

/**
 * One sync pass: read what the server has, merge it with this device, and store the result in
 * both places.
 *
 * Returns the merged data, or null when nothing happened (no backend, offline, timed out).
 * A null is not an error — being offline is the normal case for a mobile game, and the local
 * copy stays authoritative until a later pass succeeds.
 */
export async function syncProgress(
  store: RemoteStore,
  userId: string,
  local: PlayerData = readLocal(),
): Promise<PlayerData | null> {
  const read = await attempt(store.read(userId));
  // Could not read: stop. Writing now would push this device's copy over a row we never saw.
  if (!read.ok) return null;
  const merged = read.value ? mergeData(local, read.value) : local;
  const wrote = await attempt(store.write(userId, merged));
  if (!wrote.ok) return null;
  writeLocal(merged);
  return merged;
}

/** Sync only if this device already has an account — never creates one. Used at launch. */
export async function syncIfSignedIn(store = supabaseStore()): Promise<PlayerData | null> {
  if (!store) return null;
  const userId = await attempt(currentUserId());
  if (!userId.ok || !userId.value) return null;
  return syncProgress(store, userId.value);
}

/**
 * Sync, creating the anonymous account if this is the first time. Called when there is
 * something worth keeping — a finished match — rather than at launch, because an anonymous
 * user counts as a monthly active user and an app that was opened once should not cost one.
 */
export async function syncAfterMatch(store = supabaseStore()): Promise<PlayerData | null> {
  if (!store) return null;
  const userId = await attempt(ensureUserId());
  if (!userId.ok || !userId.value) return null;
  return syncProgress(store, userId.value);
}

/** The Supabase-backed store, or null when no backend is configured. */
export function supabaseStore(): RemoteStore | null {
  const supabase = getClient();
  if (!supabase) return null;
  return {
    async read(userId) {
      const { data, error } = await supabase
        .from("player_data")
        .select("profile, puzzles, challenges")
        .eq("user_id", userId)
        .maybeSingle();
      if (error || !data) return null;
      // Re-validated on the way in: the row is whatever some build of the app wrote, and the
      // sanitizers are the same ones that guard damaged localStorage.
      return {
        profile: sanitizeProfile(data.profile),
        puzzles: (data.puzzles ?? {}) as PuzzleProgress,
        challenges: { ...freshState(), ...((data.challenges ?? {}) as ChallengeState) },
      };
    },
    async write(userId, data) {
      const { error } = await supabase.from("player_data").upsert(
        {
          user_id: userId,
          profile: data.profile,
          puzzles: data.puzzles,
          challenges: data.challenges,
        },
        { onConflict: "user_id" },
      );
      if (error) throw error;
    },
  };
}

/** A player who has never synced looks like this, so a first push is not mistaken for a merge. */
export const EMPTY_DATA: PlayerData = {
  profile: DEFAULT_PROFILE,
  puzzles: {},
  challenges: freshState(),
};
