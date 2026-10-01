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
  /**
   * True once the player who owes an extra placement has spent an ability during that window.
   * An owed drop keeps the turn, and without this a cast that keeps the turn could be repeated
   * forever — on an amplifier board each cast refunds its own cost from the chain it starts, so
   * the opponent never moved again. One cast is allowed; the second is rejected.
   */
  extraPlacementCastUsed: boolean;
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
  /** If true, the mover is owed one more placement after this move (Double Drop). */
  grantsExtraPlacement?: boolean;
  /** Whether this move consumed a power-tile bonus. */
  usedPowerBonus?: boolean;
  /** True for an ability cast; false/absent for a placement. Abilities do not spend a drop. */
  isAbility?: boolean;
  /**
   * True when `resolveExplosions` hit its iteration cap and discarded the overflow. The cascade
   * really happened, but its counts describe an oscillation rather than a chain a player built,
   * so they must not be recorded as a personal best.
   */
  truncated?: boolean;
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
export function propagatingNeighbors(b: BoardState, r: number, c: number): [number, number][] {
  return neighbors(b, r, c).filter(([nr, nc]) => {
    const n = b.cells[nr * b.cols + nc];
    return n.tile !== "wall";
  });
}

export function canPlace(state: GameState, r: number, c: number): boolean {
  // A draw is as final as a winner. Only `winner` was checked here, so a drawn game (every
  // remaining player wiped out by the same Sudden Death shrink) still accepted placements.
  if (state.winner !== null || state.draw) return false;
  const p = state.players[state.currentPlayerIdx].id;
  const cell = state.board.cells[idx(state.board, r, c)];
  if (cell.tile === "wall" || cell.tile === "dead") return false;
  if (
    cell.empLockedFor === p &&
    cell.empLockedUntilTurn !== undefined &&
    state.turn < cell.empLockedUntilTurn
  ) {
    return false;
  }
  return cell.owner === null || cell.owner === p;
}

/**
 * Whether the player on turn can place anywhere at all.
 *
 * Normally owning a cell guarantees a move, but an EMP lock on a player's only cell while every
 * other cell belongs to an opponent leaves them with nothing legal. They are not eliminated
 * (they still hold a cell), so without this the turn would sit on them forever.
 */
export function hasLegalMove(state: GameState): boolean {
  for (let r = 0; r < state.board.rows; r++) {
    for (let c = 0; c < state.board.cols; c++) if (canPlace(state, r, c)) return true;
  }
  return false;
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
    extraPlacementCastUsed: false,
  };
}

/** Drops shield / fortify / EMP state — used when a cell changes hands or is emptied. */
function clearCellModifiers(cell: Cell): void {
  cell.shielded = false;
  cell.fortified = false;
  cell.empLockedFor = undefined;
  cell.empLockedUntilTurn = undefined;
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
  if (prevOwner !== owner) {
    captureCount.n += 1;
    // Defensive modifiers belong to the previous owner and do not transfer with the cell.
    clearCellModifiers(target);
  }
  target.owner = owner;
}

/**
 * The board the instant the orb lands, before any explosion resolves.
 *
 * Derived rather than stored on `MoveResult`: `applyMove` runs thousands of times inside the AI
 * search, and an extra board clone there would be paid on every node for something only the
 * animation needs. `engine.test.ts` pins this against `applyMove`'s own result so the two
 * cannot drift.
 */
export function boardAfterPlacement(res: MoveResult): BoardState {
  const cells = res.boardBefore.cells.slice();
  const i = idx(res.boardBefore, res.row, res.col);
  // Placing also captures the cell, which is what makes a power tile change hands.
  cells[i] = { ...cells[i], orbs: cells[i].orbs + 1, owner: res.player };
  return { ...res.boardBefore, cells };
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
  const capturedPowerTiles = startCell.tile === "power" && wasNotOwned ? 1 : 0;

  const { steps, chainCount, capturedCells, eliminatedThisMove, winner, truncated } =
    resolveExplosions(state, board, player);

  // Energy grants (only meaningful in abilities mode; safe to compute always).
  let energyDelta = 2; // placement
  energyDelta += chainCount * 5;
  energyDelta += capturedCells * 3;
  if (chainCount >= 10) energyDelta += 15;
  else if (chainCount >= 5) energyDelta += 10;
  energyDelta += eliminatedThisMove.length * 20;

  // A queued extra placement (Double Drop or an Arena power-tile bonus) keeps the turn.
  const isExtra = state.extraPlacementFor === player;

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
    keepTurn: isExtra,
    usedPowerBonus: isExtra && state.modeConfig.specialTiles,
    truncated,
  };
}

