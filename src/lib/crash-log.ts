/**
 * A small on-device error log. It lets a player (or you, on a test device) see what went wrong
 * and copy it into a bug report, without needing a server.
 */
export interface CrashEntry {
  at: number;
  message: string;
  stack?: string;
  source: "error" | "unhandledrejection" | "boundary";
}

const KEY = "cr-crashlog-v1";
export const MAX_CRASHES = 10;
const MAX_TEXT = 1500;

function describe(reason: unknown): { message: string; stack?: string } {
  if (reason instanceof Error) {
    return {
      message: (reason.message || reason.name).slice(0, MAX_TEXT),
      stack: reason.stack?.slice(0, MAX_TEXT),
    };
  }
  let text: string;
  try {
    text = typeof reason === "string" ? reason : JSON.stringify(reason);
  } catch {
    text = String(reason);
  }
  return { message: (text ?? "unknown error").slice(0, MAX_TEXT) };
}

export function getCrashLog(): CrashEntry[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is CrashEntry =>
          !!e && typeof e === "object" && typeof (e as CrashEntry).message === "string",
      )
      .slice(-MAX_CRASHES);
  } catch {
    return [];
  }
}

/** Appends an entry, keeping only the newest `MAX_CRASHES`. Never throws. */
export function recordCrash(reason: unknown, source: CrashEntry["source"] = "error"): void {
  try {
    const entry: CrashEntry = { at: Date.now(), source, ...describe(reason) };
    const next = [...getCrashLog(), entry].slice(-MAX_CRASHES);
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* logging must never cause a second failure */
  }
}

export function clearCrashLog(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

let installed = false;

/** Records uncaught errors and unhandled promise rejections. Safe to call more than once. */
export function installCrashHandlers(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (e) => recordCrash(e.error ?? e.message, "error"));
  window.addEventListener("unhandledrejection", (e) => recordCrash(e.reason, "unhandledrejection"));
}

/** Test hook. */
export function resetCrashHandlersForTests(): void {
  installed = false;
}

/** Plain-text report a player can paste into a bug report. */
export function formatDebugInfo(): string {
  const crashes = getCrashLog();
  const lines = [
    "Chain Reaction — debug info",
    `time: ${new Date().toISOString()}`,
    `userAgent: ${navigator.userAgent}`,
    `viewport: ${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio}x`,
    `recorded errors: ${crashes.length}`,
  ];
  for (const c of crashes) {
    lines.push("", `[${new Date(c.at).toISOString()}] (${c.source}) ${c.message}`);
    if (c.stack) lines.push(c.stack);
  }
  return lines.join("\n");
}
