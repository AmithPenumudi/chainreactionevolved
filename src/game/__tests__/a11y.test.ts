import { describe, expect, it } from "vitest";
import { cellLabel } from "../a11y";
import type { Cell } from "../engine";

const cell = (over: Partial<Cell> = {}): Cell => ({ orbs: 0, owner: null, ...over });

describe("cellLabel", () => {
  it("uses 1-based positions and says empty", () => {
    expect(cellLabel(cell(), 0, 0, 2)).toBe("Row 1, column 1, empty");
  });

  it("describes orbs against critical mass and names the owner colour", () => {
    expect(cellLabel(cell({ orbs: 2, owner: 0 }), 2, 3, 4, 1)).toBe(
      "Row 3, column 4, 2 of 4 orbs, Neon Red",
    );
  });

  it("warns when a cell is about to explode", () => {
    expect(cellLabel(cell({ orbs: 3, owner: 1 }), 1, 1, 4, 0)).toContain("about to explode");
    expect(cellLabel(cell({ orbs: 1, owner: 1 }), 1, 1, 4, 0)).not.toContain("about to explode");
  });

  it("falls back to a player number without a colour index", () => {
    expect(cellLabel(cell({ orbs: 1, owner: 2 }), 0, 0, 3)).toContain("player 3");
  });

  it("names every tile kind; walls and dead zones stop there", () => {
    expect(cellLabel(cell({ tile: "wall" }), 0, 1, 4)).toBe("Row 1, column 2, wall");
    expect(cellLabel(cell({ tile: "dead" }), 0, 1, 4)).toBe("Row 1, column 2, dead zone");
    for (const t of ["power", "portal", "amplifier", "reactor"] as const)
      expect(cellLabel(cell({ tile: t }), 0, 0, 4)).toContain(t === "power" ? "power tile" : t);
  });

  it("lists every modifier", () => {
    const l = cellLabel(
      cell({ orbs: 1, owner: 0, shielded: true, fortified: true, empLockedFor: 0 }),
      0,
      0,
      4,
      0,
    );
    expect(l).toContain("shielded");
    expect(l).toContain("fortified");
    expect(l).toContain("locked by EMP");
  });

  it("never returns an empty label for any combination", () => {
    for (const tile of [
      undefined,
      "wall",
      "dead",
      "power",
      "portal",
      "amplifier",
      "reactor",
    ] as const)
      for (const owner of [null, 0, 5])
        for (const orbs of [0, 1, 3])
          expect(cellLabel(cell({ tile, owner, orbs }), 0, 0, 2, 0).length).toBeGreaterThan(5);
  });
});
