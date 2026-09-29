import { chooseAIAction, type AIAction, type AIDifficulty } from "./ai";
import type { GameState } from "./engine";
import type { Response } from "./ai.worker";

/** If the worker has not answered by then, the search is redone on the main thread. */
export const AI_WORKER_TIMEOUT_MS = 8000;

interface WorkerLike {
  onmessage: ((e: { data: Response }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  postMessage(msg: unknown): void;
  terminate(): void;
}

let worker: WorkerLike | null = null;
let workerBroken = false;
let nextId = 1;
const pending = new Map<number, (r: Response) => void>();

function getWorker(): WorkerLike | null {
  if (workerBroken || typeof Worker === "undefined") return null;
  if (worker) return worker;
  try {
    const w = new Worker(new URL("./ai.worker.ts", import.meta.url), {
      type: "module",
    }) as unknown as WorkerLike;
    w.onmessage = ({ data }) => {
      const resolve = pending.get(data.id);
      if (resolve) {
        pending.delete(data.id);
        resolve(data);
      }
    };
    w.onerror = () => failWorker();
    worker = w;
    return w;
  } catch {
    workerBroken = true;
    return null;
  }
}

/** The worker crashed or could not load: settle everything waiting and stop using it. */
function failWorker() {
  workerBroken = true;
  try {
    worker?.terminate();
  } catch {
    /* already gone */
  }
  worker = null;
  for (const [id, resolve] of pending) resolve({ id, action: null, error: "worker failed" });
  pending.clear();
}

/**
 * Picks the computer's action without freezing the UI: heavier difficulties run in a Web
 * Worker, and anything that goes wrong (no Worker support, load failure, crash, timeout)
 * silently falls back to computing on the main thread, so a turn is never lost.
 */
export function chooseAIActionAsync(
  state: GameState,
  difficulty: AIDifficulty,
): Promise<AIAction | null> {
  // Easy is instant; a worker round-trip would only add latency.
  const w = difficulty === "easy" ? null : getWorker();
  if (!w) return Promise.resolve(chooseAIAction(state, difficulty));

  return new Promise((resolve) => {
    const id = nextId++;
    let settled = false;
    const finish = (action: AIAction | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pending.delete(id);
      resolve(action);
    };
    const fallback = () => {
      if (!settled) finish(chooseAIAction(state, difficulty)); // never search twice
    };
    const timer = setTimeout(() => {
      failWorker(); // a hung worker is not coming back
      fallback();
    }, AI_WORKER_TIMEOUT_MS);

    pending.set(id, (r) => (r.error ? fallback() : finish(r.action)));
    try {
      w.postMessage({ id, state, difficulty });
    } catch {
      failWorker();
      fallback();
    }
  });
}

/** Test hook: forget the worker and its failure state. */
export function resetAIWorkerForTests() {
  worker = null;
  workerBroken = false;
  pending.clear();
}
