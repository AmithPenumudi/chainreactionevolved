import {
  applyMove,
  canPlace,
  commitMove,
  effectiveCriticalMass,
  GameState,
  MoveResult,
  PlayerId,
  BoardState,
} from "./engine";
import { AbilityId, ABILITIES, castAbility, abilityById } from "./abilities";

export type AIDifficulty = "easy" | "normal" | "hard";

interface Move {
  r: number;
  c: number;
}

export interface AIAction {
  type: "move" | "ability";
  r: number;
  c: number;
  abilityId?: AbilityId;
  targets?: [number, number][];
}

function legalMoves(state: GameState): Move[] {
  const out: Move[] = [];
  for (let r = 0; r < state.board.rows; r++) {
    for (let c = 0; c < state.board.cols; c++) {
      if (canPlace(state, r, c)) out.push({ r, c });
    }
  }
  return out;
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function neighborsOf(b: BoardState, r: number, c: number): [number, number][] {
  const out: [number, number][] = [];
  if (r > 0) out.push([r - 1, c]);
  if (r < b.rows - 1) out.push([r + 1, c]);
  if (c > 0) out.push([r, c - 1]);
  if (c < b.cols - 1) out.push([r, c + 1]);
  return out;
}

/**
 * True if any adjacent cell is owned by an enemy and one orb away from exploding.
 * i.e. enemy will capture this cell on their next move.
 */
function isThreatenedBy(b: BoardState, r: number, c: number, me: PlayerId): boolean {
  for (const [nr, nc] of neighborsOf(b, r, c)) {
    const n = b.cells[nr * b.cols + nc];
    if (n.owner === null || n.owner === me) continue;
    const cm = effectiveCriticalMass(b, nr, nc);
    if (n.orbs >= cm - 1) return true;
  }
  return false;
}

/**
 * Score a completed MoveResult from the perspective of `me`.
 * Higher is better.
 */
function scoreResult(state: GameState, res: MoveResult, me: PlayerId): number {
  if (res.winner === me) return 1_000_000;
  if (res.winner !== null && res.winner !== me) return -1_000_000;

  const b = res.boardAfter;
  let myCells = 0;
  let myOrbs = 0;
  let oppCells = 0;
  let oppOrbs = 0;

  let myLoaded = 0; // cells at cm-1 (ready to fire) — offensive potential
  let myLoadedSafe = 0;
  let oppLoaded = 0;

  let myVulnerableOrbs = 0; // my orbs sitting next to an enemy about to fire
  let myContested = 0; // my cells adjacent to any enemy cell (mild concern)

  let positional = 0;

  for (let r = 0; r < b.rows; r++) {
    for (let c = 0; c < b.cols; c++) {
      const cell = b.cells[r * b.cols + c];
      if (cell.owner === null) continue;
      const cm = effectiveCriticalMass(b, r, c);
      const nearCrit = cell.orbs === cm - 1;

      if (cell.owner === me) {
        myCells++;
        myOrbs += cell.orbs;

        const threatened = isThreatenedBy(b, r, c, me);
        if (threatened) myVulnerableOrbs += cell.orbs;

        if (nearCrit) {
          myLoaded++;
          if (!threatened) myLoadedSafe++;
        }

        // Positional preference: corners and edges are stable
        if (cm === 2) positional += 4;
        else if (cm === 3) positional += 1.8;

        // Special Tile Awareness
        if (cell.tile === "power") {
          positional += 12; // Power tiles are extremely valuable
        } else if (cell.tile === "amplifier") {
          positional += 8; // Amplifiers double the explosion count
        } else if (cell.tile === "reactor") {
          positional += 6; // Reactors are high priority
        }

        // Any enemy neighbor at all?
        for (const [nr, nc] of neighborsOf(b, r, c)) {
          const nb = b.cells[nr * b.cols + nc];
          if (nb.owner !== null && nb.owner !== me) {
            myContested++;
            // Enemy amplifier threat
            if (nb.tile === "amplifier" && nb.orbs === effectiveCriticalMass(b, nr, nc) - 1) {
              positional -= 20; // High threat: enemy amplifier is loaded next to us
            }
            break;
          }
        }
      } else {
        oppCells++;
        oppOrbs += cell.orbs;
        if (nearCrit) oppLoaded++;
      }
    }
  }

  // Encourage capturing enemy players entirely
  const eliminatedBonus = res.eliminatedPlayers.filter((p) => p !== me).length * 60;

  // Reward substantial chains that captured territory
  const chainReward = res.capturedCells * 2.5 + Math.min(res.chainCount, 20) * 0.8;

  // Material — orbs matter more than raw cell count once game is going
  const material = (myOrbs - oppOrbs) * 3 + (myCells - oppCells) * 2;

  // Loaded cells: safe loaded cells are premium (they threaten next turn);
  // enemy loaded cells threaten us.
  const loadedTerm = myLoadedSafe * 5 + (myLoaded - myLoadedSafe) * 1 - oppLoaded * 4;

  // Vulnerability: heavy stacks that will be captured by opponent are bad.
  // But scale sub-linearly so AI is not paralyzed early game.
  const vulnPenalty = Math.sqrt(myVulnerableOrbs) * 5 + myVulnerableOrbs * 1.5;

  return (
    material +
    positional +
    chainReward +
    loadedTerm +
    eliminatedBonus -
    vulnPenalty -
    myContested * 0.15
  );
}

function softmaxPick<T extends { score: number }>(items: T[], temperature: number): T {
  if (items.length === 1) return items[0];
  const maxS = Math.max(...items.map((i) => i.score));
  const weights = items.map((i) => Math.exp((i.score - maxS) / Math.max(0.0001, temperature)));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

/**
 * 2-Ply Alpha-Beta Search for Hard AI.
 */
function alphaBetaSearch(
  state: GameState,
  depth: number,
  alpha: number,
  beta: number,
  maximizing: boolean,
  me: PlayerId,
): number {
  if (depth === 0 || state.winner !== null || state.draw) {
    return evaluateBoardFor(state, me);
  }

  const moves = legalMoves(state);
  if (moves.length === 0) {
    return evaluateBoardFor(state, me);
  }

  // Pre-score moves to prune unpromising branches and limit branch factor
  const scoredMoves = moves
    .map((m) => {
      const res = applyMove(state, m.r, m.c);
      const score = res ? scoreResult(state, res, me) : -Infinity;
      return { m, score, res };
    })
    .filter((x) => x.res !== null) as { m: Move; score: number; res: MoveResult }[];

  if (maximizing) {
    scoredMoves.sort((a, b) => b.score - a.score);
    const candidates = scoredMoves.slice(0, 6);
    let maxEval = -Infinity;
    for (const cand of candidates) {
      const nextState = commitMove(state, cand.res);
      const nextPlayerIsMe = nextState.players[nextState.currentPlayerIdx].id === me;
      const evaluation = alphaBetaSearch(nextState, depth - 1, alpha, beta, nextPlayerIsMe, me);
      maxEval = Math.max(maxEval, evaluation);
      alpha = Math.max(alpha, evaluation);
      if (beta <= alpha) break;
    }
    return maxEval;
  } else {
    scoredMoves.sort((a, b) => a.score - b.score);
    const candidates = scoredMoves.slice(0, 6);
    let minEval = Infinity;
    for (const cand of candidates) {
      const nextState = commitMove(state, cand.res);
      const nextPlayerIsMe = nextState.players[nextState.currentPlayerIdx].id === me;
      const evaluation = alphaBetaSearch(nextState, depth - 1, alpha, beta, nextPlayerIsMe, me);
      minEval = Math.min(minEval, evaluation);
      beta = Math.min(beta, evaluation);
      if (beta <= alpha) break;
    }
    return minEval;
  }
}

function chooseHard(state: GameState, me: PlayerId): Move {
  const moves = legalMoves(state);
  if (moves.length === 0) return pickRandom(moves);

  const scored: { move: Move; score: number }[] = [];
  let winningMove: Move | null = null;

  for (const m of moves) {
    const res = applyMove(state, m.r, m.c);
    if (!res) continue;
    if (res.winner === me) {
      winningMove = m;
      break;
    }
    const afterState = commitMove(state, res);
    // 2-ply search
    const score = alphaBetaSearch(afterState, 1, -Infinity, Infinity, false, me);
    scored.push({ move: m, score });
  }

  if (winningMove) return winningMove;
  if (scored.length === 0) return pickRandom(moves);

  scored.sort((a, b) => b.score - a.score);
  const keep = Math.max(3, Math.ceil(scored.length * 0.4));
  const pool = scored.slice(0, keep);
  const spread = Math.max(1, pool[0].score - pool[pool.length - 1].score);
  return softmaxPick(pool, spread * 0.35 + 4).move;
}

function worstReplyForMe(state: GameState, me: PlayerId, sampleCap: number): number {
  if (state.winner !== null) {
    if (state.winner === me) return 1_000_000;
    return -1_000_000;
  }
  const opp = state.players[state.currentPlayerIdx].id;
  if (opp === me) return evaluateBoardFor(state, me);
  const moves = legalMoves(state);
  if (moves.length === 0) return evaluateBoardFor(state, me);

  const sample =
    moves.length > sampleCap ? moves.sort(() => Math.random() - 0.5).slice(0, sampleCap) : moves;

  let worst = Infinity;
  for (const m of sample) {
    const res = applyMove(state, m.r, m.c);
    if (!res) continue;
    const s = scoreResult(state, res, me);
    if (s < worst) worst = s;
  }
  return worst === Infinity ? evaluateBoardFor(state, me) : worst;
}

function evaluateBoardFor(state: GameState, me: PlayerId): number {
  const fake: MoveResult = {
    boardBefore: state.board,
    boardAfter: state.board,
    steps: [],
    chainCount: 0,
    capturedCells: 0,
    eliminatedPlayers: [],
    winner: state.winner,
    player: me,
    row: 0,
    col: 0,
  };
  return scoreResult(state, fake, me);
}

function chooseNormal(state: GameState, me: PlayerId): Move {
  const moves = legalMoves(state);
  const scored: { move: Move; score: number }[] = [];
  for (const m of moves) {
    const res = applyMove(state, m.r, m.c);
    if (!res) continue;
    if (res.winner === me) return m;
    scored.push({ move: m, score: scoreResult(state, res, me) });
  }
  if (scored.length === 0) return pickRandom(moves);
  scored.sort((a, b) => b.score - a.score);
  const keep = Math.max(3, Math.ceil(scored.length * 0.5));
  const pool = scored.slice(0, keep);
  const spread = Math.max(1, pool[0].score - pool[pool.length - 1].score);
  return softmaxPick(pool, spread * 0.6 + 6).move;
}

function chooseEasy(state: GameState, me: PlayerId): Move {
  const moves = legalMoves(state);
  if (Math.random() < 0.55) return pickRandom(moves);
  // Prefer moves that either explode or aren't next to a soon-to-fire enemy.
  const scored = moves.map((m) => {
    const cm = effectiveCriticalMass(state.board, m.r, m.c);
    const cell = state.board.cells[m.r * state.board.cols + m.c];
    let s = 0;
    if (cell.orbs + 1 >= cm) s += 5; // will trigger a chain
    if (!isThreatenedBy(state.board, m.r, m.c, me)) s += 2;
    if (cm === 2) s += 2;
    else if (cm === 3) s += 1;
    s += Math.random();
    return { m, s };
  });
  scored.sort((a, b) => b.s - a.s);
  return scored[0].m;
}

export function chooseAIMove(state: GameState, difficulty: AIDifficulty): Move | null {
  const moves = legalMoves(state);
  if (moves.length === 0) return null;
  const me = state.players[state.currentPlayerIdx].id;
  if (difficulty === "easy") return chooseEasy(state, me);
  if (difficulty === "normal") return chooseNormal(state, me);
  return chooseHard(state, me);
}

/**
 * AI action selector that supports standard moves and ability usage.
 */
export function chooseAIAction(state: GameState, difficulty: AIDifficulty): AIAction | null {
  const moves = legalMoves(state);
  if (moves.length === 0) return null;

  const me = state.players[state.currentPlayerIdx].id;
  const currentEnergy = state.energy[me];

  // Evaluate the best standard move first
  let bestMove: Move | null = null;
  let bestMoveScore = -Infinity;

  if (difficulty === "easy") {
    bestMove = chooseEasy(state, me);
    return { type: "move", r: bestMove.r, c: bestMove.c };
  } else if (difficulty === "normal") {
    bestMove = chooseNormal(state, me);
  } else {
    bestMove = chooseHard(state, me);
  }

  if (bestMove) {
    const res = applyMove(state, bestMove.r, bestMove.c);
    if (res) {
      const energyDelta = res.energyDelta ?? 2;
      const energyAfter = Math.min(100, currentEnergy + energyDelta);
      bestMoveScore = scoreResult(state, res, me) + energyAfter * 0.3;
    }
  }

  let bestAction: AIAction = {
    type: "move",
    r: bestMove ? bestMove.r : 0,
    c: bestMove ? bestMove.c : 0,
  };
  let bestActionScore = bestMoveScore;

  // If abilities are enabled and we are Normal/Hard AI, evaluate possible abilities
  if (state.modeConfig.abilities) {
    for (const ab of ABILITIES) {
      if (currentEnergy < ab.cost) continue;

      // Double Drop is targetless
      if (ab.targets === 0) {
        const res = castAbility(state, ab.id, []);
        if (res) {
          const energyDelta = res.energyDelta ?? -ab.cost;
          const energyAfter = Math.min(100, Math.max(0, currentEnergy + energyDelta));
          const afterState = commitMove(state, res);
          // Evaluate opponent's reply to this ability
          const oppReplyScore = worstReplyForMe(afterState, me, 10);
          const score = oppReplyScore + energyAfter * 0.3 + 12; // Extra bonus for Double Drop turn tempo
          if (score > bestActionScore) {
            bestActionScore = score;
            bestAction = { type: "ability", r: 0, c: 0, abilityId: ab.id, targets: [] };
          }
        }
      }
      // Single target abilities
      else if (ab.targets === 1) {
        for (let r = 0; r < state.board.rows; r++) {
          for (let c = 0; c < state.board.cols; c++) {
            if (ab.validate(state, r, c, 0)) {
              const res = castAbility(state, ab.id, [[r, c]]);
              if (res) {
                const energyDelta = res.energyDelta ?? -ab.cost;
                const energyAfter = Math.min(100, Math.max(0, currentEnergy + energyDelta));
                const afterState = commitMove(state, res);
                const oppReplyScore = worstReplyForMe(afterState, me, 10);
                const score = oppReplyScore + energyAfter * 0.3;
                if (score > bestActionScore) {
                  bestActionScore = score;
                  bestAction = { type: "ability", r, c, abilityId: ab.id, targets: [[r, c]] };
                }
              }
            }
          }
        }
      }
      // Dual target abilities (Relocate)
      else if (ab.targets === 2) {
        const sources: [number, number][] = [];
        for (let r = 0; r < state.board.rows; r++) {
          for (let c = 0; c < state.board.cols; c++) {
            if (ab.validate(state, r, c, 0)) {
              sources.push([r, c]);
            }
          }
        }

        const sampleSources =
          sources.length > 10 ? sources.sort(() => Math.random() - 0.5).slice(0, 10) : sources;

        for (const [sr, sc] of sampleSources) {
          for (let dr = 0; dr < state.board.rows; dr++) {
            for (let dc = 0; dc < state.board.cols; dc++) {
              if (ab.validate(state, dr, dc, 1, [sr, sc])) {
                const res = castAbility(state, ab.id, [
                  [sr, sc],
                  [dr, dc],
                ]);
                if (res) {
                  const energyDelta = res.energyDelta ?? -ab.cost;
                  const energyAfter = Math.min(100, Math.max(0, currentEnergy + energyDelta));
                  const afterState = commitMove(state, res);
                  const oppReplyScore = worstReplyForMe(afterState, me, 10);
                  const score = oppReplyScore + energyAfter * 0.3;
                  if (score > bestActionScore) {
                    bestActionScore = score;
                    bestAction = {
                      type: "ability",
                      r: sr,
                      c: sc,
                      abilityId: ab.id,
                      targets: [
                        [sr, sc],
                        [dr, dc],
                      ],
                    };
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  return bestAction;
}
