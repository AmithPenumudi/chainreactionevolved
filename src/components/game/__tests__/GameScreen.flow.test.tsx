import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GameScreen } from "../GameScreen";
import { SettingsProvider } from "../SettingsProvider";
import { ProfileProvider } from "../ProfileProvider";
import { ChallengeProvider } from "../ChallengeProvider";
import type { MatchConfig } from "../SetupScreen";
import { DEFAULT_RULES, type GameMode, type ModeKind, type PlayerConfig } from "@/game/engine";

// React needs this flag to allow act() outside a test renderer.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function aiPlayers(n: number): PlayerConfig[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i,
    name: `Bot ${i + 1}`,
    colorIndex: i,
    isAI: true,
    difficulty: i % 2 === 0 ? "normal" : "easy",
  }));
}

function config(
  over: Partial<MatchConfig> & { mode?: GameMode; modeKind?: ModeKind },
): MatchConfig {
  const mode = over.mode ?? "classic";
  return {
    players: aiPlayers(2),
    rows: 6,
    cols: 9,
    mode,
    rules: DEFAULT_RULES[mode],
    modeKind: "classic",
    ...over,
  };
}

let host: HTMLDivElement;
let root: Root;
const errors: unknown[] = [];

beforeEach(() => {
  window.localStorage.clear();
  // Fastest animations: reduced motion scales every delay down.
  window.localStorage.setItem(
    "cr-settings-v1",
    JSON.stringify({ reducedMotion: true, chainSpeed: "fast", soundEffects: false }),
  );
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  errors.length = 0;
  vi.spyOn(console, "error").mockImplementation((...a) => {
    errors.push(a);
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

/** Fails with the actual console.error text, which makes a React warning easy to diagnose. */
function expectNoErrors() {
  const text = errors.map((e) => (e as unknown[]).map((x) => String(x).slice(0, 400)).join(" | "));
  expect(text).toEqual([]);
}

async function mount(cfg: MatchConfig, onExit = vi.fn(), onRematch = vi.fn()) {
  await act(async () => {
    root.render(
      <SettingsProvider>
        <ProfileProvider>
          <ChallengeProvider>
            <GameScreen config={cfg} onExit={onExit} onRematch={onRematch} />
          </ChallengeProvider>
        </ProfileProvider>
      </SettingsProvider>,
    );
  });
}

/** Advances virtual time until the game shows a result screen (or gives up). */
async function playToEnd(maxSteps = 4000): Promise<"victory" | "draw" | "running"> {
  for (let i = 0; i < maxSteps; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    const text = host.textContent ?? "";
    if (text.includes("VICTORY")) return "victory";
    if (text.includes("DRAW")) return "draw";
  }
  return "running";
}

describe("GameScreen — full automated matches", () => {
  it("renders the board and current player on mount", async () => {
    await mount(config({}));
    expect(host.textContent).toContain("CLASSIC");
    expect(host.textContent).toContain("Bot 1");
    expect(host.textContent).toContain("Bot 2");
    expectNoErrors();
  });

  it("classic 2-bot game plays through to a victory screen without errors", async () => {
    await mount(config({ players: aiPlayers(2) }));
    const result = await playToEnd();
    expect(result).toBe("victory");
    expect(host.textContent).toContain("MAIN MENU");
    expectNoErrors();
  }, 120_000);

  it("4-bot game finishes and the eliminated players are handled", async () => {
    await mount(config({ players: aiPlayers(4), rows: 6, cols: 9 }));
    expect(await playToEnd()).toBe("victory");
    expectNoErrors();
  }, 180_000);

  it("Sudden Death: the first shrink (turn 8) resolves cleanly and the match ends without errors", async () => {
    await mount(
      config({ mode: "sudden-death", rows: 8, cols: 12, rules: DEFAULT_RULES["sudden-death"] }),
    );
    const result = await playToEnd();
    // Bots love edge cells, which the shrink deletes, so this often ends right at the first
    // shrink — either way it must end in a proper result screen, never a stuck board.
    expect(["victory", "draw"]).toContain(result);
    expectNoErrors();
  }, 180_000);

  it("Abilities mode: AI matches run to completion without errors", async () => {
    await mount(config({ modeKind: "abilities" }));
    expect(host.textContent).toContain("ENERGY");
    expect(await playToEnd()).toBe("victory");
    expectNoErrors();
  }, 180_000);

  it("Arena (Portal map): AI matches run without errors", async () => {
    await mount(config({ modeKind: "arena", arenaMapId: "portal", rows: 8, cols: 12 }));
    // Arena games can be long; just prove sustained play is stable.
    for (let i = 0; i < 600; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(250);
      });
      if ((host.textContent ?? "").includes("VICTORY")) break;
    }
    expectNoErrors();
  }, 180_000);

  it("Blitz: an idle human is forfeited by the turn timer instead of freezing the game", async () => {
    const players: PlayerConfig[] = [
      { id: 0, name: "Human", colorIndex: 0 },
      { id: 1, name: "Bot", colorIndex: 1, isAI: true, difficulty: "easy" },
    ];
    await mount(config({ players, mode: "blitz", rules: DEFAULT_RULES.blitz }));
    const turnBefore = host.textContent?.match(/TURN\s*(\d+)/)?.[1];
    // 10s turn limit; no click ever arrives.
    for (let i = 0; i < 60; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
    }
    expect(host.textContent).toContain("Human");
    expectNoErrors();
    // The bot must have had a turn (its move raises the orb count above zero).
    expect(/[1-9]\d* orbs/.test(host.textContent ?? ""), `turn was ${turnBefore}`).toBe(true);
  }, 60_000);

  it("MAIN MENU on the result screen calls onExit exactly once", async () => {
    const onExit = vi.fn();
    await mount(config({}), onExit);
    expect(await playToEnd()).toBe("victory");
    const btn = [...host.querySelectorAll("button")].find((b) =>
      /MAIN MENU/i.test(b.textContent ?? ""),
    );
    await act(async () => btn!.click());
    expect(onExit).toHaveBeenCalledTimes(1);
  }, 120_000);
});
