import { describe, expect, it } from "vitest";
import { MAX_UNDOS, undoAllowed, UndoHistory } from "../undo";

describe("UndoHistory", () => {
  it("starts empty: nothing to undo", () => {
    const h = new UndoHistory<number>();
    expect(h.canUndo).toBe(false);
    expect(h.undo()).toBeUndefined();
    expect(h.remaining).toBe(MAX_UNDOS);
  });

  it("returns snapshots newest-first and spends one undo each", () => {
    const h = new UndoHistory<string>();
    h.record("a");
    h.record("b");
    expect(h.undo()).toBe("b");
    expect(h.remaining).toBe(MAX_UNDOS - 1);
    expect(h.undo()).toBe("a");
    expect(h.undo()).toBeUndefined();
  });

  it("never allows more than the limit, even with unlimited snapshots", () => {
    const h = new UndoHistory<number>(3);
    for (let i = 0; i < 10; i++) h.record(i);
    expect([h.undo(), h.undo(), h.undo(), h.undo()]).toEqual([9, 8, 7, undefined]);
    expect(h.remaining).toBe(0);
    expect(h.canUndo).toBe(false);
    h.record(99); // a new move does not refill the undo budget
    expect(h.canUndo).toBe(false);
  });

  it("keeps only the last `limit` positions", () => {
    const h = new UndoHistory<number>(2);
    [1, 2, 3, 4].forEach((n) => h.record(n));
    expect(h.undo()).toBe(4);
    expect(h.undo()).toBe(3);
    expect(h.undo()).toBeUndefined();
  });

  it("a zero limit disables undo entirely", () => {
    const h = new UndoHistory<number>(0);
    h.record(1);
    expect(h.canUndo).toBe(false);
    expect(h.undo()).toBeUndefined();
  });

  it("recording after an undo lets you keep undoing while budget remains", () => {
    const h = new UndoHistory<string>(3);
    h.record("a");
    expect(h.undo()).toBe("a");
    h.record("b");
    expect(h.canUndo).toBe(true);
    expect(h.undo()).toBe("b");
    expect(h.remaining).toBe(1);
  });
});

describe("undoAllowed", () => {
  it("only for exactly one human against at least one bot", () => {
    expect(undoAllowed([{}, { isAI: true }])).toBe(true);
    expect(undoAllowed([{}, { isAI: true }, { isAI: true }])).toBe(true);
    expect(undoAllowed([{}, {}])).toBe(false); // hot-seat
    expect(undoAllowed([{}, {}, { isAI: true }])).toBe(false);
    expect(undoAllowed([{ isAI: true }, { isAI: true }])).toBe(false); // bots only
    expect(undoAllowed([{}])).toBe(false);
  });
});
