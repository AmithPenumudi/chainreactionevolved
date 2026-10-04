import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GameScreen } from "../GameScreen";
import { SettingsProvider } from "../SettingsProvider";
import { ProfileProvider } from "../ProfileProvider";
import { ChallengeProvider } from "../ChallengeProvider";
import type { MatchConfig } from "../SetupScreen";
import { colorFor } from "@/game/colors";
import { DEFAULT_RULES, type PlayerConfig } from "@/game/engine";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const human = (id: number): PlayerConfig => ({ id, name: `Human ${id + 1}`, colorIndex: id });

const cfg = (players: PlayerConfig[]): MatchConfig => ({
  players,
  rows: 6,
  cols: 9,
  mode: "classic",
  rules: DEFAULT_RULES.classic,
  modeKind: "classic",
});

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(
    "cr-settings-v1",
    JSON.stringify({ reducedMotion: true, chainSpeed: "fast", soundEffects: false }),
  );
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

async function mount(players: PlayerConfig[]) {
  await act(async () => {
    root.render(
      <SettingsProvider>
        <ProfileProvider>
          <ChallengeProvider>
            <GameScreen config={cfg(players)} onExit={() => {}} onRematch={() => {}} />
          </ChallengeProvider>
        </ProfileProvider>
      </SettingsProvider>,
    );
  });
}

/** React flushes effects when an act scope ends, so step time in small slices. */
async function advance(ms: number) {
  for (let t = 0; t < ms; t += 100) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
  }
}

const cell = (r: number, c: number) =>
  host.querySelector<HTMLButtonElement>(`button[aria-label^="Row ${r + 1}, column ${c + 1},"]`)!;

async function play(r: number, c: number) {
  await act(async () => cell(r, c).click());
  await advance(2500);
}

const banner = () => host.querySelector<HTMLElement>(".combo-banner");
const turnText = () => host.textContent?.match(/CURRENT TURN\s*(.*?)\s*(?:YOUR MOVE|$)/)?.[1] ?? "";

describe("chain multiplier banner", () => {
  it("keeps the colour of the player who built the chain after the turn passes", async () => {
    // Two humans so the turn order is fully controlled: P0 (colour 0), P1 (colour 1).
    await mount([human(0), human(1)]);

    // P0 loads the top-left corner cluster while P1 plays far away on cells that never reach
    // critical mass, so the only chain on the board is P0's.
    const away: [number, number][] = [
      [5, 8],
      [5, 6],
      [5, 4],
      [5, 2],
      [3, 8],
      [3, 6],
    ];
    const p0: [number, number][] = [
      [0, 1],
      [0, 1], // edge, critical mass 3 -> sits at 2
      [1, 0],
      [1, 0], // edge, critical mass 3 -> sits at 2
      [0, 0], // corner, critical mass 2 -> sits at 1
      [0, 0], // ...and this detonates the lot
    ];

    for (let i = 0; i < p0.length; i++) {
      await play(p0[i][0], p0[i][1]);
      // No opponent move after the final, detonating placement: the turn must still be sitting
      // on P1 when the banner is inspected, which is the situation that produced the bug.
      if (i < p0.length - 1) await play(away[i][0], away[i][1]);
    }

    const el = banner();
    expect(el, "a chain of 3+ should have raised the multiplier banner").not.toBeNull();

    const multiplier = el!.querySelector<HTMLElement>("[style*='color']");
    expect(multiplier, "the banner should carry an explicit colour").not.toBeNull();

    // The whole point: commitMove rotates the turn the moment animateMove resolves, while the
    // banner stays up for its pop animation. Reading the live current player painted a blue
    // player's chain in the opponent's red.
    const style = multiplier!.getAttribute("style") ?? "";
    expect(style, `banner colour should be P0's ${colorFor(0)}, got: ${style}`).toContain(
      colorFor(0),
    );
    expect(style).not.toContain(colorFor(1));

    // And confirm the scenario is the real one: the turn really has moved on.
    expect(turnText()).toContain("Human 2");
  });
});