/**
 * Everything about a board that decides how the next wave resolves: orbs, owner, and the two flags
 * that change critical mass or absorb a deposit. Tile kind and portal pairing are immutable, so
 * they cannot differ between two waves of the same cascade.
 */
function boardSignature(b: BoardState): string {
  let out = "";
  for (const c of b.cells) {
    out += `${c.orbs},${c.owner ?? "-"}${c.fortified ? "f" : ""}${c.shielded ? "s" : ""};`;
  }
  return out;
}

/**
 * An upper bound on the orbs a board could hold with every cell below its critical mass.
 *
 * Deliberately optimistic: a `reactor` counts its +1 whether or not it is owned yet, because it may
 * be captured later in the cascade and that would raise the real bound. `fortified` is counted as it
 * stands, because an explosion can only ever clear it, which lowers the bound. So this number never
 * grows as the cascade proceeds — which is what makes "over capacity" a permanent verdict rather
 * than a snapshot.
 */
function settleCapacity(b: BoardState): number {
  let cap = 0;
  for (let r = 0; r < b.rows; r++) {
    for (let c = 0; c < b.cols; c++) {
      const cell = b.cells[r * b.cols + c];
      if (cell.tile === "wall" || cell.tile === "dead") continue;
      let cm = propagatingNeighbors(b, r, c).length;
      if (cm < 2) cm = 2;
      if (cell.fortified) cm += 1;
      if (cell.tile === "reactor") cm += 1;
      cap += cm - 1;
    }
  }
  return cap;
}

/**
 * Whether anything on this board can swallow an orb: a `dead` tile, a live shield, or a cell sealed
 * in by walls with nowhere to send what it holds.
 *
 * Only ever called before the cascade starts, and that is sound in the direction it is used: tiles
 * and walls are immutable, and a shield can only break. A board with no sink now will not grow one,
 * so its orb count is non-decreasing and `settleCapacity` can be trusted as a permanent verdict.
 */
function hasOrbSink(b: BoardState): boolean {
  for (let r = 0; r < b.rows; r++) {
    for (let c = 0; c < b.cols; c++) {
      const cell = b.cells[r * b.cols + c];
      if (cell.tile === "dead" || cell.shielded) return true;
      if (cell.tile !== "wall" && propagatingNeighbors(b, r, c).length === 0) return true;
    }
  }
  return false;
}

