import { makeBoard, type BoardState, type ModeKind } from "./engine";

/* ---------------------------------------------------------------------------
 * Puzzle Challenges
 *
 * A puzzle is a fixed board position plus an objective evaluated from real
 * engine state. Only the solver ever moves — opponents are static — so every
 * puzzle is deterministic and solved by strategy, never luck.
 * ------------------------------------------------------------------------- */

export type PuzzleDifficulty = "easy" | "medium" | "hard" | "expert";

export const DIFFICULTY_ORDER: PuzzleDifficulty[] = ["easy", "medium", "hard", "expert"];

export const DIFFICULTY_LABEL: Record<PuzzleDifficulty, string> = {
  easy: "EASY",
  medium: "MEDIUM",
  hard: "HARD",
  expert: "EXPERT",
};

export type Medal = "gold" | "silver" | "bronze";

export const MEDAL_LABEL: Record<Medal, string> = {
  gold: "GOLD",
  silver: "SILVER",
  bronze: "BRONZE",
};

export const MEDAL_COLOR: Record<Medal, string> = {
  gold: "oklch(0.82 0.16 85)",
  silver: "oklch(0.80 0.02 260)",
  bronze: "oklch(0.66 0.11 55)",
};

export const MEDAL_XP_MULT: Record<Medal, number> = { gold: 1, silver: 0.7, bronze: 0.5 };

export interface PuzzleCellSpec {
  row: number;
  col: number;
  /** Index into the puzzle player list; 0 is always the solver. Omit for neutral. */
  owner?: number;
  orbs?: number;
  tile?: "portal" | "wall" | "amplifier" | "power";
  /** Pairs portals together. */
  portalGroup?: number;
  /** Marks a cell the objective refers to. */
  highlighted?: boolean;
}

export type PuzzleObjective =
  /** Opponent at this index owns no cells. */
  | { kind: "eliminate"; playerIdx: number }
  /** All opponents own no cells. */
  | { kind: "eliminate-all" }
  /** A single move produced at least this many explosions. */
  | { kind: "chain"; minExplosions: number }
  /** The solver owns this cell. */
  | { kind: "capture"; row: number; col: number };

export interface PuzzleDef {
  id: string;
  name: string;
  brief: string;
  difficulty: PuzzleDifficulty;
  modeKind: ModeKind;
  rows: number;
  cols: number;
  /** Colour slots; index 0 is the solver. */
  playerColors: number[];
  /** Hard cap — exceeding it fails the attempt. */
  maxMoves: number;
  /** Move counts for each medal (gold <= silver <= bronze <= maxMoves). */
  medals: { gold: number; silver: number; bronze: number };
  cells: PuzzleCellSpec[];
  objective: PuzzleObjective;
  xp: number;
  hint?: string;
}

/**
 * Fills a rectangular sub-region with solver orbs one below critical mass, so the
 * cluster ignites the instant it's touched. Deliberately bounded (never the whole
 * board) — a fully-tiled same-owner board has no empty space to dissipate into and
 * can cycle for thousands of steps before the engine's safety cap cuts it off.
 */
function loadedBlock(
  rows: number,
  cols: number,
  r0: number,
  c0: number,
  r1: number,
  c1: number,
  owner = 0,
): PuzzleCellSpec[] {
  const out: PuzzleCellSpec[] = [];
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const edgeR = r === 0 || r === rows - 1;
      const edgeC = c === 0 || c === cols - 1;
      const cm = edgeR && edgeC ? 2 : edgeR || edgeC ? 3 : 4;
      out.push({ row: r, col: c, owner, orbs: cm - 1 });
    }
  }
  return out;
}

