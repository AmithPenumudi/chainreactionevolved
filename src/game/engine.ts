export type PlayerId = number; // 0..N-1

/** Rule-variant for Classic mode (timer / shrink toggles). */
export type GameMode = "classic" | "blitz" | "sudden-death" | "custom";

/** Top-level game mode kind. */
export type ModeKind = "classic" | "abilities" | "arena";

export interface GameModeConfig {
  kind: ModeKind;
  abilities: boolean;
  energy: boolean;
  specialTiles: boolean;
}

export const MODE_CONFIGS: Record<ModeKind, GameModeConfig> = {
  classic: { kind: "classic", abilities: false, energy: false, specialTiles: false },
  abilities: { kind: "abilities", abilities: true, energy: true, specialTiles: false },
  arena: { kind: "arena", abilities: false, energy: false, specialTiles: true },
};

export interface GameRules {
  turnTimeMs: number; // 0 means no per-turn timer
  shrinkIntervalRounds: number; // 0 means no shrinking
  enableShrink: boolean;
}

export const DEFAULT_RULES: Record<GameMode, GameRules> = {
  classic: { turnTimeMs: 0, shrinkIntervalRounds: 0, enableShrink: false },
  blitz: { turnTimeMs: 10000, shrinkIntervalRounds: 0, enableShrink: false },
  "sudden-death": { turnTimeMs: 0, shrinkIntervalRounds: 8, enableShrink: true },
  custom: { turnTimeMs: 0, shrinkIntervalRounds: 0, enableShrink: false },
};

export interface PlayerConfig {
  id: PlayerId;
  name: string;
  colorIndex: number;
  isAI?: boolean;
  difficulty?: "easy" | "normal" | "hard";
}

export type TileKind = "normal" | "power" | "portal" | "wall" | "amplifier" | "dead" | "reactor";

export interface Cell {
  orbs: number;
  owner: PlayerId | null;
  /** Arena tile kind. Undefined/absent = normal. */
  tile?: TileKind;
  /** Portal pair id — both portals in a pair share the same id. */
  portalPairId?: number;
  /** Abilities: shield absorbs one hostile orb, cleared on owner's next turn start. */
  shielded?: boolean;
  /** Abilities: fortify raises this cell's critical mass by +1 until it explodes. */
  fortified?: boolean;
  /** Abilities: cell is EMP-locked for its owner until this many commits have elapsed. */
  empLockedFor?: PlayerId;
  empLockedUntilTurn?: number;
}

export interface BoardState {
  rows: number;
  cols: number;
  cells: Cell[];
}

export interface GameState {
  board: BoardState;
  players: PlayerConfig[];
  currentPlayerIdx: number;
  turn: number;
  hasMoved: boolean[];
  eliminated: boolean[];
  winner: PlayerId | null;
  draw: boolean;
  mode: GameMode;
  rules: GameRules;
  modeConfig: GameModeConfig;
  turnStartAt: number;
  shrinkCount: number;
  startedAt: number;
  endedAt: number | null;
  largestChain: number;
  totalExplosions: number;
  totalCapturedCells: number;
  /** Abilities: current energy per player, capped 0..100. */
  energy: number[];
  /** Arena: unspent power-tile placement bonuses per player (max 1). */
  powerBonus: number[];
  /** Set to a player id if that player's next placement is an extra placement (Double Drop or Power Tile bonus). */
  extraPlacementFor: PlayerId | null;
}

export interface ExplosionStep {
  explosions: { row: number; col: number; owner: PlayerId }[];
  boardAfter: BoardState;
  eliminatedAfter: PlayerId[];
  /** Optional flying-orb overrides for animation (portal hops). */
  hops?: { from: [number, number]; to: [number, number]; owner: PlayerId }[];
}

export interface MoveResult {
  boardBefore: BoardState;
  boardAfter: BoardState;
  steps: ExplosionStep[];
  chainCount: number;
  capturedCells: number;
  eliminatedPlayers: PlayerId[];
  winner: PlayerId | null;
  player: PlayerId;
  row: number;
  col: number;
  /** Energy delta to apply to `player` on commit. */
  energyDelta?: number;
  /** If true, do not rotate to next player after commit (Double Drop / power-tile bonus). */
  keepTurn?: boolean;
  /** Whether this move consumed a power-tile bonus. */
  usedPowerBonus?: boolean;
  /** Which power tiles the player captured during this move (grant bonus on commit). */
  capturedPowerTiles?: number;
}

