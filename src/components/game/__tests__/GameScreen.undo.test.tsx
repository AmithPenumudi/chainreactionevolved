import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GameScreen } from "../GameScreen";
import { SettingsProvider } from "../SettingsProvider";
import { ProfileProvider } from "../ProfileProvider";
import { ChallengeProvider } from "../ChallengeProvider";
import type { MatchConfig } from "../SetupScreen";
import { DEFAULT_RULES, type PlayerConfig } from "@/game/engine";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const human = (id: number): PlayerConfig => ({ id, name: `Human ${id + 1}`, colorIndex: id });
const bot = (id: number): PlayerConfig => ({
  id,
  name: `Bot ${id + 1}`,
  colorIndex: id,
  isAI: true,
  difficulty: "easy",
});

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

/**
 * Advances fake time in small steps, each in its own act(): React only flushes effects when an
 * act scope ends, so one long act would process a single step of the state → effect → timer chain.
 */
async function advance(ms: number) {
  for (let t = 0; t < ms; t += 100) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
  }
}

const cell = (r: number, c: number) =>
  host.querySelector<HTMLButtonElement>(`button[aria-label^="Row ${r + 1}, column ${c + 1},"]`)!;
const occupied = () =>
  [...host.querySelectorAll("button[aria-label^='Row ']")].filter(
    (b) => !/empty|wall|dead/.test(b.getAttribute("aria-label") ?? ""),
  ).length;
const undoBtn = () =>
  [...host.querySelectorAll("button")].find((b) => /UNDO/.test(b.textContent ?? "")) as
    HTMLButtonElement | undefined;
const turn = () => host.textContent?.match(/TURN\s*(\d+)/)?.[1];

/** Human clicks a cell, then time runs until the bot has answered and it is the human's move. */
async function humanMove(r: number, c: number) {
  await act(async () => cell(r, c).click());
  await advance(4000);
}

describe("Undo (one human vs bots)", () => {
  it("shows an enabled-after-first-move Undo button with the full budget", async () => {
    await mount([human(0), bot(1)]);
    expect(undoBtn()).toBeDefined();
    expect(undoBtn()!.textContent).toContain("3");
    expect(undoBtn()!.disabled).toBe(true); // nothing to undo yet
  });

  it("rewinds the human's move and the bot's reply, and spends one undo", async () => {
    await mount([human(0), bot(1)]);
    await humanMove(0, 0);
    expect(occupied()).toBeGreaterThanOrEqual(2); // human orb + bot orb
    const turnAfter = turn();
    expect(undoBtn()!.disabled).toBe(false);

    await act(async () => undoBtn()!.click());
    expect(occupied()).toBe(0);
    expect(turn()).toBe("1");
    expect(turn()).not.toBe(turnAfter);
    expect(undoBtn()!.textContent).toContain("2");
    expect(undoBtn()!.disabled).toBe(true); // history is used up until the next move
  });

  it("after undoing, the human can play the same cell again and the bot still answers", async () => {
    await mount([human(0), bot(1)]);
    await humanMove(0, 0);
    await act(async () => undoBtn()!.click());
    await humanMove(0, 0);
    expect(occupied()).toBeGreaterThanOrEqual(2);
  });

  it("allows at most three undos per match", async () => {
    await mount([human(0), bot(1)]);
    const moves: [number, number][] = [
      [0, 0],
      [5, 8],
      [2, 4],
      [0, 8],
    ];
    for (const [r, c] of moves) await humanMove(r, c);
    for (let i = 0; i < 3; i++) {
      expect(undoBtn()!.disabled, `undo #${i + 1} should be available`).toBe(false);
      await act(async () => undoBtn()!.click());
    }
    expect(undoBtn()!.textContent).toContain("0");
    expect(undoBtn()!.disabled).toBe(true);
    const frozen = occupied();
    await act(async () => undoBtn()!.click());
    expect(occupied()).toBe(frozen);
  });

  it("does nothing while a bot is still moving (undo is only for the human's turn)", async () => {
    await mount([human(0), bot(1)]);
    await act(async () => cell(0, 0).click());
    await advance(60); // animation in flight, bot has not replied
    expect(undoBtn()!.disabled).toBe(true);
    await advance(4000);
  });

  it("is not offered in hot-seat or bots-only games", async () => {
    await mount([human(0), human(1)]);
    expect(undoBtn()).toBeUndefined();
    await act(async () => root.unmount());
    root = createRoot(host);
    await mount([bot(0), bot(1)]);
    expect(undoBtn()).toBeUndefined();
  });
});
