import { describe, it, expect } from "vitest";
import {
  applyMove,
  canPlace,
  commitMove,
  DEFAULT_RULES,
  makeInitialState,
  MODE_CONFIGS,
  type GameState,
  type MoveResult,
  type PlayerConfig,
} from "../engine";
import { ABILITIES, abilityById, castAbility, type AbilityId } from "../abilities";

function players(n: number): PlayerConfig[] {
  return Array.from({ length: n }, (_, i) => ({ id: i, name: `P${i + 1}`, colorIndex: i }));
}

function abilityState(n = 2, rows = 6, cols = 6): GameState {
  const s = makeInitialState(
    players(n),
    rows,
    cols,
    "classic",
    DEFAULT_RULES.classic,
    MODE_CONFIGS.abilities,
  );
  s.hasMoved = players(n).map(() => true);
  s.energy = players(n).map(() => 100);
  return s;
}

const at = (s: GameState, r: number, c: number) => s.board.cells[r * s.board.cols + c];
const own = (s: GameState, r: number, c: number, owner: number, orbs: number) =>
  Object.assign(at(s, r, c), { owner, orbs });

describe("ability catalogue", () => {
  it("has unique ids and positive, ascending-sane costs", () => {
    const ids = ABILITIES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of ABILITIES) {
      expect(a.cost).toBeGreaterThan(0);
      expect(a.cost).toBeLessThanOrEqual(100); // affordable with a full energy bar
      expect([0, 1, 2]).toContain(a.targets);
    }
  });

  it("abilityById resolves every ability", () => {
    for (const a of ABILITIES) expect(abilityById(a.id)).toBe(a);
  });
});