export function criticalMass(rows: number, cols: number, r: number, c: number): number {
  const isCornerR = r === 0 || r === rows - 1;
  const isCornerC = c === 0 || c === cols - 1;
  if (isCornerR && isCornerC) return 2;
  if (isCornerR || isCornerC) return 3;
  return 4;
}

/** Cell-aware critical mass: base = count of non-wall orthogonal neighbors, plus modifiers. */
export function effectiveCriticalMass(b: BoardState, r: number, c: number): number {
  const cell = b.cells[r * b.cols + c];
  let cm = 0;
  if (r > 0 && b.cells[(r - 1) * b.cols + c].tile !== "wall") cm++;
  if (r < b.rows - 1 && b.cells[(r + 1) * b.cols + c].tile !== "wall") cm++;
  if (c > 0 && b.cells[r * b.cols + c - 1].tile !== "wall") cm++;
  if (c < b.cols - 1 && b.cells[r * b.cols + c + 1].tile !== "wall") cm++;
  if (cm < 2) cm = 2;
  if (cell.fortified) cm += 1;
  if (cell.tile === "reactor" && cell.owner !== null) cm += 1;
  return cm;
}

export function makeBoard(rows: number, cols: number): BoardState {
  return {
    rows,
    cols,
    cells: Array.from({ length: rows * cols }, () => ({ orbs: 0, owner: null })),
  };
}

export function cloneBoard(b: BoardState): BoardState {
  return { rows: b.rows, cols: b.cols, cells: b.cells.map((c) => ({ ...c })) };
}

export function idx(b: BoardState, r: number, c: number) {
  return r * b.cols + c;
}

export function neighbors(b: BoardState, r: number, c: number): [number, number][] {
  const out: [number, number][] = [];
  if (r > 0) out.push([r - 1, c]);
  if (r < b.rows - 1) out.push([r + 1, c]);
  if (c > 0) out.push([r, c - 1]);
  if (c < b.cols - 1) out.push([r, c + 1]);
  return out;
}

/** Neighbors filtered for arena: walls are impassable to explosions. */
function propagatingNeighbors(b: BoardState, r: number, c: number): [number, number][] {
  return neighbors(b, r, c).filter(([nr, nc]) => {
    const n = b.cells[nr * b.cols + nc];
    return n.tile !== "wall";
  });
}

export function canPlace(state: GameState, r: number, c: number): boolean {
  if (state.winner !== null) return false;
  const p = state.players[state.currentPlayerIdx].id;
  const cell = state.board.cells[idx(state.board, r, c)];
  if (cell.tile === "wall" || cell.tile === "dead") return false;
  if (cell.empLockedFor === p && cell.empLockedUntilTurn !== undefined && state.turn < cell.empLockedUntilTurn) {
    return false;
  }
  return cell.owner === null || cell.owner === p;
}

export function makeInitialState(
  players: PlayerConfig[],
  rows: number,
  cols: number,
  mode: GameMode = "classic",
  rules: GameRules = DEFAULT_RULES[mode],
  modeConfig: GameModeConfig = MODE_CONFIGS.classic,
  board?: BoardState,
): GameState {
  const now = Date.now();
  return {
    board: board ?? makeBoard(rows, cols),
    players,
    currentPlayerIdx: 0,
    turn: 0,
    hasMoved: players.map(() => false),
    eliminated: players.map(() => false),
    winner: null,
    draw: false,
    mode,
    rules,
    modeConfig,
    turnStartAt: now,
    shrinkCount: 0,
    startedAt: now,
    endedAt: null,
    largestChain: 0,
    totalExplosions: 0,
    totalCapturedCells: 0,
    energy: players.map(() => 0),
    powerBonus: players.map(() => 0),
    extraPlacementFor: null,
  };
}

