import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AI_WORKER_TIMEOUT_MS, chooseAIActionAsync, resetAIWorkerForTests } from "../ai-client";
import type { AIAction } from "../ai";
import { DEFAULT_RULES, makeInitialState, MODE_CONFIGS, type GameState } from "../engine";
import type { Response } from "../ai.worker";

const searchCalls = vi.hoisted(() => ({ count: 0 }));
vi.mock("../ai", async (importOriginal) => {
  const real = await importOriginal<typeof import("../ai")>();
  return {
    ...real,
    chooseAIAction: (...args: Parameters<typeof real.chooseAIAction>) => {
      searchCalls.count++;
      return real.chooseAIAction(...args);
    },
  };
});

function gameState(): GameState {
  const players = [0, 1].map((i) => ({
    id: i,
    name: `Bot ${i}`,
    colorIndex: i,
    isAI: true,
    difficulty: "hard" as const,
  }));
  return makeInitialState(players, 6, 9, "classic", DEFAULT_RULES.classic, MODE_CONFIGS.classic);
}

type Behaviour = "echo" | "silent" | "crash" | "error-reply" | "throw-on-post";

/** Minimal stand-in for `new Worker(...)` whose behaviour each test picks. */
class FakeWorker {
  static instances: FakeWorker[] = [];
  static behaviour: Behaviour = "echo";
  static constructed = 0;
  onmessage: ((e: { data: Response }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  terminated = false;
  posted: { id: number }[] = [];

  constructor() {
    FakeWorker.constructed++;
    FakeWorker.instances.push(this);
  }
  postMessage(msg: { id: number }) {
    this.posted.push(msg);
    switch (FakeWorker.behaviour) {
      case "throw-on-post":
        throw new Error("DataCloneError");
      case "silent":
        return;
      case "crash":
        queueMicrotask(() => this.onerror?.({}));
        return;
      case "error-reply":
        queueMicrotask(() =>
          this.onmessage?.({ data: { id: msg.id, action: null, error: "boom" } }),
        );
        return;
      default:
        queueMicrotask(() =>
          this.onmessage?.({ data: { id: msg.id, action: { type: "move", r: 3, c: 3 } } }),
        );
    }
  }
  terminate() {
    this.terminated = true;
  }
}

beforeEach(() => {
  FakeWorker.instances = [];
  FakeWorker.behaviour = "echo";
  FakeWorker.constructed = 0;
  resetAIWorkerForTests();
  vi.stubGlobal("Worker", FakeWorker);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const isLegalMove = (s: GameState, a: AIAction | null) =>
  a !== null &&
  a.type === "move" &&
  a.r >= 0 &&
  a.r < s.board.rows &&
  a.c >= 0 &&
  a.c < s.board.cols;

describe("chooseAIActionAsync", () => {
  it("hard/normal run in the worker and return its answer", async () => {
    const a = await chooseAIActionAsync(gameState(), "hard");
    expect(a).toEqual({ type: "move", r: 3, c: 3 });
    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0].posted).toHaveLength(1);
    expect(await chooseAIActionAsync(gameState(), "normal")).toEqual({ type: "move", r: 3, c: 3 });
    expect(FakeWorker.constructed).toBe(1); // the worker is created once and reused
  });

  it("easy is answered instantly on the main thread without touching the worker", async () => {
    const s = gameState();
    const a = await chooseAIActionAsync(s, "easy");
    expect(isLegalMove(s, a)).toBe(true);
    expect(FakeWorker.constructed).toBe(0);
  });

  it("without Worker support it computes synchronously and still returns a legal move", async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal("Worker", undefined);
    const s = gameState();
    const a = await chooseAIActionAsync(s, "hard");
    expect(isLegalMove(s, a)).toBe(true);
  });

  it("falls back to the main thread when the worker crashes, and stops using it", async () => {
    FakeWorker.behaviour = "crash";
    const s = gameState();
    const a = await chooseAIActionAsync(s, "hard");
    expect(isLegalMove(s, a)).toBe(true);
    expect(FakeWorker.instances[0].terminated).toBe(true);
    // later requests go straight to the main thread — no new worker is built
    await chooseAIActionAsync(s, "hard");
    expect(FakeWorker.constructed).toBe(1);
  });

  it("falls back when the worker reports an error for a request", async () => {
    FakeWorker.behaviour = "error-reply";
    const s = gameState();
    expect(isLegalMove(s, await chooseAIActionAsync(s, "normal"))).toBe(true);
  });

  it("falls back when the state cannot be posted to the worker", async () => {
    FakeWorker.behaviour = "throw-on-post";
    const s = gameState();
    expect(isLegalMove(s, await chooseAIActionAsync(s, "hard"))).toBe(true);
  });

  it("falls back after the timeout if the worker never answers", async () => {
    vi.useFakeTimers();
    FakeWorker.behaviour = "silent";
    const s = gameState();
    const p = chooseAIActionAsync(s, "hard");
    await vi.advanceTimersByTimeAsync(AI_WORKER_TIMEOUT_MS + 10);
    expect(isLegalMove(s, await p)).toBe(true);
    expect(FakeWorker.instances[0].terminated).toBe(true);
  });

  it("does not search twice on timeout (the fallback runs exactly once)", async () => {
    vi.useFakeTimers();
    FakeWorker.behaviour = "silent";
    const s = gameState();
    searchCalls.count = 0;
    const p = chooseAIActionAsync(s, "hard");
    await vi.advanceTimersByTimeAsync(AI_WORKER_TIMEOUT_MS + 10);
    await p;
    expect(searchCalls.count).toBe(1);
  });

  it("concurrent requests are matched to the right answers", async () => {
    const s = gameState();
    const results = await Promise.all([
      chooseAIActionAsync(s, "hard"),
      chooseAIActionAsync(s, "normal"),
      chooseAIActionAsync(s, "hard"),
    ]);
    expect(results).toHaveLength(3);
    const ids = FakeWorker.instances[0].posted.map((m) => m.id);
    expect(new Set(ids).size).toBe(3);
    for (const r of results) expect(r).toEqual({ type: "move", r: 3, c: 3 });
  });

  it("a late worker answer after the timeout is ignored safely", async () => {
    vi.useFakeTimers();
    FakeWorker.behaviour = "silent";
    const s = gameState();
    const p = chooseAIActionAsync(s, "hard");
    await vi.advanceTimersByTimeAsync(AI_WORKER_TIMEOUT_MS + 10);
    const a = await p;
    const w = FakeWorker.instances[0];
    expect(() =>
      w.onmessage?.({ data: { id: w.posted[0].id, action: { type: "move", r: 0, c: 0 } } }),
    ).not.toThrow();
    expect(isLegalMove(s, a)).toBe(true);
  });
});