export const PUZZLES: PuzzleDef[] = [
  /* ----------------------------- EASY ----------------------------- */

  // 1 — IGNITION (single move, eliminate)
  // Board: 4×4. Corner cap=2, edge cap=3.
  // Player (0,0)=1 [corner]. Opponent (0,1)=1 [edge].
  // Solution: place at (0,0) → 1+1=2=cap → explodes → (0,1) captured → opponent eliminated.
  {
    id: "e-ignition",
    name: "IGNITION",
    brief: "The corner is loaded. One orb triggers a chain straight into RED.",
    difficulty: "easy",
    modeKind: "classic",
    rows: 4,
    cols: 4,
    playerColors: [0, 1],
    maxMoves: 2,
    medals: { gold: 1, silver: 1, bronze: 2 },
    xp: 200,
    hint: "A corner bursts after just 2 orbs — yours already has 1.",
    objective: { kind: "eliminate", playerIdx: 1 },
    cells: [
      { row: 0, col: 0, owner: 0, orbs: 1 },  // player corner (cap 2)
      { row: 0, col: 1, owner: 1, orbs: 1 },  // opponent edge
    ],
  },

  // 2 — RIPPLE (single move, chain ≥3)
  // Board: 5×5. Row of 3 player cells, all one orb from bursting.
  // (0,0)=1 corner, (0,1)=2 edge, (0,2)=2 edge. Opponent (4,4)=1 for context.
  // Solution: place at (0,2) → explodes[1] → (0,1) explodes[2] → (0,0) explodes[3].
  {
    id: "e-ripple",
    name: "RIPPLE",
    brief: "Three edge cells in a row, all near their limit. Start the rightmost and the chain travels left.",
    difficulty: "easy",
    modeKind: "classic",
    rows: 5,
    cols: 5,
    playerColors: [0, 1],
    maxMoves: 2,
    medals: { gold: 1, silver: 1, bronze: 2 },
    xp: 220,
    hint: "Drop an orb at the right end — explosions travel through neighboring loaded cells.",
    objective: { kind: "chain", minExplosions: 3 },
    cells: [
      { row: 0, col: 0, owner: 0, orbs: 1 },  // corner, cap 2
      { row: 0, col: 1, owner: 0, orbs: 2 },  // edge, cap 3
      { row: 0, col: 2, owner: 0, orbs: 2 },  // edge, cap 3
      { row: 4, col: 4, owner: 1, orbs: 1 },  // opponent — context only
    ],
  },

  // 3 — REACH OUT (single move, capture)
  // Board: 5×5. Player (2,3)=3 [interior, cap 4]. Target (2,4)=2 [edge, cap 3, highlighted].
  // Opponent also holds (0,0)=1 so they survive the capture (objective is capture only, not eliminate).
  // Solution: place at (2,3) → 3+1=4=cap → explodes → (2,4) captured (objective met).
  {
    id: "e-reach-out",
    name: "REACH OUT",
    brief: "You only need to claim the highlighted cell — a full elimination isn't required.",
    difficulty: "easy",
    modeKind: "classic",
    rows: 5,
    cols: 5,
    playerColors: [0, 1],
    maxMoves: 2,
    medals: { gold: 1, silver: 1, bronze: 2 },
    xp: 200,
    hint: "Your loaded interior cell is one step from the target.",
    objective: { kind: "capture", row: 2, col: 4 },
    cells: [
      { row: 2, col: 3, owner: 0, orbs: 3 },                     // player interior, cap 4
      { row: 2, col: 4, owner: 1, orbs: 2, highlighted: true },  // opponent target, edge cap 3
      { row: 0, col: 0, owner: 1, orbs: 1 },                     // opponent's extra cell (survives)
    ],
  },

  // 4 — COLUMN STRIKE (2 moves, eliminate)
  // Board: 5×5. Opponent corners at (0,0) and (4,0). Player edges at (1,0) and (3,0).
  // Solution move 1: place at (1,0) → 2+1=3=cap → explodes → (0,0) captured (corner bursts).
  // Solution move 2: place at (3,0) → 2+1=3=cap → explodes → (4,0) captured → eliminated.
  // Both orders work (fire top or bottom first).
  {
    id: "e-column-strike",
    name: "COLUMN STRIKE",
    brief: "RED holds the top and bottom of the left column. Attack from between them.",
    difficulty: "easy",
    modeKind: "classic",
    rows: 5,
    cols: 5,
    playerColors: [0, 1],
    maxMoves: 3,
    medals: { gold: 2, silver: 2, bronze: 3 },
    xp: 220,
    hint: "Each of your cells is primed right beside an opponent corner — fire both, one at a time.",
    objective: { kind: "eliminate", playerIdx: 1 },
    cells: [
      { row: 0, col: 0, owner: 1, orbs: 1 },  // opponent corner, cap 2
      { row: 4, col: 0, owner: 1, orbs: 1 },  // opponent corner, cap 2
      { row: 1, col: 0, owner: 0, orbs: 2 },  // player edge, cap 3
      { row: 3, col: 0, owner: 0, orbs: 2 },  // player edge, cap 3
    ],
  },

  // 5 — CROSS FIRE (single move, chain ≥5)
  // Board: 5×5. Center (2,2)=3 + 4 interior neighbors each at 3. Opponent (0,4)=1 for context.
  // Solution: place at (2,2) → explodes[1] → all 4 neighbors hit 4=cap → each explodes[2][3][4][5].
  {
    id: "e-cross-fire",
    name: "CROSS FIRE",
    brief: "Five loaded cells form a cross. Drop one orb into the middle and all five ignite.",
    difficulty: "easy",
    modeKind: "classic",
    rows: 5,
    cols: 5,
    playerColors: [0, 1],
    maxMoves: 2,
    medals: { gold: 1, silver: 1, bronze: 2 },
    xp: 250,
    hint: "The center fires in all four directions at once — one orb is enough.",
    objective: { kind: "chain", minExplosions: 5 },
    cells: [
      { row: 2, col: 2, owner: 0, orbs: 3 },  // center interior, cap 4
      { row: 1, col: 2, owner: 0, orbs: 3 },  // north interior, cap 4
      { row: 3, col: 2, owner: 0, orbs: 3 },  // south interior, cap 4
      { row: 2, col: 1, owner: 0, orbs: 3 },  // west interior, cap 4
      { row: 2, col: 3, owner: 0, orbs: 3 },  // east interior, cap 4
      { row: 0, col: 4, owner: 1, orbs: 1 },  // opponent — context only
    ],
  },

  // 6 — STAGED BLAST (2 moves, chain ≥6)
  // Board: 5×5. Center (2,2)=2 (needs loading). Four interior arms at 3. (2,4) and (2,0) edges at 2.
  // Plus (1,2)=3 as an arm and (3,3)=3 as a chain extender off the south arm.
  // Move 1: place at (2,2) → 2+1=3 (no explosion — setting up).
  // Move 2: place at (2,1) → 3+1=4=cap → explodes[1] → (2,0) edge[2] + (2,2)[3] →
  //   (2,2) fires: (1,2)[4] + (2,3)[5] → (2,3) fires: (2,4) edge[6]. Total = 6.
  // Multiple valid move-2 triggers: (2,1), (2,3), or (1,2) all produce ≥6.
  {
    id: "e-staged-blast",
    name: "STAGED BLAST",
    brief: "The center needs one more orb before it can trigger the full chain. Load it first, then fire.",
    difficulty: "easy",
    modeKind: "classic",
    rows: 5,
    cols: 5,
    playerColors: [0, 1],
    maxMoves: 3,
    medals: { gold: 2, silver: 2, bronze: 3 },
    xp: 280,
    hint: "Move 1 adds a single orb to the center. Move 2 detonates from any loaded neighbor.",
    objective: { kind: "chain", minExplosions: 6 },
    cells: [
      { row: 2, col: 2, owner: 0, orbs: 2 },  // center interior, needs 1 more to be ready
      { row: 2, col: 1, owner: 0, orbs: 3 },  // west arm, interior cap 4
      { row: 2, col: 3, owner: 0, orbs: 3 },  // east arm, interior cap 4
      { row: 1, col: 2, owner: 0, orbs: 3 },  // north arm, interior cap 4
      { row: 2, col: 0, owner: 0, orbs: 2 },  // far west, edge cap 3
      { row: 2, col: 4, owner: 0, orbs: 2 },  // far east, edge cap 3
      { row: 0, col: 0, owner: 1, orbs: 1 },  // opponent — context only
    ],
  },

  /* ---------------------------- MEDIUM ---------------------------- */

  // 7 — WALL TRICK (single move, eliminate, arena)
  // Board: 5×5. Two wall tiles flank (2,1), reducing its effective critical mass to 2.
  // effectiveCriticalMass counts only non-wall neighbors → (1,1) and (3,1) → cm=2.
  // Player: (2,1)=1 [effective cm=2]. Opponent: (1,1)=1, (3,1)=1.
  // Solution: place at (2,1) → 1+1=2=cm → explodes → (1,1) and (3,1) captured → eliminated.
  // Walls block left and right propagation so explosion only reaches up/down.
  {
    id: "m-wall-trick",
    name: "WALL TRICK",
    brief: "Walls block explosion paths — and shrink a cell's critical mass to match.",
    difficulty: "medium",
    modeKind: "arena",
    rows: 5,
    cols: 5,
    playerColors: [0, 1],
    maxMoves: 2,
    medals: { gold: 1, silver: 1, bronze: 2 },
    xp: 350,
    hint: "Count only the non-wall neighbors to find the cell's true critical mass.",
    objective: { kind: "eliminate", playerIdx: 1 },
    cells: [
      { row: 2, col: 0, tile: "wall" },             // blocks left neighbor of player cell
      { row: 2, col: 2, tile: "wall" },             // blocks right neighbor of player cell
      { row: 2, col: 1, owner: 0, orbs: 1 },        // player — only 2 non-wall neighbors → cm=2
      { row: 1, col: 1, owner: 1, orbs: 1 },        // opponent above
      { row: 3, col: 1, owner: 1, orbs: 1 },        // opponent below
    ],
  },

  // 8 — PORTAL HOP (single move, capture, arena)
  // Board: 6×6. Portal A at (0,0) [corner, empty]. Portal B at (5,5) [corner, player, orbs=1, cap=2].
  // Player: (0,1)=2 [edge,cap=3] and (1,0)=2 [edge,cap=3].
  // Solution: place at (0,1) OR (1,0) → explodes → orb enters portal A → teleports to B →
  //   B goes 1+1=2=cap=2 → fires → (4,5) captured (objective met).
  {
    id: "m-portal-hop",
    name: "PORTAL HOP",
    brief: "Fire near Portal A and the explosion emerges from Portal B — right beside the target.",
    difficulty: "medium",
    modeKind: "arena",
    rows: 6,
    cols: 6,
    playerColors: [0, 1],
    maxMoves: 2,
    medals: { gold: 1, silver: 1, bronze: 2 },
    xp: 350,
    hint: "Your orb enters Portal A, teleports to Portal B, and detonates beside the highlighted cell.",
    objective: { kind: "capture", row: 4, col: 5 },
    cells: [
      { row: 0, col: 0, tile: "portal", portalGroup: 1 },                              // portal A, empty
      { row: 5, col: 5, tile: "portal", portalGroup: 1, owner: 0, orbs: 1 },          // portal B, player corner cap=2
      { row: 0, col: 1, owner: 0, orbs: 2 },                                           // player edge, cap=3
      { row: 1, col: 0, owner: 0, orbs: 2 },                                           // player edge, cap=3
      { row: 4, col: 5, owner: 1, orbs: 2, highlighted: true },                       // target, edge cap=3
      { row: 5, col: 4, owner: 1, orbs: 1 },                                           // opponent edge
      { row: 3, col: 5, owner: 1, orbs: 1 },                                           // opponent — context
    ],
  },

  // 9 — PINCER (2 moves, eliminate-all, classic)
  // Board: 6×6. Two opponents each tucked into a corner with 2 cells.
  // Opponent 1: (0,5)=1 [corner], (1,5)=1 [edge]. Player: (0,4)=2 [edge].
  // Opponent 2: (5,0)=1 [corner], (5,1)=1 [edge]. Player: (4,0)=2 [edge].
  // Move 1: fire (0,4) → captures (0,5) corner → corner cascades into (1,5) → opp1 eliminated.
  // Move 2: fire (4,0) → captures (5,0) corner → corner cascades into (5,1) → opp2 eliminated.
  {
    id: "m-pincer",
    name: "PINCER",
    brief: "Two opponents, two corners. Each corner falls to a single well-placed orb.",
    difficulty: "medium",
    modeKind: "classic",
    rows: 6,
    cols: 6,
    playerColors: [0, 1, 2],
    maxMoves: 3,
    medals: { gold: 2, silver: 2, bronze: 3 },
    xp: 380,
    hint: "Your loaded cells each sit beside an opponent's corner — one burst captures the corner and the cascade clears the rest.",
    objective: { kind: "eliminate-all" },
    cells: [
      { row: 0, col: 5, owner: 1, orbs: 1 },  // opponent 1 corner, cap=2
      { row: 1, col: 5, owner: 1, orbs: 1 },  // opponent 1 edge
      { row: 5, col: 0, owner: 2, orbs: 1 },  // opponent 2 corner, cap=2
      { row: 5, col: 1, owner: 2, orbs: 1 },  // opponent 2 edge
      { row: 0, col: 4, owner: 0, orbs: 2 },  // player edge, cap=3, fires into opp1 corner
      { row: 4, col: 0, owner: 0, orbs: 2 },  // player edge, cap=3, fires into opp2 corner
    ],
  },

  // 10 — DECOY (single move, chain ≥10, classic)
  // Board: 6×6. Two clusters: small (4 cells, top-left) and large (15 cells, bottom-right).
  // Small cluster fires only 4 explosions. Large cluster fires 15 ≥ 10.
  // The gap at row 2 prevents spillover between clusters.
  // Solution: fire any cell in the large cluster (rows 3–5, cols 1–5).
  {
    id: "m-decoy",
    name: "DECOY",
    brief: "Two clusters are loaded, but only the larger one can chain 10 or more. Count before you commit.",
    difficulty: "medium",
    modeKind: "classic",
    rows: 6,
    cols: 6,
    playerColors: [0, 1],
    maxMoves: 2,
    medals: { gold: 1, silver: 1, bronze: 2 },
    xp: 350,
    hint: "The small cluster in the top-left is a dead end. The answer is in the bottom half.",
    objective: { kind: "chain", minExplosions: 10 },
    cells: [
      // Small decoy cluster (top-left, 4 cells) — fires only 4 explosions
      ...loadedBlock(6, 6, 0, 0, 1, 1),
      // Large cluster (bottom right, rows 3–5, cols 1–5 = 15 cells) — fires 15 explosions
      ...loadedBlock(6, 6, 3, 1, 5, 5),
      { row: 0, col: 5, owner: 1, orbs: 1 },  // opponent — context only
    ],
  },

  // 11 — THREE STRIKES (3 moves, eliminate, classic)
  // Board: 6×6. Opponent has 3 separate clusters. Player has 1 targeted cell near each.
  // Cluster A (top-right): (0,4)=2 edge, (0,5)=1 corner. Player: (0,3)=2.
  // Cluster B (bottom-left): (5,0)=1 corner, (5,1)=2 edge. Player: (5,2)=2.
  // Cluster C (center): (2,4)=3 interior. Player: (2,3)=3.
  // Each move clears exactly one cluster. No 2-move solution (clusters are too far apart).
  {
    id: "m-three-strikes",
    name: "THREE STRIKES",
    brief: "RED's cells are split across three positions. Each one needs a targeted shot.",
    difficulty: "medium",
    modeKind: "classic",
    rows: 6,
    cols: 6,
    playerColors: [0, 1],
    maxMoves: 4,
    medals: { gold: 3, silver: 3, bronze: 4 },
    xp: 420,
    hint: "You have a primed cell near each RED cluster — scan the board for all three before you fire.",
    objective: { kind: "eliminate", playerIdx: 1 },
    cells: [
      // Cluster A — top-right
      { row: 0, col: 4, owner: 1, orbs: 2 },  // opponent edge, cap=3
      { row: 0, col: 5, owner: 1, orbs: 1 },  // opponent corner, cap=2
      // Cluster B — bottom-left
      { row: 5, col: 0, owner: 1, orbs: 1 },  // opponent corner, cap=2
      { row: 5, col: 1, owner: 1, orbs: 2 },  // opponent edge, cap=3
      // Cluster C — center
      { row: 2, col: 4, owner: 1, orbs: 3 },  // opponent interior, cap=4
      // Player targeting cells
      { row: 0, col: 3, owner: 0, orbs: 2 },  // fires into cluster A
      { row: 5, col: 2, owner: 0, orbs: 2 },  // fires into cluster B
      { row: 2, col: 3, owner: 0, orbs: 3 },  // fires into cluster C
    ],
  },

  // 12 — AMPLIFIER BLAST (single move, chain ≥8, arena)
  // Board: 6×6. Amplifier at (3,3) with 4 primed arm cells + 3 extension cells.
  // Amplifier fires 2 orbs/direction → all 4 arms (at 3) hit 5 → each arm fires normally.
  // Arm (2,3) cascades into (1,3), (2,2), (2,4) for 3 more explosions. Total = 8.
  // Solution: place at (3,3) — or at any arm cell to cascade into amplifier.
  {
    id: "m-amplifier-blast",
    name: "AMPLIFIER BLAST",
    brief: "The Amplifier fires twice as hard — one detonation powers a cascade of eight.",
    difficulty: "medium",
    modeKind: "arena",
    rows: 6,
    cols: 6,
    playerColors: [0, 1],
    maxMoves: 2,
    medals: { gold: 1, silver: 1, bronze: 2 },
    xp: 400,
    hint: "Amplifiers send two orbs in every direction — enough to push every neighbor past critical mass at once.",
    objective: { kind: "chain", minExplosions: 8 },
    cells: [
      { row: 3, col: 3, tile: "amplifier", owner: 0, orbs: 3 },  // amplifier, interior cap=4
      { row: 2, col: 3, owner: 0, orbs: 3 },  // north arm, interior cap=4
      { row: 4, col: 3, owner: 0, orbs: 3 },  // south arm, interior cap=4
      { row: 3, col: 2, owner: 0, orbs: 3 },  // west arm, interior cap=4
      { row: 3, col: 4, owner: 0, orbs: 3 },  // east arm, interior cap=4
      { row: 1, col: 3, owner: 0, orbs: 3 },  // north extension, interior cap=4
      { row: 2, col: 2, owner: 0, orbs: 3 },  // extension, interior cap=4
      { row: 2, col: 4, owner: 0, orbs: 3 },  // extension, interior cap=4
      { row: 0, col: 0, owner: 1, orbs: 1 },  // opponent — context only
    ],
  },

  /* ----------------------------- HARD ------------------------------ */

  // 13 — CROSSROADS (2 moves, eliminate-all, classic 6×6)
  // Three opponents: opp1 top-right corner chain, opp2 bottom-left corner chain, opp3 right-edge.
  // Move A: fire (0,3) → cascades through opp1's (0,4)→(0,5)→(1,5)[opp3] — two opponents cleared!
  // Move B: fire (5,2) → cascades through opp2's (5,1)→(5,0) — third opponent cleared.
  // Key insight: a single shot in the top-right clears opponents 1 AND 3 simultaneously.
  {
    id: "h-crossroads",
    name: "CROSSROADS",
    brief: "Three opponents stand at the crossroads. One well-aimed shot can topple two of them at once.",
    difficulty: "hard",
    modeKind: "classic",
    rows: 6,
    cols: 6,
    playerColors: [0, 1, 2, 3],
    maxMoves: 3,
    medals: { gold: 2, silver: 2, bronze: 3 },
    xp: 600,
    hint: "The top-right cascade wraps around the corner — follow where each explosion sends its orbs.",
    objective: { kind: "eliminate-all" },
    cells: [
      // Opponent 1 — top-right corner chain
      { row: 0, col: 4, owner: 1, orbs: 2 },  // edge, cap=3
      { row: 0, col: 5, owner: 1, orbs: 1 },  // corner, cap=2
      // Opponent 2 — bottom-left corner chain
      { row: 5, col: 0, owner: 2, orbs: 1 },  // corner, cap=2
      { row: 5, col: 1, owner: 2, orbs: 2 },  // edge, cap=3
      // Opponent 3 — right-side edge (connected to opp1's corner explosion)
      { row: 1, col: 5, owner: 3, orbs: 2 },  // edge, cap=3
      // Player
      { row: 0, col: 3, owner: 0, orbs: 2 },  // fires into opp1+opp3 cascade
      { row: 5, col: 2, owner: 0, orbs: 2 },  // fires into opp2 cascade
    ],
  },

  // 14 — SPIRAL (single move, chain ≥12, classic 7×7)
  // L-shaped chain: top row (left→right, 7 cells) then right column (top→bottom, 5 cells).
  // (0,6) corner bridges the two arms. (5,6) is the final explosion [12th].
  // Solution: place at (0,0).
  {
    id: "h-spiral",
    name: "SPIRAL",
    brief: "A loaded L-shape snakes along the top and right edges. One tap at the corner fires all twelve.",
    difficulty: "hard",
    modeKind: "classic",
    rows: 7,
    cols: 7,
    playerColors: [0, 1],
    maxMoves: 2,
    medals: { gold: 1, silver: 1, bronze: 2 },
    xp: 550,
    hint: "Corner cells burst after just two orbs — yours only needs one more to start the chain.",
    objective: { kind: "chain", minExplosions: 12 },
    cells: [
      // Top row: (0,0) to (0,6)
      { row: 0, col: 0, owner: 0, orbs: 1 },  // corner, cap=2
      { row: 0, col: 1, owner: 0, orbs: 2 },  // edge, cap=3
      { row: 0, col: 2, owner: 0, orbs: 2 },  // edge, cap=3
      { row: 0, col: 3, owner: 0, orbs: 2 },  // edge, cap=3
      { row: 0, col: 4, owner: 0, orbs: 2 },  // edge, cap=3
      { row: 0, col: 5, owner: 0, orbs: 2 },  // edge, cap=3
      { row: 0, col: 6, owner: 0, orbs: 1 },  // corner, cap=2 — bridges to right column
      // Right column: (1,6) to (5,6)
      { row: 1, col: 6, owner: 0, orbs: 2 },  // edge, cap=3
      { row: 2, col: 6, owner: 0, orbs: 2 },  // edge, cap=3
      { row: 3, col: 6, owner: 0, orbs: 2 },  // edge, cap=3
      { row: 4, col: 6, owner: 0, orbs: 2 },  // edge, cap=3
      { row: 5, col: 6, owner: 0, orbs: 2 },  // edge, cap=3 — final explosion
      // Opponent context
      { row: 6, col: 0, owner: 1, orbs: 1 },
    ],
  },

  // 15 — THREE WAY (3 moves, eliminate opp1, classic 7×7)
  // Opponent 1 holds three isolated clusters: top-right, bottom-left, and center.
  // Player has exactly one primed cell to dismantle each cluster.
  // Move A: (0,5) fires → corner chain clears cluster A. Move B: (6,2) fires → clears cluster B.
  // Move C: (3,2) interior fires → pushes into center opponent (3,3)=3 → cascade clears cluster C.
  {
    id: "h-three-way",
    name: "THREE WAY",
    brief: "RED controls three corners of the board. You have exactly one primed shot for each cluster.",
    difficulty: "hard",
    modeKind: "classic",
    rows: 7,
    cols: 7,
    playerColors: [0, 1],
    maxMoves: 4,
    medals: { gold: 3, silver: 3, bronze: 4 },
    xp: 650,
    hint: "One cluster hides in the center — you need to push through an intermediate interior cell to reach it.",
    objective: { kind: "eliminate", playerIdx: 1 },
    cells: [
      // Cluster A — top-right
      { row: 0, col: 6, owner: 1, orbs: 1 },  // corner, cap=2
      { row: 1, col: 6, owner: 1, orbs: 2 },  // edge, cap=3
      // Cluster B — bottom-left
      { row: 6, col: 0, owner: 1, orbs: 1 },  // corner, cap=2
      { row: 6, col: 1, owner: 1, orbs: 2 },  // edge, cap=3
      // Cluster C — center interior
      { row: 3, col: 3, owner: 1, orbs: 3 },  // interior, cap=4
      // Player targeting cells
      { row: 0, col: 5, owner: 0, orbs: 2 },  // fires into cluster A corner (top edge)
      { row: 6, col: 2, owner: 0, orbs: 2 },  // fires into cluster B (bottom edge)
      { row: 3, col: 2, owner: 0, orbs: 3 },  // interior fires into cluster C (interior cap=4)
    ],
  },

  // 16 — DOUBLE PORTAL (single move, chain ≥10, arena 6×6)
  // Top chain (0,0)→(0,3) cascades into portal A at (0,4). Orb teleports to portal B at (5,0).
  // Portal B fires, igniting bottom chain (5,1)→(5,5). Total: 4 + 1 portal + 5 = 10 explosions.
  // Solution: place at (0,0).
  {
    id: "h-double-portal",
    name: "DOUBLE PORTAL",
    brief: "The top chain leads to Portal A. The explosion emerges from Portal B and ignites a second chain below.",
    difficulty: "hard",
    modeKind: "arena",
    rows: 6,
    cols: 6,
    playerColors: [0, 1],
    maxMoves: 2,
    medals: { gold: 1, silver: 1, bronze: 2 },
    xp: 600,
    hint: "The top row fires left-to-right and feeds the portal — trace where the orb lands on the other side.",
    objective: { kind: "chain", minExplosions: 10 },
    cells: [
      // Top chain
      { row: 0, col: 0, owner: 0, orbs: 1 },  // corner, cap=2
      { row: 0, col: 1, owner: 0, orbs: 2 },  // edge, cap=3
      { row: 0, col: 2, owner: 0, orbs: 2 },  // edge, cap=3
      { row: 0, col: 3, owner: 0, orbs: 2 },  // edge, cap=3 — fires into portal A
      // Portal A (empty, receives orb from top chain)
      { row: 0, col: 4, tile: "portal", portalGroup: 1 },
      // Portal B (player, at cap-1 — fires on receiving the teleported orb)
      { row: 5, col: 0, tile: "portal", portalGroup: 1, owner: 0, orbs: 1 },
      // Bottom chain
      { row: 5, col: 1, owner: 0, orbs: 2 },  // edge, cap=3
      { row: 5, col: 2, owner: 0, orbs: 2 },  // edge, cap=3
      { row: 5, col: 3, owner: 0, orbs: 2 },  // edge, cap=3
      { row: 5, col: 4, owner: 0, orbs: 2 },  // edge, cap=3
      { row: 5, col: 5, owner: 0, orbs: 1 },  // corner, cap=2
      // Opponent context
      { row: 3, col: 3, owner: 1, orbs: 1 },
    ],
  },

  // 17 — BREAKTHROUGH (2 moves, capture (3,5), classic 6×6)
  // Target (3,5) is shielded by a primed opponent interior cell at (3,4).
  // Player's (3,3) needs one more orb before it can fire.
  // Move 1: place at (3,3) → 3 orbs (not yet at cap=4). Move 2: place at (3,3) → 4=cap →
  //   (3,4)[opp 3+1=4=cap → explodes as player] → (3,5)[opp 1+1=2, captured]. Done.
  // No 1-move solution exists: (3,3)=2 is below cap and no other player cell borders (3,4).
  {
    id: "h-breakthrough",
    name: "BREAKTHROUGH",
    brief: "The target is one cell too far to reach directly. Punch through the loaded cell in between.",
    difficulty: "hard",
    modeKind: "classic",
    rows: 6,
    cols: 6,
    playerColors: [0, 1],
    maxMoves: 3,
    medals: { gold: 2, silver: 2, bronze: 3 },
    xp: 580,
    hint: "First bring your interior cell to critical mass — then fire it through the enemy's loaded cell.",
    objective: { kind: "capture", row: 3, col: 5 },
    cells: [
      { row: 3, col: 3, owner: 0, orbs: 2 },                     // player interior, cap=4 — needs priming
      { row: 3, col: 4, owner: 1, orbs: 3 },                     // opponent interior, cap=4 — primed
      { row: 3, col: 5, owner: 1, orbs: 1, highlighted: true },  // target, edge cap=3
      { row: 0, col: 0, owner: 1, orbs: 1 },                     // opponent context
    ],
  },

  // 18 — GRAND SWEEP (single move, chain ≥15, classic 7×7)
  // Three-sided perimeter chain: left column (7) → bottom row (6) → right column partial (3) = 16 total.
  // Left→bottom bridged by (6,0) corner; bottom→right bridged by (6,6) corner.
  // Solution: place at (0,0). No re-explosions — backward orbs stay well below caps.
  {
    id: "h-grand-sweep",
    name: "GRAND SWEEP",
    brief: "A loaded path wraps three sides of the board. One corner tap unleashes all sixteen.",
    difficulty: "hard",
    modeKind: "classic",
    rows: 7,
    cols: 7,
    playerColors: [0, 1],
    maxMoves: 2,
    medals: { gold: 1, silver: 1, bronze: 2 },
    xp: 700,
    hint: "The chain travels down, turns right along the bottom, then climbs — trace the full path before firing.",
    objective: { kind: "chain", minExplosions: 15 },
    cells: [
      // Left column (top → bottom)
      { row: 0, col: 0, owner: 0, orbs: 1 },  // corner, cap=2
      { row: 1, col: 0, owner: 0, orbs: 2 },  // edge, cap=3
      { row: 2, col: 0, owner: 0, orbs: 2 },  // edge, cap=3
      { row: 3, col: 0, owner: 0, orbs: 2 },  // edge, cap=3
      { row: 4, col: 0, owner: 0, orbs: 2 },  // edge, cap=3
      { row: 5, col: 0, owner: 0, orbs: 2 },  // edge, cap=3
      { row: 6, col: 0, owner: 0, orbs: 1 },  // corner, cap=2 — turns chain rightward
      // Bottom row (left → right)
      { row: 6, col: 1, owner: 0, orbs: 2 },  // edge, cap=3
      { row: 6, col: 2, owner: 0, orbs: 2 },  // edge, cap=3
      { row: 6, col: 3, owner: 0, orbs: 2 },  // edge, cap=3
      { row: 6, col: 4, owner: 0, orbs: 2 },  // edge, cap=3
      { row: 6, col: 5, owner: 0, orbs: 2 },  // edge, cap=3
      { row: 6, col: 6, owner: 0, orbs: 1 },  // corner, cap=2 — turns chain upward
      // Right column (bottom → top, partial)
      { row: 5, col: 6, owner: 0, orbs: 2 },  // edge, cap=3
      { row: 4, col: 6, owner: 0, orbs: 2 },  // edge, cap=3
      { row: 3, col: 6, owner: 0, orbs: 2 },  // edge, cap=3 — final explosion [16]
      // Opponent context
      { row: 0, col: 6, owner: 1, orbs: 1 },
    ],
  },

  /* ---------------------------- EXPERT ---------------------------- */

  // 19 — PERIMETER (single move, chain ≥18, classic 7×7)
  // Three-sided perimeter: top row (7) → right column (6) → bottom row (6) = 19 explosions.
  // Corner (0,6) bridges top→right; corner (6,6) bridges right→bottom. No cycling.
  // Solution: place at (0,0).
  {
    id: "x-perimeter",
    name: "PERIMETER",
    brief: "Three sides of the board are loaded and primed. Find the one corner that ignites the full perimeter.",
    difficulty: "expert",
    modeKind: "classic",
    rows: 7,
    cols: 7,
    playerColors: [0, 1],
    maxMoves: 2,
    medals: { gold: 1, silver: 1, bronze: 2 },
    xp: 1000,
    hint: "Trace the path: top row fires right, down the right column, then sweeps left along the bottom.",
    objective: { kind: "chain", minExplosions: 18 },
    cells: [
      // Top row (left → right)
      { row: 0, col: 0, owner: 0, orbs: 1 },  // corner, cap=2
      { row: 0, col: 1, owner: 0, orbs: 2 },  // edge, cap=3
      { row: 0, col: 2, owner: 0, orbs: 2 },  // edge, cap=3
      { row: 0, col: 3, owner: 0, orbs: 2 },  // edge, cap=3
      { row: 0, col: 4, owner: 0, orbs: 2 },  // edge, cap=3
      { row: 0, col: 5, owner: 0, orbs: 2 },  // edge, cap=3
      { row: 0, col: 6, owner: 0, orbs: 1 },  // corner, cap=2 — bridges top→right column
      // Right column (top → bottom)
      { row: 1, col: 6, owner: 0, orbs: 2 },  // edge, cap=3
      { row: 2, col: 6, owner: 0, orbs: 2 },  // edge, cap=3
      { row: 3, col: 6, owner: 0, orbs: 2 },  // edge, cap=3
      { row: 4, col: 6, owner: 0, orbs: 2 },  // edge, cap=3
      { row: 5, col: 6, owner: 0, orbs: 2 },  // edge, cap=3
      { row: 6, col: 6, owner: 0, orbs: 1 },  // corner, cap=2 — bridges right→bottom row
      // Bottom row (right → left)
      { row: 6, col: 5, owner: 0, orbs: 2 },  // edge, cap=3
      { row: 6, col: 4, owner: 0, orbs: 2 },  // edge, cap=3
      { row: 6, col: 3, owner: 0, orbs: 2 },  // edge, cap=3
      { row: 6, col: 2, owner: 0, orbs: 2 },  // edge, cap=3
      { row: 6, col: 1, owner: 0, orbs: 2 },  // edge, cap=3
      { row: 6, col: 0, owner: 0, orbs: 1 },  // corner, cap=2 — final explosion [19]
      // Opponent context
      { row: 3, col: 0, owner: 1, orbs: 1 },
    ],
  },

  // 20 — FOUR CORNERS (4 moves, eliminate-all, classic 7×7)
  // Four opponents each holding a 3-cell corner cluster (corner + 2 adjacent edges).
  // Player has one interior cell primed adjacent to each cluster.
  // Firing an interior cell (cap=4, orbs=3) hits both edge cells of the corner simultaneously.
  // Those edge explosions cascade into the corner, clearing the whole cluster in one shot.
  {
    id: "x-four-corners",
    name: "FOUR CORNERS",
    brief: "Four opponents own each corner. One interior shot per cluster — you have exactly four.",
    difficulty: "expert",
    modeKind: "classic",
    rows: 7,
    cols: 7,
    playerColors: [0, 1, 2, 3, 4],
    maxMoves: 5,
    medals: { gold: 4, silver: 4, bronze: 5 },
    xp: 1200,
    hint: "Each interior cell fires in all four directions — two of those directions hit both of a corner cluster's edge cells.",
    objective: { kind: "eliminate-all" },
    cells: [
      // Opponent 1 — top-left
      { row: 0, col: 0, owner: 1, orbs: 1 },  // corner, cap=2
      { row: 0, col: 1, owner: 1, orbs: 2 },  // edge, cap=3
      { row: 1, col: 0, owner: 1, orbs: 2 },  // edge, cap=3
      // Opponent 2 — top-right
      { row: 0, col: 6, owner: 2, orbs: 1 },  // corner, cap=2
      { row: 0, col: 5, owner: 2, orbs: 2 },  // edge, cap=3
      { row: 1, col: 6, owner: 2, orbs: 2 },  // edge, cap=3
      // Opponent 3 — bottom-left
      { row: 6, col: 0, owner: 3, orbs: 1 },  // corner, cap=2
      { row: 6, col: 1, owner: 3, orbs: 2 },  // edge, cap=3
      { row: 5, col: 0, owner: 3, orbs: 2 },  // edge, cap=3
      // Opponent 4 — bottom-right
      { row: 6, col: 6, owner: 4, orbs: 1 },  // corner, cap=2
      { row: 6, col: 5, owner: 4, orbs: 2 },  // edge, cap=3
      { row: 5, col: 6, owner: 4, orbs: 2 },  // edge, cap=3
      // Player — one interior cell per cluster, all at cap-1
      { row: 1, col: 1, owner: 0, orbs: 3 },  // targets opp1 (up→(0,1), left→(1,0))
      { row: 1, col: 5, owner: 0, orbs: 3 },  // targets opp2 (up→(0,5), right→(1,6))
      { row: 5, col: 1, owner: 0, orbs: 3 },  // targets opp3 (down→(6,1), left→(5,0))
      { row: 5, col: 5, owner: 0, orbs: 3 },  // targets opp4 (down→(6,5), right→(5,6))
    ],
  },

  // 21 — SPLIT STRIKE (2 moves, eliminate-all, arena 7×7)
  // Two opponents on opposite sides. Opp1 (bottom-right) is only reachable via portal.
  // Opp2 (top-right) is attacked directly. Either move can go first.
  // Move A: fire (0,2) → into portal A at (0,3) → emerges at portal B (6,3) [orbs=2, cap=3, fires] →
  //   cascades through opp1 (6,4)→(6,5)→(6,6). Move B: fire (0,4) → (0,5)→(0,6) cascade.
  {
    id: "x-split-strike",
    name: "SPLIT STRIKE",
    brief: "Two targets, two methods. One needs a direct hit — the other only the portal can reach.",
    difficulty: "expert",
    modeKind: "arena",
    rows: 7,
    cols: 7,
    playerColors: [0, 1, 2],
    maxMoves: 3,
    medals: { gold: 2, silver: 2, bronze: 3 },
    xp: 950,
    hint: "The bottom-right cluster is too far for a direct shot — portal B sits right beside it, charged and waiting.",
    objective: { kind: "eliminate-all" },
    cells: [
      // Portal A (empty, top side — receives orb from player attack)
      { row: 0, col: 3, tile: "portal", portalGroup: 1 },
      // Portal B (player-owned at cap-1, bottom side — fires into opp1 on receiving teleported orb)
      { row: 6, col: 3, tile: "portal", portalGroup: 1, owner: 0, orbs: 2 },
      // Player attack cells
      { row: 0, col: 2, owner: 0, orbs: 2 },  // fires right into portal A → clears opp1
      { row: 0, col: 4, owner: 0, orbs: 2 },  // fires right into opp2 corner chain
      // Opponent 1 — bottom-right (only reachable via portal)
      { row: 6, col: 4, owner: 1, orbs: 2 },  // edge, cap=3
      { row: 6, col: 5, owner: 1, orbs: 2 },  // edge, cap=3
      { row: 6, col: 6, owner: 1, orbs: 1 },  // corner, cap=2
      // Opponent 2 — top-right (direct attack)
      { row: 0, col: 5, owner: 2, orbs: 2 },  // edge, cap=3
      { row: 0, col: 6, owner: 2, orbs: 1 },  // corner, cap=2
    ],
  },

  // 22 — FULL CIRCUIT (single move, chain ≥22, classic 7×7)
  // Four-sided partial perimeter: top row (7) → right column (6) → bottom row (6) → left partial (4) = 23.
  // (0,6), (6,6), (6,0) corners bridge each side. Left column stops at (2,0) to prevent cycling.
  // Solution: place at (0,0).
  {
    id: "x-full-circuit",
    name: "FULL CIRCUIT",
    brief: "Four sides of the board, a chain of twenty-three. One corner tap completes the circuit.",
    difficulty: "expert",
    modeKind: "classic",
    rows: 7,
    cols: 7,
    playerColors: [0, 1],
    maxMoves: 2,
    medals: { gold: 1, silver: 1, bronze: 2 },
    xp: 1100,
    hint: "Trace the path: right across the top, down the right side, left across the bottom, then up.",
    objective: { kind: "chain", minExplosions: 22 },
    cells: [
      // Top row (left → right)
      { row: 0, col: 0, owner: 0, orbs: 1 },  // corner, cap=2
      { row: 0, col: 1, owner: 0, orbs: 2 },
      { row: 0, col: 2, owner: 0, orbs: 2 },
      { row: 0, col: 3, owner: 0, orbs: 2 },
      { row: 0, col: 4, owner: 0, orbs: 2 },
      { row: 0, col: 5, owner: 0, orbs: 2 },
      { row: 0, col: 6, owner: 0, orbs: 1 },  // corner, cap=2 — bridges top→right
      // Right column (top → bottom)
      { row: 1, col: 6, owner: 0, orbs: 2 },
      { row: 2, col: 6, owner: 0, orbs: 2 },
      { row: 3, col: 6, owner: 0, orbs: 2 },
      { row: 4, col: 6, owner: 0, orbs: 2 },
      { row: 5, col: 6, owner: 0, orbs: 2 },
      { row: 6, col: 6, owner: 0, orbs: 1 },  // corner, cap=2 — bridges right→bottom
      // Bottom row (right → left)
      { row: 6, col: 5, owner: 0, orbs: 2 },
      { row: 6, col: 4, owner: 0, orbs: 2 },
      { row: 6, col: 3, owner: 0, orbs: 2 },
      { row: 6, col: 2, owner: 0, orbs: 2 },
      { row: 6, col: 1, owner: 0, orbs: 2 },
      { row: 6, col: 0, owner: 0, orbs: 1 },  // corner, cap=2 — bridges bottom→left column
      // Left column partial (bottom → top, stops at row 2 to prevent re-explosion at (0,0))
      { row: 5, col: 0, owner: 0, orbs: 2 },
      { row: 4, col: 0, owner: 0, orbs: 2 },
      { row: 3, col: 0, owner: 0, orbs: 2 },
      { row: 2, col: 0, owner: 0, orbs: 2 },  // edge, cap=3 — final explosion [23]
      // Opponent context
      { row: 3, col: 3, owner: 1, orbs: 1 },
    ],
  },

  // 23 — TRIPLE AXIS (3 moves, eliminate-all, classic 7×7)
  // Three opponents each hold a line of three cells along a different edge.
  // Player has four cells — but one is a decoy that fires into empty space.
  // Identifying the decoy AND the correct shot for each opponent is the expert challenge.
  {
    id: "x-triple-axis",
    name: "TRIPLE AXIS",
    brief: "Three opponents, three edges, four shots available — but only three of them actually reach a target.",
    difficulty: "expert",
    modeKind: "classic",
    rows: 7,
    cols: 7,
    playerColors: [0, 1, 2, 3],
    maxMoves: 4,
    medals: { gold: 3, silver: 3, bronze: 4 },
    xp: 1150,
    hint: "One of your four cells fires into empty space — use the others to sweep each opponent line.",
    objective: { kind: "eliminate-all" },
    cells: [
      // Opponent 1 — top edge line
      { row: 0, col: 3, owner: 1, orbs: 2 },  // edge, cap=3
      { row: 0, col: 4, owner: 1, orbs: 2 },  // edge, cap=3
      { row: 0, col: 5, owner: 1, orbs: 2 },  // edge, cap=3
      // Opponent 2 — left edge line
      { row: 3, col: 0, owner: 2, orbs: 2 },  // edge, cap=3
      { row: 4, col: 0, owner: 2, orbs: 2 },  // edge, cap=3
      { row: 5, col: 0, owner: 2, orbs: 2 },  // edge, cap=3
      // Opponent 3 — bottom-right cluster
      { row: 6, col: 4, owner: 3, orbs: 2 },  // edge, cap=3
      { row: 6, col: 5, owner: 3, orbs: 2 },  // edge, cap=3
      { row: 6, col: 6, owner: 3, orbs: 1 },  // corner, cap=2
      // Player — three real shots + one decoy
      { row: 0, col: 2, owner: 0, orbs: 2 },  // fires right → sweeps opp1 line
      { row: 2, col: 0, owner: 0, orbs: 2 },  // fires down → sweeps opp2 line
      { row: 6, col: 3, owner: 0, orbs: 2 },  // fires right → cascades opp3 cluster
      { row: 4, col: 4, owner: 0, orbs: 3 },  // DECOY — fires into empty interior cells
    ],
  },

  // 24 — CASCADE SIEGE (3 moves, eliminate, classic 7×7)
  // Opponent holds a tight 2×2 interior cluster, each cell at orbs=2 (two below cap=4).
  // No single explosion can clear it — player must relay-capture through the cluster.
  // Move 1: fire (3,2) → (3,3) captured [3 orbs]. Move 2: fire (3,3) → captures (3,4) and (4,3).
  // Move 3: fire (3,4) [player, 3] → captures (4,4). Opponent eliminated.
  // No 2-move solution: (4,4) is always the last cell and requires 3 relays to reach.
  {
    id: "x-cascade-siege",
    name: "CASCADE SIEGE",
    brief: "The cluster is two steps from critical — you must relay each capture through the one before it.",
    difficulty: "expert",
    modeKind: "classic",
    rows: 7,
    cols: 7,
    playerColors: [0, 1, 2],
    maxMoves: 4,
    medals: { gold: 3, silver: 3, bronze: 4 },
    xp: 1300,
    hint: "Fire into the cluster, then place on what you just captured — each relay charges the next cell.",
    objective: { kind: "eliminate", playerIdx: 1 },
    cells: [
      // Opponent 1 — 2×2 interior cluster, each at orbs=2 (cap-2)
      { row: 3, col: 3, owner: 1, orbs: 2 },  // interior, cap=4
      { row: 3, col: 4, owner: 1, orbs: 2 },  // interior, cap=4
      { row: 4, col: 3, owner: 1, orbs: 2 },  // interior, cap=4
      { row: 4, col: 4, owner: 1, orbs: 2 },  // interior, cap=4
      // Player entry point — fires into the cluster
      { row: 3, col: 2, owner: 0, orbs: 3 },  // interior, cap=4 — fires into (3,3)
      // Opponent 2 — context only (different playerIdx, unrelated to objective)
      { row: 0, col: 0, owner: 2, orbs: 1 },
      { row: 6, col: 6, owner: 2, orbs: 1 },
    ],
  },
];