/** Deposit one orb into (r,c), honoring shield/portal/dead-zone rules. */
function depositOrb(
  board: BoardState,
  r: number,
  c: number,
  owner: PlayerId,
  hopped: boolean,
  captureCount: { n: number },
  hops: { from: [number, number]; to: [number, number]; owner: PlayerId }[],
  fromR: number,
  fromC: number,
): void {
  const nk = idx(board, r, c);
  const target = board.cells[nk];
  if (target.tile === "wall") return; // safety
  if (target.tile === "dead") return; // absorbed
  if (target.tile === "portal" && !hopped && target.portalPairId !== undefined) {
    // Route to the paired portal cell (once per orb).
    for (let rr = 0; rr < board.rows; rr++) {
      for (let cc = 0; cc < board.cols; cc++) {
        if (rr === r && cc === c) continue;
        const cand = board.cells[rr * board.cols + cc];
        if (cand.tile === "portal" && cand.portalPairId === target.portalPairId) {
          hops.push({ from: [fromR, fromC], to: [rr, cc], owner });
          depositOrb(board, rr, cc, owner, true, captureCount, hops, r, c);
          return;
        }
      }
    }
    // No pair found — fall through to normal deposit.
  }
  if (target.shielded && target.owner !== null && target.owner !== owner) {
    // Shield absorbs one incoming hostile orb, then breaks.
    target.shielded = false;
    return;
  }
  const prevOwner = target.owner;
  target.orbs += 1;
  if (prevOwner !== owner) captureCount.n += 1;
  target.owner = owner;
}

/**
 * Applies a move to a cloned board and returns detailed steps for animation.
 * Does NOT mutate input state.
 */
export function applyMove(state: GameState, r: number, c: number): MoveResult | null {
  if (!canPlace(state, r, c)) return null;
  const player = state.players[state.currentPlayerIdx].id;
  const boardBefore = cloneBoard(state.board);
  const board = cloneBoard(state.board);

  // Place orb (also captures the cell — including power tiles).
  const startCell = board.cells[idx(board, r, c)];
  const wasNotOwned = startCell.owner !== player;
  startCell.orbs += 1;
  startCell.owner = player;
  const capturedPowerTiles =
    startCell.tile === "power" && wasNotOwned ? 1 : 0;

  const { steps, chainCount, capturedCells, eliminatedThisMove, winner } = resolveExplosions(
    state,
    board,
    player,
  );

  // Energy grants (only meaningful in abilities mode; safe to compute always).
  let energyDelta = 2; // placement
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
    row: r,
    col: c,
    energyDelta,
    capturedPowerTiles,
  };
}

