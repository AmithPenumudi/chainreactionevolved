import { describe, expect, it } from "vitest";
import {
  ActivityLog,
  dayKey,
  MAX_SEGMENT_MS,
  splitAcrossDays,
  type DayActivity,
} from "../activity";

/** Local time helper, so these tests read the same in any timezone the CI runner uses. */
const at = (y: number, m: number, d: number, h = 0, min = 0) =>
  new Date(y, m - 1, d, h, min).getTime();

const MIN = 60_000;
const HOUR = 60 * MIN;

describe("dayKey", () => {
  it("formats the local calendar day, zero-padded", () => {
    expect(dayKey(at(2026, 3, 7, 13))).toBe("2026-03-07");
    expect(dayKey(at(2026, 11, 30, 23, 59))).toBe("2026-11-30");
  });

  it("is the local day, not UTC — late evening does not roll over early", () => {
    expect(dayKey(at(2026, 6, 15, 23, 30))).toBe("2026-06-15");
    expect(dayKey(at(2026, 6, 16, 0, 30))).toBe("2026-06-16");
  });

  it("sorts lexicographically in date order, which the dashboard relies on", () => {
    const days = [at(2026, 12, 1), at(2026, 2, 3), at(2026, 2, 28)].map(dayKey);
    expect([...days].sort()).toEqual(["2026-02-03", "2026-02-28", "2026-12-01"]);
  });
});

describe("splitAcrossDays", () => {
  it("keeps a session inside one day as a single chunk", () => {
    expect(splitAcrossDays(at(2026, 5, 4, 10), at(2026, 5, 4, 10, 25))).toEqual([
      { day: "2026-05-04", ms: 25 * MIN },
    ]);
  });

  it("splits a session that runs past midnight across both days", () => {
    const chunks = splitAcrossDays(at(2026, 5, 4, 23, 40), at(2026, 5, 5, 0, 20));
    expect(chunks).toEqual([
      { day: "2026-05-04", ms: 20 * MIN },
      { day: "2026-05-05", ms: 20 * MIN },
    ]);
  });

  it("caps one uninterrupted stretch, so a device left awake is not counted as play", () => {
    const total = splitAcrossDays(at(2026, 5, 4, 8), at(2026, 5, 6, 8)).reduce(
      (n, c) => n + c.ms,
      0,
    );
    expect(total).toBe(MAX_SEGMENT_MS);
  });

  it("returns nothing for a zero-length or backwards range (a clock correction)", () => {
    expect(splitAcrossDays(at(2026, 5, 4, 10), at(2026, 5, 4, 10))).toEqual([]);
    expect(splitAcrossDays(at(2026, 5, 4, 10), at(2026, 5, 4, 9))).toEqual([]);
    expect(splitAcrossDays(NaN, at(2026, 5, 4, 10))).toEqual([]);
  });

  it("chunks are contiguous and sum to the elapsed time", () => {
    const start = at(2026, 5, 4, 22, 15);
    const end = start + 3 * HOUR;
    const chunks = splitAcrossDays(start, end);
    expect(chunks.reduce((n, c) => n + c.ms, 0)).toBe(3 * HOUR);
    expect(new Set(chunks.map((c) => c.day)).size).toBe(chunks.length); // no repeated day
  });
});

