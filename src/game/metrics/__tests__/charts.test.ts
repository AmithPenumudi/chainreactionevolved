import { describe, expect, it } from "vitest";
import {
  bands,
  compact,
  duration,
  labelFits,
  linearScale,
  linePoints,
  niceStep,
  stackLayout,
} from "../charts";

describe("niceStep", () => {
  it("snaps to a 1/2/5 × 10^n step", () => {
    expect([niceStep(0.8), niceStep(1.7), niceStep(4), niceStep(9)]).toEqual([1, 2, 5, 10]);
    expect([niceStep(17), niceStep(230), niceStep(4_400)]).toEqual([20, 500, 5_000]);
  });

  it("never returns zero or a negative step, whatever it is given", () => {
    for (const n of [0, -5, NaN, Infinity]) expect(niceStep(n)).toBeGreaterThan(0);
  });
});

describe("linearScale", () => {
  it("is anchored at zero, so bar lengths stay proportional to their values", () => {
    const s = linearScale(90, 200);
    expect(s(0)).toBe(200); // zero sits on the baseline
    expect(s.ticks[0]).toBe(0);
  });

  it("rounds the top of the axis up to a clean tick above the data", () => {
    const s = linearScale(87, 200);
    expect(s.domainMax).toBeGreaterThanOrEqual(87);
    expect(s.ticks.at(-1)).toBe(s.domainMax);
    expect(s.ticks.every((t) => Number.isInteger(t))).toBe(true);
  });

  it("maps larger values to higher pixels (smaller y) and stays inside the plot", () => {
    const s = linearScale(50, 100);
    expect(s(50)).toBeLessThan(s(10));
    for (const v of [0, 25, 50]) {
      expect(s(v)).toBeGreaterThanOrEqual(0);
      expect(s(v)).toBeLessThanOrEqual(100);
    }
  });

  it("survives an all-zero series without dividing by zero", () => {
    const s = linearScale(0, 120);
    expect(Number.isFinite(s(0))).toBe(true);
    expect(s.domainMax).toBeGreaterThan(0);
    expect(s.ticks.length).toBeGreaterThan(1);
  });

  it("produces a readable number of ticks", () => {
    for (const max of [3, 40, 900, 12_500]) {
      const s = linearScale(max, 200);
      expect(s.ticks.length).toBeGreaterThanOrEqual(2);
      expect(s.ticks.length).toBeLessThanOrEqual(9);
    }
  });
});

describe("bands", () => {
  it("caps bar thickness at the mark spec rather than filling the slot", () => {
    const wide = bands(3, 900);
    expect(wide.every((b) => b.width <= 24)).toBe(true);
  });

  it("leaves a gap between neighbours at every density", () => {
    for (const count of [2, 7, 30, 90]) {
      const bs = bands(count, 600);
      for (let i = 1; i < bs.length; i++) {
        expect(bs[i].x).toBeGreaterThanOrEqual(bs[i - 1].x + bs[i - 1].width);
      }
    }
  });

  it("keeps every bar inside the plot width", () => {
    const bs = bands(12, 480);
    expect(bs[0].x).toBeGreaterThanOrEqual(0);
    expect(bs.at(-1)!.x + bs.at(-1)!.width).toBeLessThanOrEqual(480);
  });

  it("centres each bar in its slot and handles the empty case", () => {
    const bs = bands(4, 400);
    expect(bs.map((b) => b.centre)).toEqual([50, 150, 250, 350]);
    expect(bands(0, 400)).toEqual([]);
  });
});

describe("linePoints", () => {
  it("spans the full width from first to last point", () => {
    const s = linearScale(10, 100);
    const pts = linePoints([1, 5, 10], s, 300);
    expect(pts[0][0]).toBe(0);
    expect(pts.at(-1)![0]).toBe(300);
  });

  it("centres a single point instead of collapsing to x=0", () => {
    const pts = linePoints([7], linearScale(10, 100), 300);
    expect(pts).toEqual([[150, linearScale(10, 100)(7)]]);
  });

  it("returns nothing for an empty series", () => {
    expect(linePoints([], linearScale(1, 10), 100)).toEqual([]);
  });
});

describe("stackLayout", () => {
  const entries = [
    { key: "classic", value: 60 },
    { key: "abilities", value: 30 },
    { key: "arena", value: 10 },
  ];

  it("fills the width exactly, including the gaps between segments", () => {
    const segs = stackLayout(entries, 600, 2);
    const end = segs.at(-1)!.x + segs.at(-1)!.width;
    expect(end).toBeCloseTo(600, 5);
  });

  it("widths are proportional to the values", () => {
    const segs = stackLayout(entries, 604, 2); // 600 usable after two 2px gaps
    expect(segs[0].width).toBeCloseTo(360, 5);
    expect(segs[1].width).toBeCloseTo(180, 5);
    expect(segs[2].width).toBeCloseTo(60, 5);
    expect(segs.map((s) => s.share)).toEqual([0.6, 0.3, 0.1]);
  });

  it("drops zero categories so they cannot render as an unlabelable sliver", () => {
    const segs = stackLayout([...entries, { key: "unused", value: 0 }], 600);
    expect(segs.map((s) => s.key)).toEqual(["classic", "abilities", "arena"]);
  });

  it("returns nothing when there is no data at all", () => {
    expect(stackLayout([], 600)).toEqual([]);
    expect(stackLayout([{ key: "a", value: 0 }], 600)).toEqual([]);
  });

  it("a single category takes the whole bar with no leftover gap", () => {
    const segs = stackLayout([{ key: "only", value: 5 }], 600);
    expect(segs).toHaveLength(1);
    expect(segs[0].width).toBeCloseTo(600, 5);
  });
});

describe("compact", () => {
  it("keeps small numbers exact and thousands-separated", () => {
    expect(compact(0)).toBe("0");
    expect(compact(1_284)).toBe("1,284");
    expect(compact(9_999)).toBe("9,999");
  });

  it("abbreviates once numbers stop fitting a tile", () => {
    expect(compact(12_900)).toBe("12.9K");
    expect(compact(10_000)).toBe("10K");
    expect(compact(3_400_000)).toBe("3.4M");
  });

  it("handles nonsense without rendering NaN into the page", () => {
    expect(compact(NaN)).toBe("—");
    expect(compact(Infinity)).toBe("—");
  });
});

describe("duration", () => {
  it("reads as hours and minutes", () => {
    expect(duration(3.333)).toBe("3h 20m");
    expect(duration(0.75)).toBe("45m");
    expect(duration(0)).toBe("0m");
  });

  it("never renders a negative or NaN duration", () => {
    expect(duration(-4)).toBe("0m");
    expect(duration(NaN)).toBe("0m");
  });
});

describe("labelFits", () => {
  it("rejects a label that would be clipped by its own segment", () => {
    expect(labelFits("Abilities 30%", 40)).toBe(false);
    expect(labelFits("Abilities 30%", 300)).toBe(true);
  });

  it("requires padding on both sides, not just a bare fit", () => {
    const text = "Classic";
    const bare = text.length * 6.2;
    expect(labelFits(text, bare)).toBe(false);
    expect(labelFits(text, bare + 16)).toBe(true);
  });
});