/** Shared explosion resolver used by moves and abilities that touch the board. */
export function resolveExplosions(
  state: GameState,
  board: BoardState,
  player: PlayerId,
): {
  steps: ExplosionStep[];
  chainCount: number;
  capturedCells: number;
  eliminatedThisMove: PlayerId[];
  winner: PlayerId | null;
} {
  const steps: ExplosionStep[] = [];
  let chainCount = 0;
  const capturedCounter = { n: 0 };

  const eliminatedSoFar = new Set<PlayerId>();
  const eliminatedThisMove: PlayerId[] = [];

  let safety = 0;
  // Amplifiers inject orbs (2 per neighbor instead of 1) rather than conserving them,
  // so a densely-packed amplifier cascade can enter a sustained full-board oscillation
  // instead of naturally draining to a stable state. Cap generously above any real
  // cascade (a full single-file chain across the largest board is ~150 cells) but far
  // below what would make an animation hang for minutes.
  const maxIters = Math.max(200, board.rows * board.cols * 2);

  while (true) {
    const unstable: { row: number; col: number; owner: PlayerId }[] = [];
    for (let rr = 0; rr < board.rows; rr++) {
      for (let cc = 0; cc < board.cols; cc++) {
        const k = idx(board, rr, cc);
        const cell = board.cells[k];
        if (cell.tile === "wall" || cell.tile === "dead") continue;
        const cm = effectiveCriticalMass(board, rr, cc);
        if (cell.orbs >= cm && cell.owner !== null) {
          unstable.push({ row: rr, col: cc, owner: cell.owner as PlayerId });
        }
      }
    }
    if (unstable.length === 0) break;

    const hops: { from: [number, number]; to: [number, number]; owner: PlayerId }[] = [];

    for (const u of unstable) {
      const k = idx(board, u.row, u.col);
      const cell = board.cells[k];
      const cm = effectiveCriticalMass(board, u.row, u.col);
      const isAmplifier = cell.tile === "amplifier";
      cell.orbs -= cm;
      // Fortify is consumed by explosion.
      if (cell.fortified) cell.fortified = false;
      if (cell.orbs <= 0) {
        cell.orbs = 0;
        // Preserve tile & portalPairId; drop ownership.
        cell.owner = null;
      }
      const orbsPerNeighbor = isAmplifier ? 2 : 1;
      for (const [nr, nc] of propagatingNeighbors(board, u.row, u.col)) {
        for (let i = 0; i < orbsPerNeighbor; i++) {
          depositOrb(board, nr, nc, u.owner, false, capturedCounter, hops, u.row, u.col);
        }
      }
      chainCount += 1;
    }

    const eliminatedAfter: PlayerId[] = [];
    for (const p of state.players) {
      if (eliminatedSoFar.has(p.id)) continue;
      const hadMoved = state.hasMoved[p.id] || p.id === player;
      if (!hadMoved) continue;
      let owns = 0;
      for (const cc of board.cells) if (cc.owner === p.id) owns++;
      if (owns === 0) {
        eliminatedSoFar.add(p.id);
        eliminatedAfter.push(p.id);
        eliminatedThisMove.push(p.id);
      }
    }

    steps.push({
      explosions: unstable,
      boardAfter: cloneBoard(board),
      eliminatedAfter,
      hops: hops.length ? hops : undefined,
    });

    const activated = state.players.filter((p) => state.hasMoved[p.id] || p.id === player);
    const alive = activated.filter((p) => !eliminatedSoFar.has(p.id));
    if (alive.length <= 1 && activated.length >= 2) break;

    if (++safety > maxIters) break;
  }

  let winner: PlayerId | null = null;
  const activated = state.players.filter((p) => state.hasMoved[p.id] || p.id === player);
  if (activated.length >= 2) {
    const alive = activated.filter((p) => !eliminatedSoFar.has(p.id));
    if (alive.length === 1) winner = alive[0].id;
  }

  return {
    steps,
    chainCount,
    capturedCells: capturedCounter.n,
    eliminatedThisMove,
    winner,
  };
}

/** Returns the next currentPlayerIdx skipping eliminated players. */
export function nextPlayerIdx(state: GameState): number {
  const n = state.players.length;
  let i = state.currentPlayerIdx;
  for (let k = 0; k < n; k++) {
    i = (i + 1) % n;
    if (!state.eliminated[state.players[i].id]) return i;
  }
  return state.currentPlayerIdx;
}

/** Clears expired shields/EMPs for a player whose turn just began. */
function clearExpiringModifiers(board: BoardState, forPlayer: PlayerId, currentTurn: number): BoardState {
  const b = cloneBoard(board);
  for (const cell of b.cells) {
    if (cell.shielded && cell.owner === forPlayer) {
      cell.shielded = false;
    }
    if (
      cell.empLockedFor === forPlayer &&
      cell.empLockedUntilTurn !== undefined &&
      currentTurn >= cell.empLockedUntilTurn
    ) {
      cell.empLockedFor = undefined;
      cell.empLockedUntilTurn = undefined;
    }
  }
  return b;
}

