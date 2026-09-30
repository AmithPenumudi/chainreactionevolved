import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ProfileProvider } from "../ProfileProvider";
import { ChallengeProvider } from "../ChallengeProvider";
import { useProfile } from "@/game/profile";
import { useChallenges } from "@/game/challenges";
import {
  SYNC_APPLIED_EVENT,
  syncProgress,
  type PlayerData,
  type RemoteStore,
} from "@/game/sync/sync";
import { applyMatch, DEFAULT_PROFILE, type MatchOutcome } from "@/game/profile";
import { freshState } from "@/game/challenges";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function outcome(o: Partial<MatchOutcome> = {}): MatchOutcome {
  return {
    mode: "classic",
    won: true,
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

function cloudData(matches: number): PlayerData {
  let profile = DEFAULT_PROFILE;
  for (let i = 0; i < matches; i++) profile = applyMatch(profile, outcome());
  // updatedAt is what decides who owns the display name, and the real app stamps it whenever
  // the player renames themselves — without it the merge correctly keeps this device's name.
  return {
    profile: { ...profile, username: "FROM_CLOUD", updatedAt: Date.now() },
    puzzles: {},
    challenges: freshState(),
  };
}

function storeHolding(data: PlayerData | null): RemoteStore {
  return {
    async read() {
      return data;
    },
    async write() {},
  };
}

let host: HTMLDivElement;
let root: Root;

function Probe() {
  const { profile } = useProfile();
  const { state } = useChallenges();
  return (
    <div data-testid="probe">{`${profile.username}|${profile.xp}|${state.dailyIds.length}`}</div>
  );
}

const probeText = () => host.querySelector("[data-testid='probe']")!.textContent!;

beforeEach(() => {
  window.localStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function mount() {
  await act(async () => {
    root.render(
      <ProfileProvider>
        <ChallengeProvider>
          <Probe />
        </ChallengeProvider>
      </ProfileProvider>,
    );
  });
}

describe("cloud sync reaching the running app", () => {
  it("a merge that lands after mount updates the UI without a restart", async () => {
    await mount();
    expect(probeText()).toContain("PLAYER|0");

    // A sync completes while the app is already running.
    await act(async () => {
      await syncProgress(storeHolding(cloudData(4)), "u1");
    });

    expect(probeText()).toContain("FROM_CLOUD");
    expect(probeText()).not.toContain("|0|");
  });

  it("local progress made before the sync is not lost by it", async () => {
    await mount();
    // The player finishes a match on this device first.
    await act(async () => {
      window.localStorage.setItem(
        "cr-profile-v1",
        JSON.stringify(applyMatch(DEFAULT_PROFILE, outcome({ eliminations: 5 }))),
      );
      window.dispatchEvent(new CustomEvent(SYNC_APPLIED_EVENT));
    });
    const localXp = Number(probeText().split("|")[1]);
    expect(localXp).toBeGreaterThan(0);

    await act(async () => {
      await syncProgress(storeHolding(cloudData(4)), "u1");
    });
    // The merge keeps the larger totals rather than replacing them with the cloud's.
    expect(Number(probeText().split("|")[1])).toBeGreaterThanOrEqual(localXp);
  });

  it("a sync that fails leaves the running app untouched", async () => {
    await mount();
    const before = probeText();
    const broken: RemoteStore = {
      read: () => Promise.reject(new Error("offline")),
      write: () => Promise.reject(new Error("offline")),
    };
    await act(async () => {
      expect(await syncProgress(broken, "u1")).toBeNull();
    });
    expect(probeText()).toBe(before);
  });

  it("providers stop listening once unmounted", async () => {
    await mount();
    await act(async () => root.unmount());
    // Firing the event after teardown must not touch a dead tree.
    expect(() => window.dispatchEvent(new CustomEvent(SYNC_APPLIED_EVENT))).not.toThrow();
    root = createRoot(host);
  });
});
