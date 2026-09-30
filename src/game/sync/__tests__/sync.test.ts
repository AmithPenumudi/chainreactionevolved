import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EMPTY_DATA,
  mergeData,
  readLocal,
  syncProgress,
  SYNC_TIMEOUT_MS,
  writeLocal,
  type PlayerData,
  type RemoteStore,
} from "../sync";
import { applyMatch, DEFAULT_PROFILE, type MatchOutcome } from "../../profile";
import { applySolve, PUZZLE_ORDER } from "../../puzzles";
import { freshState } from "../../challenges";

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

/** Progress for someone who has played `n` matches and solved `puzzles` puzzles. */
function progress(n: number, puzzles = 0): PlayerData {
  let profile = DEFAULT_PROFILE;
  for (let i = 0; i < n; i++) profile = applyMatch(profile, outcome({ won: true }));
  let solved = {};
  for (let i = 0; i < puzzles; i++) {
    solved = applySolve(solved, PUZZLE_ORDER[i], 1, "gold").progress;
  }
  return { profile, puzzles: solved, challenges: freshState() };
}

/** In-memory store with switchable failure modes. */
function fakeStore(initial: PlayerData | null = null) {
  const state = { row: initial, reads: 0, writes: 0 };
  const behaviour = { readFails: false, writeFails: false, hangs: false };
  const store: RemoteStore = {
    async read() {
      state.reads++;
      if (behaviour.hangs) return new Promise(() => {}); // never settles
      if (behaviour.readFails) throw new Error("network");
      return state.row;
    },
    async write(_userId, data) {
      state.writes++;
      if (behaviour.hangs) return new Promise(() => {});
      if (behaviour.writeFails) throw new Error("network");
      state.row = data;
    },
  };
  return { store, state, behaviour };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("mergeData", () => {
  it("merges all three blobs and keeps the best of each", () => {
    const local = progress(6, 1);
    const remote = progress(2, 3);
    const merged = mergeData(local, remote);
    expect(merged.profile.stats.classic.games).toBe(6);
    expect(Object.keys(merged.puzzles)).toHaveLength(3);
  });

  it("is commutative and idempotent, so sync order and retries cannot change it", () => {
    const a = progress(4, 2);
    const b = progress(7, 1);
    expect(mergeData(a, b)).toEqual(mergeData(b, a));
    const once = mergeData(a, b);
    expect(mergeData(once, b)).toEqual(once);
  });
});

describe("syncProgress", () => {
  it("first sync ever: pushes local progress up untouched", async () => {
    const { store, state } = fakeStore(null);
    const local = progress(5, 2);
    const result = await syncProgress(store, "u1", local);
    expect(result).toEqual(local);
    expect(state.row).toEqual(local);
  });

  it("fresh install: adopts what the server holds", async () => {
    const cloud = progress(9, 3);
    const { store } = fakeStore(cloud);
    const result = await syncProgress(store, "u1", EMPTY_DATA);
    expect(result!.profile.xp).toBe(cloud.profile.xp);
    expect(Object.keys(result!.puzzles)).toHaveLength(3);
    // ...and the restored copy is on the device, not just in memory
    expect(readLocal().profile.xp).toBe(cloud.profile.xp);
  });

  it("two devices: neither loses progress, and both converge", async () => {
    const phone = progress(6, 1);
    const tablet = progress(2, 3);
    const { store } = fakeStore(null);
    await syncProgress(store, "u1", phone);
    const afterTablet = await syncProgress(store, "u1", tablet);
    // the tablet now holds everything
    expect(afterTablet!.profile.stats.classic.games).toBe(6);
    expect(Object.keys(afterTablet!.puzzles)).toHaveLength(3);
    // and the phone picks the same result up next time it syncs
    const afterPhone = await syncProgress(store, "u1", phone);
    expect(afterPhone).toEqual(afterTablet);
  });

  it("settles to a fixed point, so sync cannot loop rewriting the row", async () => {
    const { store, state } = fakeStore(null);
    const first = await syncProgress(store, "u1", progress(3, 1));
    const second = await syncProgress(store, "u1", first!);
    const third = await syncProgress(store, "u1", second!);
    // The first merge canonicalises ordering — matches that finished in the same millisecond
    // have no inherent order — and from there nothing changes. Without that fixed point every
    // sync would produce a different blob and trigger another write.
    expect(third).toEqual(second);
    expect(state.row).toEqual(second);
  });

  it("a failed read does not push local over the server's row", async () => {
    const cloud = progress(9, 3);
    const { store, state, behaviour } = fakeStore(cloud);
    behaviour.readFails = true;
    await syncProgress(store, "u1", progress(1, 0));
    // the row still holds the cloud's richer progress rather than this device's thin copy
    expect(state.row!.profile.xp).toBeGreaterThanOrEqual(cloud.profile.xp);
    expect(Object.keys(state.row!.puzzles)).toHaveLength(3);
  });

  it("a failed write leaves local storage untouched and reports nothing happened", async () => {
    const { store, behaviour } = fakeStore(null);
    behaviour.writeFails = true;
    const local = progress(4, 1);
    writeLocal(EMPTY_DATA);
    const result = await syncProgress(store, "u1", local);
    expect(result).toBeNull();
    expect(readLocal().profile.xp).toBe(0); // unchanged — no half-applied sync
  });

  it("gives up rather than hanging the game when the network stalls", async () => {
    vi.useFakeTimers();
    try {
      const { store, behaviour } = fakeStore(null);
      behaviour.hangs = true;
      const pending = syncProgress(store, "u1", progress(2));
      await vi.advanceTimersByTimeAsync(SYNC_TIMEOUT_MS * 2 + 100);
      expect(await pending).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("never throws, whatever the store does", async () => {
    const exploding: RemoteStore = {
      read: () => Promise.reject(new Error("boom")),
      write: () => Promise.reject(new Error("boom")),
    };
    await expect(syncProgress(exploding, "u1", progress(1))).resolves.toBeNull();
  });

  it("reads local storage when no snapshot is passed", async () => {
    writeLocal(progress(3, 1));
    const { store, state } = fakeStore(null);
    await syncProgress(store, "u1");
    expect(state.row!.profile.stats.classic.games).toBe(3);
  });

  it("a claimed challenge reward stays claimed after syncing with a device that had not claimed it", async () => {
    const id = freshState().dailyIds[0];
    const claimed = { ...progress(1), challenges: { ...freshState(), claimed: { [id]: true } } };
    const { store } = fakeStore({ ...progress(1), challenges: freshState() });
    const merged = await syncProgress(store, "u1", claimed);
    expect(merged!.challenges.claimed[id]).toBe(true);
  });
});
