/*
 * Per-day activity accounting for the internal metrics dashboard.
 *
 * Deliberately minimal: a day bucket holds counters and nothing else — no IP, no location, no
 * device fingerprint, no per-match detail. It answers "how many people played, and for how
 * long" and cannot answer anything about an individual beyond that.
 *
 * Buckets are keyed by the device's LOCAL calendar day, because "daily active users" means
 * the player's day, not UTC. A session that runs past midnight is split across both days.
 */

/** A single stretch of foreground time longer than this is almost certainly a device left
 *  awake rather than someone playing, so it stops counting. */
export const MAX_SEGMENT_MS = 4 * 60 * 60 * 1000;

export interface DayActivity {
  /** Local calendar day, YYYY-MM-DD. */
  day: string;
  activeMs: number;
  sessions: number;
  matches: number;
  puzzlesSolved: number;
}

export function emptyDay(day: string): DayActivity {
  return { day, activeMs: 0, sessions: 0, matches: 0, puzzlesSolved: 0 };
}

/** Local calendar day of a timestamp, as YYYY-MM-DD. */
export function dayKey(at: number): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Midnight at the start of the next local day. Built from local date parts, so it stays
 *  correct across daylight-saving changes where a day is 23 or 25 hours long. */
function nextLocalMidnight(at: number): number {
  const d = new Date(at);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0).getTime();
}

/**
 * Splits a foreground stretch into per-local-day chunks. Returns nothing for a zero-length or
 * backwards range, which is what a clock correction or a stop-without-start looks like.
 */
export function splitAcrossDays(startMs: number, endMs: number): { day: string; ms: number }[] {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return [];
  const capped = Math.min(endMs, startMs + MAX_SEGMENT_MS);
  const out: { day: string; ms: number }[] = [];
  let cursor = startMs;
  while (cursor < capped) {
    const boundary = Math.min(nextLocalMidnight(cursor), capped);
    out.push({ day: dayKey(cursor), ms: boundary - cursor });
    cursor = boundary;
  }
  return out;
}

/** Adds a day's counters into a running map, in place. */
export function addDay(
  into: Record<string, DayActivity>,
  day: string,
  patch: Partial<DayActivity>,
) {
  const base = into[day] ?? emptyDay(day);
  into[day] = {
    day,
    activeMs: base.activeMs + (patch.activeMs ?? 0),
    sessions: base.sessions + (patch.sessions ?? 0),
    matches: base.matches + (patch.matches ?? 0),
    puzzlesSolved: base.puzzlesSolved + (patch.puzzlesSolved ?? 0),
  };
}

/**
 * Accumulates foreground time and gameplay counters into local-day buckets.
 *
 * `now` is injected so the whole class is testable without touching the clock, and so a device
 * whose clock jumps cannot corrupt a bucket.
 */
export class ActivityLog {
  private days: Record<string, DayActivity>;
  private openedAt: number | null = null;

  constructor(
    days: Record<string, DayActivity> = {},
    private readonly now: () => number = Date.now,
  ) {
    this.days = days;
  }

  /** The app came to the foreground. Calling it twice without a stop is harmless. */
  start(): void {
    if (this.openedAt !== null) return;
    const at = this.now();
    this.openedAt = at;
    addDay(this.days, dayKey(at), { sessions: 1 });
  }

  /** The app went to the background (or is closing). Banks the elapsed foreground time. */
  stop(): void {
    if (this.openedAt === null) return;
    for (const { day, ms } of splitAcrossDays(this.openedAt, this.now())) {
      addDay(this.days, day, { activeMs: ms });
    }
    this.openedAt = null;
  }

  /** Banks time so far without ending the session — used before uploading, and periodically
   *  so an app that is force-killed does not lose the whole session. */
  checkpoint(): void {
    if (this.openedAt === null) return;
    this.stop();
    this.openedAt = this.now();
  }

  record(counter: "matches" | "puzzlesSolved", n = 1): void {
    addDay(this.days, dayKey(this.now()), { [counter]: n });
  }

  /** Every bucket, oldest first. */
  snapshot(): DayActivity[] {
    return Object.values(this.days).sort((a, b) => a.day.localeCompare(b.day));
  }

  /** Buckets for days that have finished, which are the only ones safe to consider final. */
  completedDays(): DayActivity[] {
    const today = dayKey(this.now());
    return this.snapshot().filter((d) => d.day < today);
  }

  /** Drops buckets already stored server-side, keeping storage bounded. */
  forget(days: string[]): void {
    for (const d of days) delete this.days[d];
  }
}
