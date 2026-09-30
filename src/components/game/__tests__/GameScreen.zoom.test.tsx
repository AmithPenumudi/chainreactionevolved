import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GameScreen } from "../GameScreen";
import { ZOOM_BELOW, ZOOMED_CELL } from "@/game/board-size";
import { SettingsProvider } from "../SettingsProvider";
import { ProfileProvider } from "../ProfileProvider";
import { ChallengeProvider } from "../ChallengeProvider";
import type { MatchConfig } from "../SetupScreen";
import { DEFAULT_RULES, type PlayerConfig } from "@/game/engine";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const players: PlayerConfig[] = [
  { id: 0, name: "Human", colorIndex: 0 },
  { id: 1, name: "Human 2", colorIndex: 1 },
];

const config = (rows: number, cols: number): MatchConfig => ({
  players,
  rows,
  cols,
  mode: "classic",
  rules: DEFAULT_RULES.classic,
  modeKind: "classic",
});

let host: HTMLDivElement;
let root: Root;

function setViewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: height, configurable: true });
}

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
  setViewport(1024, 768);
});

async function mount(rows: number, cols: number) {
  await act(async () => {
    root.render(
      <SettingsProvider>
        <ProfileProvider>
          <ChallengeProvider>
            <GameScreen config={config(rows, cols)} onExit={() => {}} onRematch={() => {}} />
          </ChallengeProvider>
        </ProfileProvider>
      </SettingsProvider>,
    );
  });
}

const zoomBtn = () =>
  [...host.querySelectorAll("button")].find((b) => /ZOOM/.test(b.textContent ?? "")) as
    HTMLButtonElement | undefined;
const firstCellWidth = () =>
  parseInt(
    (host.querySelector("button[aria-label^='Row 1, column 1,']") as HTMLElement).style.width,
    10,
  );

describe("board zoom on phones", () => {
  it("phone viewport + 10x15 board: fitted cells are small, so a Zoom toggle is offered", async () => {
    setViewport(393, 800);
    await mount(10, 15);
    expect(firstCellWidth()).toBeLessThan(ZOOM_BELOW);
    expect(zoomBtn()).toBeDefined();
    expect(zoomBtn()!.getAttribute("aria-pressed")).toBe("false");
  });

  it("zooming enlarges the cells and makes the board frame scroll; toggling back restores the fit", async () => {
    setViewport(393, 800);
    await mount(10, 15);
    const fitted = firstCellWidth();
    await act(async () => zoomBtn()!.click());
    expect(firstCellWidth()).toBe(ZOOMED_CELL);
    expect(firstCellWidth()).toBeGreaterThan(fitted);
    const frame = host.querySelector("[data-testid='board-frame']") as HTMLElement;
    expect(frame.className).toContain("overflow-auto");
    expect(zoomBtn()!.getAttribute("aria-pressed")).toBe("true");

    await act(async () => zoomBtn()!.click());
    expect(firstCellWidth()).toBe(fitted);
    expect(frame.className).not.toContain("overflow-auto");
  });

  it("small boards fit comfortably, so no Zoom toggle is shown", async () => {
    setViewport(393, 800);
    await mount(6, 9);
    expect(firstCellWidth()).toBeGreaterThanOrEqual(ZOOM_BELOW);
    expect(zoomBtn()).toBeUndefined();
  });

  it("a board never overflows the phone width when not zoomed (fit mode)", async () => {
    for (const [rows, cols] of [
      [6, 9],
      [8, 12],
      [10, 15],
    ] as const) {
      await act(async () => root.unmount());
      root = createRoot(host);
      setViewport(360, 780);
      await mount(rows, cols);
      const w = firstCellWidth();
      const boardWidth = cols * w + (cols - 1) * 4 + 20;
      expect(boardWidth, `${rows}x${cols} at 360px`).toBeLessThanOrEqual(360);
    }
  });

  it("header keeps the title in its own block, apart from the action buttons and stats", async () => {
    // Regression: with Zoom + Undo + Tile Info + Turn + Time in one row the title column was
    // squeezed to nothing and rendered one letter per line on phones.
    setViewport(393, 800);
    await mount(10, 15);
    const header = host.querySelector("header") as HTMLElement;
    const title = header.querySelector("h1") as HTMLElement;
    const actions = header.querySelector("[data-testid='game-actions']") as HTMLElement;
    expect(title.textContent).toContain("CLASSIC");
    expect(actions).not.toBeNull();
    expect(actions.contains(title)).toBe(false);
    expect(actions.textContent).toContain("ZOOM");
    // the title lives in a block that is not shrunk by a fixed-width sibling
    expect(title.parentElement!.className).toContain("min-w-0");
    // actions wrap and take a full row on phones
    expect(actions.className).toContain("flex-wrap");
    expect(actions.className).toContain("col-span-2");
  });

  it("zoom state never leaks into play: cells stay clickable when zoomed", async () => {
    setViewport(393, 800);
    await mount(10, 15);
    await act(async () => zoomBtn()!.click());
    const cell = host.querySelector("button[aria-label^='Row 1, column 1,']") as HTMLButtonElement;
    expect(cell.disabled).toBe(false);
  });
});
