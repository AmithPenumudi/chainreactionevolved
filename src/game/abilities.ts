import {
  cloneBoard,
  effectiveCriticalMass,
  GameState,
  idx,
  MoveResult,
  resolveExplosions,
} from "./engine";

export type AbilityId =
  | "overload"
  | "shield"
  | "fortify"
  | "double-drop"
  | "emp"
  | "relocate"
  | "overcharge";

export interface AbilityDef {
  id: AbilityId;
  name: string;
  cost: number;
  desc: string;
  /** How many cell targets the ability needs (0, 1, or 2). */
  targets: 0 | 1 | 2;
  /** Which cells are valid targets. */
  validate: (state: GameState, r: number, c: number, step: 0 | 1, first?: [number, number]) => boolean;
}

const isOwn = (state: GameState, r: number, c: number) => {
  const me = state.players[state.currentPlayerIdx].id;
  const cell = state.board.cells[idx(state.board, r, c)];
  return cell.owner === me && cell.tile !== "wall" && cell.tile !== "dead";
};

const isEnemy = (state: GameState, r: number, c: number) => {
  const me = state.players[state.currentPlayerIdx].id;
  const cell = state.board.cells[idx(state.board, r, c)];
  return cell.owner !== null && cell.owner !== me && cell.tile !== "wall" && cell.tile !== "dead";
};

export const ABILITIES: AbilityDef[] = [
  {
    id: "overload",
    name: "Overload",
    cost: 30,
    desc: "Add one orb to one of your cells. May trigger a chain.",
    targets: 1,
    validate: isOwn,
  },
  {
    id: "shield",
    name: "Shield",
    cost: 35,
    desc: "Protect one owned cell. Absorbs one hostile orb. Expires when your next turn begins.",
    targets: 1,
    validate: (s, r, c) => {
      if (!isOwn(s, r, c)) return false;
      const cell = s.board.cells[idx(s.board, r, c)];
      return !cell.shielded;
    },
  },
  {
    id: "fortify",
    name: "Fortify",
    cost: 40,
    desc: "Raise this cell's critical mass by +1 until it next explodes.",
    targets: 1,
    validate: (s, r, c) => {
      if (!isOwn(s, r, c)) return false;
      const cell = s.board.cells[idx(s.board, r, c)];
      return !cell.fortified;
    },
  },
  {
    id: "double-drop",
    name: "Double Drop",
    cost: 45,
    desc: "Make two normal placements this turn.",
    targets: 0,
    validate: () => true,
  },
  {
    id: "emp",
    name: "EMP",
    cost: 50,
    desc: "Lock one enemy cell — its owner cannot manually place there next turn.",
    targets: 1,
    validate: (s, r, c) => {
      if (!isEnemy(s, r, c)) return false;
      const cell = s.board.cells[idx(s.board, r, c)];
      return cell.empLockedFor === undefined;
    },
  },
  {
    id: "relocate",
    name: "Relocate",
    cost: 55,
    desc: "Move one orb between two of your cells.",
    targets: 2,
    validate: (s, r, c, step, first) => {
      if (!isOwn(s, r, c)) return false;
      if (step === 0) {
        const cell = s.board.cells[idx(s.board, r, c)];
        return cell.orbs > 0;
      }
      if (first && first[0] === r && first[1] === c) return false;
      return true;
    },
  },
  {
    id: "overcharge",
    name: "Overcharge",
    cost: 70,
    desc: "Bring one owned cell to critical mass and detonate it.",
    targets: 1,
    validate: isOwn,
  },
];

export function abilityById(id: AbilityId): AbilityDef {
  return ABILITIES.find((a) => a.id === id)!;
}

/** Build a MoveResult representing an ability-cast on the board. */
export function castAbility(
  state: GameState,
  id: AbilityId,
  targets: [number, number][],
): MoveResult | null {
  const def = abilityById(id);
  if (state.energy[state.players[state.currentPlayerIdx].id] < def.cost) return null;
  const player = state.players[state.currentPlayerIdx].id;
  const boardBefore = cloneBoard(state.board);
  const board = cloneBoard(state.board);

  let usedPowerBonus = false;
  let keepTurn = false;
  let capturedPowerTiles = 0;

  switch (id) {
    case "overload": {
      const [r, c] = targets[0];
      const cell = board.cells[idx(board, r, c)];
      cell.orbs += 1;
      cell.owner = player;
      break;
    }
    case "shield": {
      const [r, c] = targets[0];
      board.cells[idx(board, r, c)].shielded = true;
      break;
    }
    case "fortify": {
      const [r, c] = targets[0];
      board.cells[idx(board, r, c)].fortified = true;
      break;
    }
    case "double-drop": {
      keepTurn = true;
      break;
    }
    case "emp": {
      const [r, c] = targets[0];
      const cell = board.cells[idx(board, r, c)];
      if (cell.owner === null) break;
      cell.empLockedFor = cell.owner;
      // Expires after cell owner has had one turn: use turn+players.length as absolute lock horizon.
      cell.empLockedUntilTurn = state.turn + state.players.length;
      break;
    }
    case "relocate": {
      const [sr, sc] = targets[0];
      const [dr, dc] = targets[1];
      const src = board.cells[idx(board, sr, sc)];
      const dst = board.cells[idx(board, dr, dc)];
      if (src.orbs <= 0) return null;
      src.orbs -= 1;
      if (src.orbs === 0) src.owner = null;
      const wasPower = dst.tile === "power" && dst.owner !== player;
      dst.orbs += 1;
      dst.owner = player;
      if (wasPower) capturedPowerTiles = 1;
      break;
    }
    case "overcharge": {
      const [r, c] = targets[0];
      const cell = board.cells[idx(board, r, c)];
      const cm = effectiveCriticalMass(board, r, c);
      cell.orbs = cm;
      cell.owner = player;
      break;
    }
  }

  const { steps, chainCount, capturedCells, eliminatedThisMove, winner } =
    resolveExplosions(state, board, player);

  // Abilities also grant energy from resulting chains (but not the placement bonus).
  let energyDelta = -def.cost;
  energyDelta += chainCount * 5;
  energyDelta += capturedCells * 3;
  if (chainCount >= 10) energyDelta += 15;
  else if (chainCount >= 5) energyDelta += 10;
  energyDelta += eliminatedThisMove.length * 20;

  return {
    boardBefore,
    boardAfter: board,
    steps,
    chainCount,
    capturedCells,
    eliminatedPlayers: eliminatedThisMove,
    winner,
    player,
    row: targets[0]?.[0] ?? 0,
    col: targets[0]?.[1] ?? 0,
    energyDelta,
    keepTurn,
    usedPowerBonus,
    capturedPowerTiles,
  };
}