function countOrbs(b: BoardState): number {
  let n = 0;
  for (const c of b.cells) n += c.orbs;
  return n;
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
  truncated: boolean;
} {
  const steps: ExplosionStep[] = [];
  let chainCount = 0;
  const capturedCounter = { n: 0 };

  // Players already out of the game must not be "eliminated" again by a later chain.
  const eliminatedSoFar = new Set<PlayerId>(
    state.players.filter((p) => state.eliminated[p.id]).map((p) => p.id),
  );
  const eliminatedThisMove: PlayerId[] = [];

  let safety = 0;
  let truncated = false;
  // Amplifiers inject orbs (2 per neighbor instead of 1) rather than conserving them,
  // so a densely-packed amplifier cascade can enter a sustained full-board oscillation
  // instead of naturally draining to a stable state. Cap generously above any real
  // cascade (a full single-file chain across the largest board is ~150 cells) but far
  // below what would make an animation hang for minutes.
  const maxIters = Math.max(200, board.rows * board.cols * 2);

  /**
   * The board holds more orbs than it can ever stabilise (an amplifier feedback loop, or a dense
   * board that just shrank). Rather than hand back a permanently unstable board, the overflow is
   * discarded so every cell ends below its critical mass.
   */
  const discardOverflow = () => {
    truncated = true;
    for (let rr = 0; rr < board.rows; rr++) {
      for (let cc = 0; cc < board.cols; cc++) {
        const cell = board.cells[idx(board, rr, cc)];
        if (cell.tile === "wall" || cell.tile === "dead" || cell.owner === null) continue;
        cell.orbs = Math.min(cell.orbs, effectiveCriticalMass(board, rr, cc) - 1);
        if (cell.orbs <= 0) {
          cell.orbs = 0;
          cell.owner = null;
          clearCellModifiers(cell);
        }
      }
    }
    steps.push({ explosions: [], boardAfter: cloneBoard(board), eliminatedAfter: [] });
  };

  // Two provable ways to know a cascade will never settle, so it can be cut short long before
  // `maxIters`. That matters for cost: every wave is a full board scan plus a board clone for the
  // animation, and the AI search pays it on every node that reaches such a position — a saturated
  // 6x6 amplifier board ran 202 waves and counted over 7000 explosions.
  //
  //  1. **Over capacity.** If the board holds more orbs than any settled arrangement could
  //     (`settleCapacity`), there is nowhere for them to come to rest. Sound only when nothing can
  //     swallow an orb, since a `dead` tile or a shield could drain it back under the bound later;
  //     amplifiers only ever add, so without a sink the count cannot fall.
  //  2. **A repeated board state.** A wave's outcome depends on nothing but the board, so a board
  //     that comes round a second time is a proven infinite loop — the identical sequence follows
  //     forever. Signatures are exact strings rather than a hash, because a collision would
  //     silently truncate a cascade that was going to settle.
  //
  // Neither is checked until `watchAfter` waves have passed. An ordinary cascade is a handful of
  // waves and never pays for any of this, and a long dramatic one — a saturated board that ends in
  // a win partway through — still plays out as it did.
  const sinkFree = !hasOrbSink(board);
  const watchAfter = Math.max(16, (board.rows + board.cols) * 2);
  const seen = new Set<string>();
  let waves = 0;

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
      const orbsPerNeighbor = isAmplifier ? 2 : 1;
      const outlets = propagatingNeighbors(board, u.row, u.col);
      const ejected = outlets.length * orbsPerNeighbor;
      // A cell may only lose the orbs it actually throws out. `cm` can exceed the number of
      // outlets — `fortified` and an owned `reactor` each add one, and the floor at 2 lifts a
      // cell with a single non-wall neighbour — and subtracting `cm` regardless quietly deleted
      // the difference. A fortified cell ate one orb every time it fired and a 1xN board lost
      // one per explosion. The surplus now stays behind instead.
      //
      // A cell with no outlet at all (sealed in by walls) is the one case that must still
      // subtract `cm`: it has nowhere to send orbs, so keeping them would leave it permanently
      // above its critical mass. It is a sink, like a dead tile.
      const drained = outlets.length === 0 ? cm : Math.min(cm, ejected);
      cell.orbs -= drained;
      // Fortify is consumed by explosion.
      if (cell.fortified) cell.fortified = false;
      if (cell.orbs <= 0) {
        cell.orbs = 0;
        // Preserve tile & portalPairId; drop ownership and any modifiers.
        cell.owner = null;
        clearCellModifiers(cell);
      }
      for (const [nr, nc] of outlets) {
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

    // Players who have not moved yet are still in the game, so they count as alive.
    const alive = state.players.filter((p) => !eliminatedSoFar.has(p.id));
    if (alive.length <= 1 && state.players.length >= 2) break;

    // A full cycle has been completed by the time a signature repeats, so every elimination the
    // oscillation can produce has already been recorded above.
    if (++waves >= watchAfter) {
      if (sinkFree && countOrbs(board) > settleCapacity(board)) {
        discardOverflow();
        break;
      }
      const sig = boardSignature(board);
      if (seen.has(sig)) {
        discardOverflow();
        break;
      }
      seen.add(sig);
    }

    if (++safety > maxIters) {
      discardOverflow();
      break;
    }
  }

  let winner: PlayerId | null = null;
  if (state.players.length >= 2) {
    const alive = state.players.filter((p) => !eliminatedSoFar.has(p.id));
    if (alive.length === 1) winner = alive[0].id;
  }

  return {
    steps,
    chainCount,
    capturedCells: capturedCounter.n,
    eliminatedThisMove,
    winner,
    truncated,
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
function clearExpiringModifiers(
  board: BoardState,
  forPlayer: PlayerId,
  currentTurn: number,
): BoardState {
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
  const keepTurn = !!res.keepTurn;
  // An ability is not a drop, so it leaves an owed placement standing — but it is allowed to do
  // that only once per window (see `extraPlacementCastUsed`).
  let extraPlacementCastUsed = state.extraPlacementCastUsed;
  if (res.isAbility) {
    if (extraPlacementFor === res.player) extraPlacementCastUsed = true;
  } else if (extraPlacementFor === res.player) {
    // Consumed an extra placement.
    extraPlacementFor = null;
    extraPlacementCastUsed = false;
  }
  // Double Drop: the caster still owes one more placement.
  if (res.grantsExtraPlacement && winner === null) extraPlacementFor = res.player;
  // Consume power bonus if used by this move.
  if (res.usedPowerBonus && powerBonus[res.player] > 0) {
    powerBonus[res.player] -= 1;
  }

  const turnAdvance = keepTurn && winner === null;

  // A cascade that hit the iteration cap is an oscillation, not a chain a player built: on a
  // dense amplifier board it counts thousands of explosions on a board of a few dozen cells.
  // Recording that as "biggest chain" makes the stat meaningless, so it is clamped to something
  // the board could actually produce.
  const reportedChain = res.truncated
    ? Math.min(res.chainCount, res.boardAfter.rows * res.boardAfter.cols)
    : res.chainCount;

  const nextState: GameState = {
    ...state,
    board: res.boardAfter,
    hasMoved,
    eliminated,
    turn: state.turn + 1,
    largestChain: Math.max(state.largestChain, reportedChain),
    totalExplosions: state.totalExplosions + res.chainCount,
    totalCapturedCells: state.totalCapturedCells + res.capturedCells,
    winner,
    endedAt: winner !== null ? Date.now() : null,
    energy,
    powerBonus,
    extraPlacementFor,
    extraPlacementCastUsed,
    turnStartAt: Date.now(),
  };

  if (winner === null && !turnAdvance) {
    const nextIdx = nextPlayerIdx(nextState);
    const nextPid = nextState.players[nextIdx].id;

    // Sweep expiring shields/EMPs for the incoming player.
    const board = clearExpiringModifiers(nextState.board, nextPid, nextState.turn);

    // Grant extra placement if this player has a stored power-tile bonus. An owed placement that
    // belongs to a player who has since been eliminated is dropped first: it can never be played,
    // and while it sat there no other player could ever be granted one.
    let extra = nextState.extraPlacementFor;
    if (extra !== null && eliminated[extra]) extra = null;
    if (state.modeConfig.specialTiles && powerBonus[nextPid] > 0 && extra === null) {
      extra = nextPid;
    }

    return {
      ...nextState,
      board,
      currentPlayerIdx: nextIdx,
      extraPlacementFor: extra,
      extraPlacementCastUsed:
        extra === nextState.extraPlacementFor && extra !== null
          ? nextState.extraPlacementCastUsed
          : false,
    };
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
  // The turn counter has to move even when nobody played. EMP locks expire against an absolute
  // turn number, so with `turn` frozen a lock set in a timed game never lifted once both players
  // started letting the clock run out — the cell stayed unplayable for the rest of the match.
  const next: GameState = {
    ...state,
    turn: state.turn + 1,
    turnStartAt: Date.now(),
    extraPlacementFor: null,
    extraPlacementCastUsed: false,
  };
  next.currentPlayerIdx = nextPlayerIdx(next);
  const pid = next.players[next.currentPlayerIdx].id;
  next.board = clearExpiringModifiers(next.board, pid, next.turn);
  if (state.modeConfig.specialTiles && next.powerBonus[pid] > 0) {
    next.extraPlacementFor = pid;
  }
  return next;
}

/**
 * A forfeited turn plus the Sudden Death shrink it may have just crossed.
 *
 * `forfeitTurn` advances `turn`, and the shrink is scheduled off that same counter, so a turn that
 * times out exactly on the boundary has to shrink too — otherwise advancing the counter steps
 * straight over a shrink that should have happened.
 */
export function forfeitTurnWithShrink(state: GameState): GameState {
  const next = forfeitTurn(state);
  if (next.turn === state.turn) return next; // nothing was forfeited (already decided)
  const every = next.rules.shrinkIntervalRounds;
  if (next.winner !== null || next.draw || !next.rules.enableShrink || every <= 0) return next;
  if (next.turn % every !== 0) return next;
  return applyShrink(next) ?? next;
}

/**
 * Hands the turn on until it reaches a player who can actually act, and reports a draw if it gets
 * all the way round without finding one.
 *
 * Owning a cell normally guarantees a move, but an EMP lock on a player's only cell while every
 * other cell belongs to an opponent leaves them with nothing legal — and they are not eliminated,
 * so no other rule would move the turn along and the match simply stopped there. `canAct` is
 * injected because what counts as "able to act" includes castable abilities, which live a layer up.
 *
 * Returns the state unchanged when the player on turn can already act, so a caller may run it on
 * every state without it looping: a dead position settles on `draw` and stays there.
 */
export function passTurnUntilPlayable(
  state: GameState,
  canAct: (s: GameState) => boolean,
): GameState {
  if (state.winner !== null || state.draw || canAct(state)) return state;
  let next = state;
  for (let i = 0; i < state.players.length; i++) {
    next = forfeitTurn(next);
    if (canAct(next)) return next;
  }
  return { ...next, draw: true, endedAt: Date.now() };
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
  const board: BoardState = { rows: newRows, cols: newCols, cells: newCells };

  const { capturedCells, chainCount, truncated } = resolveExplosions(
    state,
    board,
    state.players[state.currentPlayerIdx].id,
  );

  // Losing the outer ring can wipe a player out without any explosion, so eliminations are
  // decided from final ownership rather than from the chain resolver.
  const eliminated = state.eliminated.slice();
  for (const p of state.players) {
    if (eliminated[p.id] || !state.hasMoved[p.id]) continue;
    if (cellsOwnedBy(board, p.id) === 0) eliminated[p.id] = true;
  }

  let winner = state.winner;
  let draw = state.draw;
  const alive = state.players.filter((p) => !eliminated[p.id]);
  if (alive.length === 1) winner = alive[0].id;
  if (alive.length === 0) draw = true;

  // Never leave the turn on a player who was just eliminated.
  let currentPlayerIdx = state.currentPlayerIdx;
  if (winner === null && !draw && eliminated[state.players[currentPlayerIdx].id]) {
    currentPlayerIdx = nextPlayerIdx({ ...state, eliminated });
  }

  // The ring going away can set off a cascade of its own. Only the captures were folded in, so
  // those explosions were missing from the match totals entirely.
  const reportedChain = truncated ? Math.min(chainCount, board.rows * board.cols) : chainCount;

  // An owed extra placement cannot survive its owner: left pointing at an eliminated player it
  // would block every later power-tile bonus, because only one can be outstanding at a time.
  let extraPlacementFor = state.extraPlacementFor;
  if (extraPlacementFor !== null && eliminated[extraPlacementFor]) extraPlacementFor = null;

  return {
    ...state,
    board,
    currentPlayerIdx,
    eliminated,
    winner,
    draw,
    shrinkCount: state.shrinkCount + 1,
    totalCapturedCells: state.totalCapturedCells + capturedCells,
    largestChain: Math.max(state.largestChain, reportedChain),
    totalExplosions: state.totalExplosions + chainCount,
    extraPlacementFor,
    extraPlacementCastUsed: extraPlacementFor === null ? false : state.extraPlacementCastUsed,
    turnStartAt: Date.now(),
    endedAt: winner !== null || draw ? Date.now() : state.endedAt,
  };
}