export function puzzleById(id: string): PuzzleDef | undefined {
  return PUZZLES.find((p) => p.id === id);
}

/** Puzzles in unlock order (easy → expert, list order within a tier). */
export const PUZZLE_ORDER: PuzzleDef[] = DIFFICULTY_ORDER.flatMap((d) =>
  PUZZLES.filter((p) => p.difficulty === d),
);

export function buildPuzzleBoard(def: PuzzleDef): BoardState {
  const b = makeBoard(def.rows, def.cols);
  for (const spec of def.cells) {
    const cell = b.cells[spec.row * def.cols + spec.col];
    if (spec.tile) cell.tile = spec.tile;
    if (spec.portalGroup !== undefined) cell.portalPairId = spec.portalGroup;
    if (spec.owner !== undefined) {
      cell.owner = spec.owner;
      cell.orbs = spec.orbs ?? 1;
    }
  }
  return b;
}

export function highlightedCells(def: PuzzleDef): Set<string> {
  return new Set(def.cells.filter((c) => c.highlighted).map((c) => `${c.row}:${c.col}`));
}

export function objectiveText(def: PuzzleDef): string {
  const o = def.objective;
  if (o.kind === "chain") return `Chain of ${o.minExplosions}+ explosions in one move`;
  if (o.kind === "capture") return `Capture the highlighted cell`;
  if (o.kind === "eliminate-all") return `Eliminate every opponent`;
  return `Eliminate opponent ${o.playerIdx + 1}`;
}