describe("ActivityLog", () => {
  /** A log driven by a clock the test advances by hand. */
  function log(start: number) {
    let clock = start;
    const l = new ActivityLog({}, () => clock);
    return { l, advance: (ms: number) => (clock += ms), set: (t: number) => (clock = t) };
  }

  const day = (l: ActivityLog, d: string) =>
    l.snapshot().find((x) => x.day === d) ?? ({} as DayActivity);

  it("counts a session and the foreground time it accrued", () => {
    const { l, advance } = log(at(2026, 4, 1, 12));
    l.start();
    advance(15 * MIN);
    l.stop();
    expect(day(l, "2026-04-01")).toMatchObject({ sessions: 1, activeMs: 15 * MIN });
  });

  it("ignores a second start and a stop that was never started", () => {
    const { l, advance } = log(at(2026, 4, 1, 12));
    l.stop(); // no session open
    l.start();
    l.start(); // already open
    advance(10 * MIN);
    l.stop();
    l.stop();
    expect(day(l, "2026-04-01")).toMatchObject({ sessions: 1, activeMs: 10 * MIN });
  });

  it("splits an overnight session into the two days it actually spanned", () => {
    const { l, set } = log(at(2026, 4, 1, 23, 50));
    l.start();
    set(at(2026, 4, 2, 0, 10));
    l.stop();
    expect(day(l, "2026-04-01").activeMs).toBe(10 * MIN);
    expect(day(l, "2026-04-02").activeMs).toBe(10 * MIN);
    expect(day(l, "2026-04-01").sessions).toBe(1);
  });

  it("checkpoint banks time so far without ending or double-counting the session", () => {
    const { l, advance } = log(at(2026, 4, 1, 12));
    l.start();
    advance(5 * MIN);
    l.checkpoint();
    expect(day(l, "2026-04-01").activeMs).toBe(5 * MIN);
    advance(5 * MIN);
    l.stop();
    expect(day(l, "2026-04-01")).toMatchObject({ activeMs: 10 * MIN, sessions: 1 });
  });

  it("records gameplay counters against the day they happened on", () => {
    const { l, set } = log(at(2026, 4, 1, 12));
    l.record("matches");
    l.record("matches", 2);
    set(at(2026, 4, 2, 9));
    l.record("puzzlesSolved");
    expect(day(l, "2026-04-01").matches).toBe(3);
    expect(day(l, "2026-04-02").puzzlesSolved).toBe(1);
    expect(day(l, "2026-04-02").matches).toBe(0);
  });

  it("only offers finished days for upload, never the day still in progress", () => {
    const { l, set } = log(at(2026, 4, 1, 12));
    l.start();
    set(at(2026, 4, 3, 10));
    l.stop();
    l.record("matches");
    const completed = l.completedDays().map((d) => d.day);
    expect(completed).toContain("2026-04-01");
    expect(completed).not.toContain("2026-04-03"); // today is still accumulating
  });

  it("forgets days that have been stored, keeping local storage bounded", () => {
    const { l, set } = log(at(2026, 4, 1, 12));
    l.record("matches");
    set(at(2026, 4, 2, 12));
    l.record("matches");
    l.forget(["2026-04-01"]);
    expect(l.snapshot().map((d) => d.day)).toEqual(["2026-04-02"]);
  });

  it("survives a clock that jumps backwards mid-session without going negative", () => {
    const { l, set } = log(at(2026, 4, 1, 12));
    l.start();
    set(at(2026, 4, 1, 11)); // device clock corrected backwards
    l.stop();
    const d = day(l, "2026-04-01");
    expect(d.activeMs).toBe(0);
    expect(d.sessions).toBe(1);
  });

  it("restores previously saved buckets and keeps adding to them", () => {
    const saved = {
      "2026-04-01": {
        day: "2026-04-01",
        activeMs: 60 * MIN,
        sessions: 2,
        matches: 4,
        puzzlesSolved: 1,
      },
    };
    let clock = at(2026, 4, 1, 18);
    const l = new ActivityLog(saved, () => clock);
    l.start();
    clock += 10 * MIN;
    l.stop();
    expect(day(l, "2026-04-01")).toMatchObject({ activeMs: 70 * MIN, sessions: 3, matches: 4 });
  });

  it("snapshot is ordered oldest first", () => {
    const { l, set } = log(at(2026, 4, 3, 12));
    l.record("matches");
    set(at(2026, 4, 1, 12));
    l.record("matches");
    set(at(2026, 4, 2, 12));
    l.record("matches");
    expect(l.snapshot().map((d) => d.day)).toEqual(["2026-04-01", "2026-04-02", "2026-04-03"]);
  });
});