export function commitMove(state: GameState, res: MoveResult): GameState {
  const hasMoved = state.hasMoved.slice();
  hasMoved[res.player] = true;
  const eliminated = state.eliminated.slice();
  for (const pid of res.eliminatedPlayers) eliminated[pid] = true;
  const winner = res.winner;

  // Energy: add delta up to 100.
  const energy = state.energy.slice();
  if (state.modeConfig.energy && res.energyDelta) {
    energy[res.player] = Math.min(100, Math.max(0, energy[res.player] + res.energyDelta));
  }

  // Power tile bonus: capturing a power tile grants +1 (cap 1).
  const powerBonus = state.powerBonus.slice();
  if (state.modeConfig.specialTiles && res.capturedPowerTiles) {
    powerBonus[res.player] = Math.min(1, powerBonus[res.player] + res.capturedPowerTiles);
  }

  // Determine whether the player keeps the turn (extra placement).
  let extraPlacementFor = state.extraPlacementFor;
  let keepTurn = !!res.keepTurn;
  if (extraPlacementFor === res.player) {
    // Consumed an extra placement.
    extraPlacementFor = null;
  }
  // Consume power bonus if used by this move.
  if (res.usedPowerBonus && powerBonus[res.player] > 0) {
    powerBonus[res.player] -= 1;
  }

  const turnAdvance = keepTurn && winner === null;

  const nextState: GameState = {
    ...state,
    board: res.boardAfter,
    hasMoved,
    eliminated,
    turn: state.turn + 1,
    largestChain: Math.max(state.largestChain, res.chainCount),
    totalExplosions: state.totalExplosions + res.chainCount,
    totalCapturedCells: state.totalCapturedCells + res.capturedCells,
    winner,
    endedAt: winner !== null ? Date.now() : null,
    energy,
    powerBonus,
    extraPlacementFor,
    turnStartAt: Date.now(),
  };

  if (winner === null && !turnAdvance) {
    const nextIdx = nextPlayerIdx(nextState);
    const nextPid = nextState.players[nextIdx].id;

    // Sweep expiring shields/EMPs for the incoming player.
    let board = clearExpiringModifiers(nextState.board, nextPid, nextState.turn);

    // Grant extra placement if this player has a stored power-tile bonus.
    let extra = nextState.extraPlacementFor;
    if (state.modeConfig.specialTiles && powerBonus[nextPid] > 0 && extra === null) {
      extra = nextPid;
    }

    return { ...nextState, board, currentPlayerIdx: nextIdx, extraPlacementFor: extra };
  }
  return nextState;
}

export function cellsOwnedBy(board: BoardState, pid: PlayerId): number {
  let n = 0;
  for (const c of board.cells) if (c.owner === pid) n++;
  return n;
}

export function orbsOwnedBy(board: BoardState, pid: PlayerId): number {
  let n = 0;
  for (const c of board.cells) if (c.owner === pid) n += c.orbs;
  return n;
}

/** Advance the current player without making a move (used for turn timers). */
export function forfeitTurn(state: GameState): GameState {
  if (state.winner !== null || state.draw) return state;
  const next: GameState = { ...state, turnStartAt: Date.now(), extraPlacementFor: null };
  next.currentPlayerIdx = nextPlayerIdx(next);
  const pid = next.players[next.currentPlayerIdx].id;
  next.board = clearExpiringModifiers(next.board, pid, next.turn);
  if (state.modeConfig.specialTiles && next.powerBonus[pid] > 0) {
    next.extraPlacementFor = pid;
  }
  return next;
}

/**
 * Shrink the board by removing the outer ring of cells (Sudden Death).
 */
export function applyShrink(state: GameState): GameState | null {
  if (!state.rules.enableShrink || state.rules.shrinkIntervalRounds <= 0) return null;
  const b = state.board;
  if (b.rows <= 4 || b.cols <= 4) return null;

  const newRows = b.rows - 2;
  const newCols = b.cols - 2;
  const newCells: Cell[] = [];
  for (let r = 1; r < b.rows - 1; r++) {
    for (let c = 1; c < b.cols - 1; c++) {
      newCells.push({ ...b.cells[r * b.cols + c] });
    }
  }
  let board: BoardState = { rows: newRows, cols: newCols, cells: newCells };

  const { eliminatedThisMove: elimNew, capturedCells } = resolveExplosions(state, board, state.players[state.currentPlayerIdx].id);
  const eliminated = state.eliminated.slice();
  for (const pid of elimNew) eliminated[pid] = true;

  let winner = state.winner;
  let draw = state.draw;
  const activated = state.players.filter((p) => state.hasMoved[p.id]);
  if (activated.length >= 2) {
    const alive = activated.filter((p) => !eliminated[p.id]);
    if (alive.length === 1) winner = alive[0].id;
    if (alive.length === 0 && state.players.every((p) => state.hasMoved[p.id])) {
      draw = true;
    }
  }

  return {
    ...state,
    board,
    eliminated,
    winner,
    draw,
    shrinkCount: state.shrinkCount + 1,
    totalCapturedCells: state.totalCapturedCells + capturedCells,
    turnStartAt: Date.now(),
    endedAt: winner !== null || draw ? Date.now() : state.endedAt,
  };
}