export function medalFor(def: PuzzleDef, moves: number): Medal | null {
  if (moves <= def.medals.gold) return "gold";
  if (moves <= def.medals.silver) return "silver";
  if (moves <= def.medals.bronze) return "bronze";
  return null;
}

export function medalRank(m: Medal | null): number {
  return m === "gold" ? 3 : m === "silver" ? 2 : m === "bronze" ? 1 : 0;
}

/* --------------------------- progress storage --------------------------- */

export interface PuzzleRecord {
  medal: Medal;
  bestMoves: number;
  /** XP already granted for this puzzle (so improving a medal pays the delta). */
  xpAwarded: number;
}

export type PuzzleProgress = Record<string, PuzzleRecord>;

const STORAGE_KEY = "cr_puzzles_v1";

export function loadPuzzleProgress(): PuzzleProgress {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as PuzzleProgress;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function savePuzzleProgress(p: PuzzleProgress) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

/** Applies a solve, returning updated progress and the XP to grant now. */
export function applySolve(
  progress: PuzzleProgress,
  def: PuzzleDef,
  moves: number,
  medal: Medal,
): { progress: PuzzleProgress; xpGained: number } {
  const prev = progress[def.id];
  const earned = Math.round(def.xp * MEDAL_XP_MULT[medal]);
  const already = prev?.xpAwarded ?? 0;
  const xpGained = Math.max(0, earned - already);
  const best = prev && medalRank(prev.medal) >= medalRank(medal) ? prev : null;
  const next: PuzzleProgress = {
    ...progress,
    [def.id]: {
      medal: best ? best.medal : medal,
      bestMoves: best ? Math.min(best.bestMoves, moves) : moves,
      xpAwarded: already + xpGained,
    },
  };
  return { progress: next, xpGained };
}

/** A puzzle is unlocked when the previous puzzle in order has been solved. */
export function isUnlocked(progress: PuzzleProgress, def: PuzzleDef): boolean {
  const i = PUZZLE_ORDER.findIndex((p) => p.id === def.id);
  if (i <= 0) return true;
  return !!progress[PUZZLE_ORDER[i - 1].id];
}