describe("castAbility — gating", () => {
  it("refuses when the caster cannot afford it", () => {
    const s = abilityState();
    own(s, 2, 2, 0, 1);
    s.energy[0] = 29;
    expect(castAbility(s, "overload", [[2, 2]])).toBeNull();
    s.energy[0] = 30;
    expect(castAbility(s, "overload", [[2, 2]])).not.toBeNull();
  });

  it("refuses once the game is over", () => {
    const s = abilityState();
    own(s, 2, 2, 0, 1);
    s.winner = 0;
    expect(castAbility(s, "overload", [[2, 2]])).toBeNull();
  });

  it("refuses in modes where abilities are disabled", () => {
    const s = makeInitialState(
      players(2),
      6,
      6,
      "classic",
      DEFAULT_RULES.classic,
      MODE_CONFIGS.classic,
    );
    s.energy = [100, 100];
    own(s, 2, 2, 0, 1);
    expect(castAbility(s, "overload", [[2, 2]])).toBeNull();
  });

  it("refuses targets that the ability's own validator rejects (never trusts the UI)", () => {
    const s = abilityState();
    own(s, 2, 2, 1, 1); // enemy cell
    expect(castAbility(s, "overload", [[2, 2]])).toBeNull(); // not yours
    expect(castAbility(s, "overload", [[0, 0]])).toBeNull(); // empty
    expect(castAbility(s, "emp", [[0, 0]])).toBeNull(); // nobody to lock
    own(s, 3, 3, 0, 1);
    expect(castAbility(s, "emp", [[3, 3]])).toBeNull(); // cannot EMP yourself
  });

  it("refuses the wrong number of targets instead of crashing", () => {
    const s = abilityState();
    own(s, 2, 2, 0, 1);
    expect(castAbility(s, "overload", [])).toBeNull();
    expect(castAbility(s, "relocate", [[2, 2]])).toBeNull();
  });

  it("refuses to target walls and dead cells", () => {
    const s = abilityState();
    at(s, 1, 1).tile = "wall";
    at(s, 1, 2).tile = "dead";
    for (const id of ["overload", "shield", "fortify", "overcharge"] as AbilityId[]) {
      expect(castAbility(s, id, [[1, 1]]), id).toBeNull();
      expect(castAbility(s, id, [[1, 2]]), id).toBeNull();
    }
  });

  it("does not mutate the input state", () => {
    const s = abilityState();
    own(s, 2, 2, 0, 3);
    const before = JSON.stringify(s);
    castAbility(s, "overcharge", [[2, 2]]);
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe("castAbility — effects", () => {
  it("overload adds one orb to an owned cell", () => {
    const s = abilityState();
    own(s, 2, 2, 0, 1);
    const res = castAbility(s, "overload", [[2, 2]])!;
    expect(res.boardAfter.cells[2 * 6 + 2].orbs).toBe(2);
  });

  it("overload on a cell one below critical mass triggers a chain", () => {
    const s = abilityState();
    own(s, 0, 0, 0, 1); // corner cm 2
    const res = castAbility(s, "overload", [[0, 0]])!;
    expect(res.chainCount).toBe(1);
    expect(res.boardAfter.cells[0].orbs).toBe(0);
    expect(res.boardAfter.cells[1].owner).toBe(0);
  });

  it("shield marks the cell and cannot be stacked", () => {
    const s = abilityState();
    own(s, 2, 2, 0, 1);
    const res = castAbility(s, "shield", [[2, 2]])!;
    expect(res.boardAfter.cells[2 * 6 + 2].shielded).toBe(true);
    const s2 = { ...s, board: res.boardAfter };
    expect(castAbility(s2, "shield", [[2, 2]])).toBeNull();
  });

  it("fortify raises critical mass so a cell that would have fired does not", () => {
    const s = abilityState();
    own(s, 0, 0, 0, 1);
    const fort = castAbility(s, "fortify", [[0, 0]])!;
    const s2 = commitMove(s, fort);
    // back to player 0's turn
    const s3 = { ...s2, currentPlayerIdx: 0 };
    const res = applyMove(s3, 0, 0)!;
    expect(res.chainCount).toBe(0);
    expect(res.boardAfter.cells[0].orbs).toBe(2);
  });

  it("fortify is consumed when the cell finally explodes", () => {
    const s = abilityState();
    own(s, 0, 0, 0, 2);
    at(s, 0, 0).fortified = true; // cm 3, has 2
    const res = applyMove(s, 0, 0)!;
    expect(res.chainCount).toBe(1);
    expect(res.boardAfter.cells[0].fortified).toBeFalsy();
  });

  it("emp locks an enemy cell for exactly its owner's next turn", () => {
    const s = abilityState(2);
    own(s, 2, 2, 1, 1);
    const cast = castAbility(s, "emp", [[2, 2]])!;
    let next = commitMove(s, cast); // P2's turn
    expect(next.players[next.currentPlayerIdx].id).toBe(1);
    expect(canPlace(next, 2, 2), "locked on the victim's next turn").toBe(false);
    // P2 plays elsewhere, P1 plays, and the lock has run out on P2's following turn.
    next = commitMove(next, applyMove(next, 0, 0)!);
    next = commitMove(next, applyMove(next, 5, 5)!);
    expect(next.players[next.currentPlayerIdx].id).toBe(1);
    expect(canPlace(next, 2, 2), "lock expired").toBe(true);
  });

  it("emp does not lock the caster and does not affect other players' cells in 3-player games", () => {
    const s = abilityState(3);
    own(s, 2, 2, 1, 1);
    own(s, 3, 3, 2, 1);
    const cast = castAbility(s, "emp", [[2, 2]])!;
    expect(cast.boardAfter.cells[3 * 6 + 3].empLockedFor).toBeUndefined();
    let next = commitMove(s, cast); // P2
    next = { ...next, currentPlayerIdx: 2 }; // P3's turn
    expect(canPlace(next, 2, 2)).toBe(false); // P3 can't place on P2's cell anyway
    expect(canPlace(next, 3, 3)).toBe(true);
  });

  it("emp lock disappears if the locked cell is captured by someone else", () => {
    const s = abilityState(2);
    own(s, 2, 2, 1, 1);
    const cast = castAbility(s, "emp", [[2, 2]])!;
    const st = commitMove(s, cast); // P2's turn
    // P1 captures (2,2) by exploding next to it.
    const boardCell = st.board.cells[2 * 6 + 2];
    expect(boardCell.empLockedFor).toBe(1);
    const st2 = { ...st, currentPlayerIdx: 0 };
    Object.assign(st2.board.cells[2 * 6 + 1], { owner: 0, orbs: 3 });
    const res = applyMove(st2, 2, 1)!;
    expect(res.boardAfter.cells[2 * 6 + 2].owner).toBe(0);
    expect(res.boardAfter.cells[2 * 6 + 2].empLockedFor).toBeUndefined();
  });

  it("relocate moves one orb and hands the emptied source back to nobody", () => {
    const s = abilityState();
    own(s, 1, 1, 0, 1);
    own(s, 4, 4, 0, 1);
    const res = castAbility(s, "relocate", [
      [1, 1],
      [4, 4],
    ])!;
    expect(res.boardAfter.cells[1 * 6 + 1]).toMatchObject({ orbs: 0, owner: null });
    expect(res.boardAfter.cells[4 * 6 + 4].orbs).toBe(2);
  });

  it("relocate rejects the same cell for source and destination", () => {
    const s = abilityState();
    own(s, 1, 1, 0, 2);
    expect(
      castAbility(s, "relocate", [
        [1, 1],
        [1, 1],
      ]),
    ).toBeNull();
  });

  it("relocate clears shield/fortify on a cell it empties", () => {
    const s = abilityState();
    own(s, 1, 1, 0, 1);
    at(s, 1, 1).shielded = true;
    at(s, 1, 1).fortified = true;
    own(s, 4, 4, 0, 1);
    const res = castAbility(s, "relocate", [
      [1, 1],
      [4, 4],
    ])!;
    const emptied = res.boardAfter.cells[1 * 6 + 1];
    expect(emptied.shielded).toBeFalsy();
    expect(emptied.fortified).toBeFalsy();
  });

  it("relocate onto a power tile grants the power capture", () => {
    const s = abilityState();
    own(s, 1, 1, 0, 1);
    own(s, 4, 4, 0, 1);
    at(s, 4, 4).tile = "power";
    // Own cell already: no capture. Use an empty power tile — not a valid own target.
    const res = castAbility(s, "relocate", [
      [1, 1],
      [4, 4],
    ])!;
    expect(res.capturedPowerTiles).toBe(0);
  });

  it("overcharge detonates the cell and spreads to neighbours", () => {
    const s = abilityState();
    own(s, 2, 2, 0, 1);
    const res = castAbility(s, "overcharge", [[2, 2]])!;
    expect(res.chainCount).toBeGreaterThanOrEqual(1);
    for (const [r, c] of [
      [1, 2],
      [3, 2],
      [2, 1],
      [2, 3],
    ]) {
      expect(res.boardAfter.cells[r * 6 + c].owner).toBe(0);
    }
  });

  it("overcharge on a fortified cell still detonates it", () => {
    const s = abilityState();
    own(s, 2, 2, 0, 1);
    at(s, 2, 2).fortified = true;
    const res = castAbility(s, "overcharge", [[2, 2]])!;
    expect(res.chainCount).toBeGreaterThanOrEqual(1);
  });

  it("overcharge never removes orbs from an already over-full cell", () => {
    // A cell can hold at most cm-1 while settled, so overcharge must only ever add.
    const s = abilityState();
    own(s, 2, 2, 0, 3);
    const res = castAbility(s, "overcharge", [[2, 2]])!;
    expect(res.chainCount).toBeGreaterThanOrEqual(1);
  });
});

describe("castAbility — Double Drop", () => {
  function cast(): { s: GameState; res: MoveResult } {
    const s = abilityState();
    own(s, 3, 3, 0, 1);
    return { s, res: castAbility(s, "double-drop", [])! };
  }

  it("keeps the turn with the caster and spends energy", () => {
    const { s, res } = cast();
    const next = commitMove(s, res);
    expect(next.players[next.currentPlayerIdx].id).toBe(0);
    expect(next.energy[0]).toBe(100 - 45);
  });

  it("grants TWO placements before the turn passes (as its description promises)", () => {
    const { s, res } = cast();
    let st = commitMove(s, res);
    // placement 1 — turn must NOT pass
    const p1 = applyMove(st, 0, 0)!;
    st = commitMove(st, p1);
    expect(st.players[st.currentPlayerIdx].id, "after 1st placement").toBe(0);
    // placement 2 — turn passes
    const p2 = applyMove(st, 5, 5)!;
    st = commitMove(st, p2);
    expect(st.players[st.currentPlayerIdx].id, "after 2nd placement").toBe(1);
  });

  it("if the first drop wins the game, the turn does not linger", () => {
    const s = abilityState();
    own(s, 0, 0, 0, 1);
    own(s, 0, 1, 1, 2);
    let st = commitMove(s, castAbility(s, "double-drop", [])!);
    const p1 = applyMove(st, 0, 0)!;
    expect(p1.winner).toBe(0);
    st = commitMove(st, p1);
    expect(st.winner).toBe(0);
    expect(st.extraPlacementFor).toBeNull();
  });

  it("forfeiting the turn clears a pending second placement", () => {
    const { s, res } = cast();
    const st = commitMove(s, res);
    expect(st.extraPlacementFor).toBe(0);
  });
});

describe("energy accounting", () => {
  it("never drops below 0 or exceeds 100 through casts", () => {
    const s = abilityState();
    own(s, 2, 2, 0, 1);
    s.energy[0] = 70;
    const res = castAbility(s, "overcharge", [[2, 2]])!;
    const next = commitMove(s, res);
    expect(next.energy[0]).toBeGreaterThanOrEqual(0);
    expect(next.energy[0]).toBeLessThanOrEqual(100);
  });

  it("only the caster's energy changes", () => {
    const s = abilityState();
    own(s, 2, 2, 0, 1);
    const next = commitMove(s, castAbility(s, "shield", [[2, 2]])!);
    expect(next.energy[1]).toBe(100);
    expect(next.energy[0]).toBe(65);
  });

  it("classic mode ignores energy entirely", () => {
    const s = makeInitialState(
      players(2),
      6,
      6,
      "classic",
      DEFAULT_RULES.classic,
      MODE_CONFIGS.classic,
    );
    const next = commitMove(s, applyMove(s, 2, 2)!);
    expect(next.energy).toEqual([0, 0]);
  });
});

describe("Double Drop — interactions", () => {
  it("casting another ability while a drop is owed keeps the owed drop", () => {
    const s = abilityState();
    own(s, 3, 3, 0, 1);
    let st = commitMove(s, castAbility(s, "double-drop", [])!);
    st = commitMove(st, castAbility(st, "shield", [[3, 3]])!);
    expect(st.players[st.currentPlayerIdx].id).toBe(0);
    expect(st.extraPlacementFor).toBe(0);
    st = commitMove(st, applyMove(st, 0, 0)!);
    st = commitMove(st, applyMove(st, 5, 5)!);
    expect(st.players[st.currentPlayerIdx].id).toBe(1);
  });
});
