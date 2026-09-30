import { useEffect, useMemo, useRef, useState } from "react";
import {
  applyMove,
  boardAfterPlacement,
  applyShrink,
  canPlace,
  cellsOwnedBy,
  commitMove,
  effectiveCriticalMass,
  GameState,
  makeInitialState,
  MODE_CONFIGS,
  MoveResult,
  neighbors,
  orbsOwnedBy,
  forfeitTurn,
} from "@/game/engine";
import { AbilityId, abilityById, castAbility } from "@/game/abilities";
import { getArenaMap } from "@/game/arena-maps";
import { buildChaosBoard } from "@/game/chaos-grid";
import { chooseAIActionAsync } from "@/game/ai-client";
import { MatchConfig } from "./SetupScreen";
import { CellView } from "./CellView";
import { AbilityBar } from "./AbilityBar";
import { colorFor, PLAYER_SYMBOLS, lighten, darken } from "@/game/colors";
import { VictoryScreen } from "./VictoryScreen";
import { speedFactor, useSettings } from "@/game/settings";
import { playSfx } from "@/game/sound";
import { haptic } from "@/game/haptics";
import { MAX_UNDOS, UndoHistory, undoAllowed } from "@/game/undo";
import { syncAfterMatch } from "@/game/sync/sync";
import {
  BOARD_PADDING,
  CELL_GAP,
  computeCellSize,
  ZOOM_BELOW,
  ZOOMED_CELL,
} from "@/game/board-size";
import { statsModeFor, useProfile } from "@/game/profile";
import { useChallenges } from "@/game/challenges";

interface Props {
  config: MatchConfig;
  onExit: () => void;
  onRematch: () => void;
}

interface FlyingOrb {
  key: string;
  x: number;
  y: number;
  tx: number;
  ty: number;
  color: string;
  size: number;
  duration: number;
}

interface AnimationState {
  displayBoard: GameState["board"];
  explodingKeys: Set<string>;
  flying: FlyingOrb[];
  running: boolean;
  showChainBanner: { count: number; key: number } | null;
  showShrinkBanner: { key: number } | null;
}

export function GameScreen({ config, onExit, onRematch }: Props) {
  const modeConfig = MODE_CONFIGS[config.modeKind];
  const { settings } = useSettings();
  const { recordMatch } = useProfile();
  const { recordOutcome } = useChallenges();
  const sf = speedFactor(settings);

  /** The local human player whose progression is tracked ("you"). */
  const youId = useMemo(() => config.players.find((p) => !p.isAI)?.id ?? null, [config.players]);
  const tally = useRef({
    eliminations: 0,
    cellsCaptured: 0,
    explosions: 0,
    largestChain: 0,
    abilitiesUsed: 0,
    energyEarned: 0,
    energySpent: 0,
    orbsPlaced: 0,
    abilityCounts: {} as Record<string, number>,
    portalTransfers: 0,
    amplifierExplosions: 0,
    powerTilesCaptured: 0,
  });
  const recorded = useRef(false);

  // Undo (one human vs bots): a snapshot of the board *and* the stats tally is taken before each
  // of the human's moves, so an undone move never counts towards profile or challenge stats.
  const undoEnabled = useMemo(() => undoAllowed(config.players), [config.players]);
  const undoHistory = useRef(new UndoHistory<{ state: GameState; tally: typeof tally.current }>());
  const [undoInfo, setUndoInfo] = useState({ available: false, left: MAX_UNDOS });
  const syncUndo = () =>
    setUndoInfo({ available: undoHistory.current.canUndo, left: undoHistory.current.remaining });

  const [state, setState] = useState<GameState>(() => {
    const board =
      config.modeKind === "arena" && config.arenaMapId
        ? config.arenaMapId === "chaos" && config.chaosConfig
          ? buildChaosBoard(config.rows, config.cols, config.chaosConfig, config.chaosSeed ?? 1)
          : getArenaMap(config.arenaMapId).build()
        : undefined;
    return makeInitialState(
      config.players,
      config.rows,
      config.cols,
      config.mode,
      config.rules,
      modeConfig,
      board,
    );
  });

  const [anim, setAnim] = useState<AnimationState>(() => ({
    displayBoard: state.board,
    explodingKeys: new Set(),
    flying: [],
    running: false,
    showChainBanner: null,
    showShrinkBanner: null,
  }));

  // Ability targeting state (Abilities mode)
  const [selectedAbility, setSelectedAbility] = useState<AbilityId | null>(null);
  const [abilityFirstTarget, setAbilityFirstTarget] = useState<[number, number] | null>(null);
  const [showTileInfo, setShowTileInfo] = useState(false);
  // Turn confirmation (Settings → Gameplay): first tap selects, second confirms.
  const [pendingCell, setPendingCell] = useState<[number, number] | null>(null);

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (state.winner !== null || state.draw) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [state.winner, state.draw]);

  useEffect(() => {
    if (state.rules.turnTimeMs <= 0) return;
    if (state.winner !== null || state.draw || anim.running) return;
    const id = setInterval(() => {
      const left = state.rules.turnTimeMs - (Date.now() - state.turnStartAt);
      if (left <= 0) setState((s) => forfeitTurn(s));
    }, 100);
    return () => clearInterval(id);
  }, [state.rules.turnTimeMs, state.turnStartAt, state.winner, state.draw, anim.running]);

  useEffect(() => {
    if (!anim.running) setAnim((a) => ({ ...a, displayBoard: state.board }));
  }, [state.board, anim.running]);

  // Reset ability targeting when turn changes
  useEffect(() => {
    setSelectedAbility(null);
    setAbilityFirstTarget(null);
    setPendingCell(null);
  }, [state.currentPlayerIdx]);

  const fitCellSize = useCellSize(state.board.rows, state.board.cols);
  // Big boards fit a phone only with tiny cells, so offer a zoomed view that scrolls instead.
  const canZoom = fitCellSize < ZOOM_BELOW;
  const [zoomed, setZoomed] = useState(false);
  const cellSize = zoomed && canZoom ? ZOOMED_CELL : fitCellSize;

  const currentPlayer = state.players[state.currentPlayerIdx];
  const currentColor = colorFor(currentPlayer.colorIndex);

  const clickable = !anim.running && state.winner === null && !state.draw && !currentPlayer.isAI;

  const turnTimeLeft = useMemo(() => {
    if (state.rules.turnTimeMs <= 0) return Infinity;
    return Math.max(0, state.rules.turnTimeMs - (now - state.turnStartAt));
  }, [state.rules.turnTimeMs, state.turnStartAt, now]);

  const modeLabel = useMemo(() => {
    if (config.modeKind === "abilities") return "Abilities";
    if (config.modeKind === "arena") return `Arena · ${getArenaMap(config.arenaMapId!).label}`;
    const labels: Record<string, string> = {
      classic: "Classic",
      blitz: "Blitz",
      "sudden-death": "Sudden Death",
      custom: "Custom",
    };
    return labels[state.mode] ?? "Classic";
  }, [config.modeKind, config.arenaMapId, state.mode]);

  const shrinkTurnsLeft = useMemo(() => {
    if (!state.rules.enableShrink || state.rules.shrinkIntervalRounds <= 0) return null;
    return state.rules.shrinkIntervalRounds - (state.turn % state.rules.shrinkIntervalRounds);
  }, [state.rules.enableShrink, state.rules.shrinkIntervalRounds, state.turn]);

  const bannerRef = useRef(0);
  const shrinkBannerRef = useRef(0);

  const cellCenter = useMemo(() => {
    return (r: number, c: number) => ({
      x: BOARD_PADDING + c * (cellSize + CELL_GAP) + cellSize / 2,
      y: BOARD_PADDING + r * (cellSize + CELL_GAP) + cellSize / 2,
    });
  }, [cellSize]);

  /** Accumulate lifetime-profile counters for the local player's own moves. */
  const trackResult = (res: MoveResult, abilityId?: AbilityId) => {
    if (youId === null || res.player !== youId) return;
    const t = tally.current;
    t.eliminations += res.eliminatedPlayers.length;
    t.cellsCaptured += res.capturedCells;
    t.explosions += res.chainCount;
    t.largestChain = Math.max(t.largestChain, res.chainCount);
    const energyDelta = res.energyDelta ?? 0;
    if (energyDelta > 0) t.energyEarned += energyDelta;
    if (abilityId) {
      const def = abilityById(abilityId);
      t.abilitiesUsed += 1;
      t.energySpent += def.cost;
      t.energyEarned += Math.max(0, energyDelta + def.cost);
      t.abilityCounts[abilityId] = (t.abilityCounts[abilityId] ?? 0) + 1;
    } else {
      t.orbsPlaced += 1;
    }
    if (modeConfig.specialTiles) {
      t.powerTilesCaptured += res.capturedPowerTiles ?? 0;
      for (const step of res.steps) {
        t.portalTransfers += step.hops?.length ?? 0;
        for (const ex of step.explosions) {
          const cell = res.boardBefore.cells[ex.row * res.boardBefore.cols + ex.col];
          if (cell.tile === "amplifier") t.amplifierExplosions += 1;
        }
      }
    }
  };

  // One vibration when the match ends (a longer buzz for a win).
  useEffect(() => {
    if (state.winner === null) return;
    haptic(settings, youId !== null && state.winner !== youId ? "lose" : "win");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.winner]);

  // Record the finished match into the player profile exactly once.
  useEffect(() => {
    if (recorded.current) return;
    if (state.winner === null && !state.draw) return;
    if (youId === null) return;
    recorded.current = true;
    const t = tally.current;
    const outcome = {
      mode: statsModeFor(config.modeKind),
      won: state.winner === youId,
      players: state.players.length,
      turns: state.turn,
      detail:
        config.modeKind === "arena" && config.arenaMapId
          ? getArenaMap(config.arenaMapId).label
          : t.largestChain > 0
            ? `Largest Chain: ${t.largestChain}`
            : undefined,
      eliminations: t.eliminations,
      cellsCaptured: t.cellsCaptured,
      explosions: t.explosions,
      largestChain: t.largestChain,
      abilitiesUsed: t.abilitiesUsed,
      energyEarned: t.energyEarned,
      energySpent: t.energySpent,
      abilityCounts: t.abilityCounts,
      orbsPlaced: t.orbsPlaced,
      portalTransfers: t.portalTransfers,
      amplifierExplosions: t.amplifierExplosions,
      powerTilesCaptured: t.powerTilesCaptured,
    };
    recordMatch(outcome);
    recordOutcome(outcome);
    // First thing worth keeping, so this is where the anonymous account gets created — not at
    // launch, where someone who opens the app once would cost a monthly active user. Deliberately
    // not awaited: the result screen must never wait on the network.
    void syncAfterMatch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.winner, state.draw]);

  const playResult = async (res: MoveResult, abilityId?: AbilityId) => {
    if (undoEnabled && res.player === youId) {
      undoHistory.current.record({
        state,
        tally: JSON.parse(JSON.stringify(tally.current)),
      });
      syncUndo();
    }
    trackResult(res, abilityId);
    const willShrink =
      res.winner === null &&
      state.rules.enableShrink &&
      state.rules.shrinkIntervalRounds > 0 &&
      (state.turn + 1) % state.rules.shrinkIntervalRounds === 0;

    await animateMove(res);
    setState((s) => commitMove(s, res));

    if (willShrink) {
      await animateShrink();
      setState((s) => {
        const shrunk = applyShrink(s);
        return shrunk ? { ...shrunk, turnStartAt: Date.now() } : s;
      });
    }
  };

  const playMove = async (r: number, c: number) => {
    if (!canPlace(state, r, c)) return;
    const res = applyMove(state, r, c);
    if (!res) return;
    // Extra placements (Double Drop / Arena power bonus) are resolved inside the engine.
    await playResult(res);
  };

  const handleCellClick = async (r: number, c: number) => {
    if (!clickable) return;
    // Ability targeting flow
    if (selectedAbility) {
      const def = abilityById(selectedAbility);
      if (def.targets === 1) {
        if (!def.validate(state, r, c, 0)) return;
        const abilityId = selectedAbility;
        const res = castAbility(state, abilityId, [[r, c]]);
        setSelectedAbility(null);
        if (res) await playResult(res, abilityId);
        return;
      }
      if (def.targets === 2) {
        if (!abilityFirstTarget) {
          if (!def.validate(state, r, c, 0)) return;
          setAbilityFirstTarget([r, c]);
          return;
        }
        if (!def.validate(state, r, c, 1, abilityFirstTarget)) return;
        const abilityId = selectedAbility;
        const res = castAbility(state, abilityId, [abilityFirstTarget, [r, c]]);
        setSelectedAbility(null);
        setAbilityFirstTarget(null);
        if (res) await playResult(res, abilityId);
        return;
      }
    }
    if (settings.turnConfirmation && !currentPlayer.isAI) {
      if (!canPlace(state, r, c)) return;
      if (!pendingCell || pendingCell[0] !== r || pendingCell[1] !== c) {
        setPendingCell([r, c]);
        return;
      }
      setPendingCell(null);
    }
    playSfx(settings, "place");
    haptic(settings, "place");
    await playMove(r, c);
  };

  const castZeroTargetAbility = async (id: AbilityId) => {
    const def = abilityById(id);
    if (def.targets !== 0) return;
    const res = castAbility(state, id, []);
    setSelectedAbility(null);
    if (res) await playResult(res, id);
  };

  const onSelectAbility = (id: AbilityId | null) => {
    setAbilityFirstTarget(null);
    if (id && abilityById(id).targets === 0) {
      castZeroTargetAbility(id);
      return;
    }
    setSelectedAbility(id);
  };

  /** Rewinds to just before the human's last move (bot replies included). */
  const handleUndo = () => {
    if (!undoEnabled || anim.running || state.winner !== null || state.draw) return;
    if (currentPlayer.isAI) return; // a bot is thinking / moving: wait for the human's turn
    const snap = undoHistory.current.undo();
    if (!snap) return;
    tally.current = snap.tally;
    setState({ ...snap.state, turnStartAt: Date.now() });
    setAnim((a) => ({
      ...a,
      displayBoard: snap.state.board,
      explodingKeys: new Set(),
      flying: [],
      showChainBanner: null,
    }));
    setSelectedAbility(null);
    setAbilityFirstTarget(null);
    setPendingCell(null);
    syncUndo();
  };

  // AI turn driver
  useEffect(() => {
    if (state.winner !== null || state.draw) return;
    if (anim.running) return;
    if (!currentPlayer.isAI) return;
    let cancelled = false;
    const timeLeft =
      state.rules.turnTimeMs > 0
        ? state.rules.turnTimeMs - (Date.now() - state.turnStartAt)
        : Infinity;
    const delay = Math.max(0, Math.min(450, timeLeft - 300));
    const t = setTimeout(async () => {
      if (cancelled) return;
      // Heavy searches run in a worker so the board stays responsive while the bot thinks.
      const action = await chooseAIActionAsync(state, currentPlayer.difficulty ?? "normal");
      if (cancelled || !action) return; // the position changed while thinking (e.g. timer forfeit)
      if (action.type === "ability" && action.abilityId && action.targets) {
        const res = castAbility(state, action.abilityId, action.targets);
        if (res) await playResult(res, action.abilityId);
      } else {
        await playMove(action.r, action.c);
      }
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, anim.running, currentPlayer.isAI]);

  const animateMove = async (res: MoveResult): Promise<void> => {
    setAnim((a) => ({
      ...a,
      running: true,
      // The player's own orb appears on the next frame. Showing `boardBefore` here instead left
      // every tap with no feedback at all for the length of the pause below — measured at ~155ms
      // on a device, and identical on a 6x9 and a 10x15, which is what gave it away as a timer
      // rather than render cost. The pause is there to telegraph the explosion, not the placement.
      displayBoard: boardAfterPlacement(res),
      explodingKeys: new Set(),
      flying: [],
    }));

    // Nothing to telegraph when nothing explodes, so a simple placement resolves immediately.
    if (res.steps.length > 0) await sleep(Math.round(140 * sf));

    let chain = 0;
    for (let i = 0; i < res.steps.length; i++) {
      const step = res.steps[i];
      const keys = new Set(step.explosions.map((e) => `${e.row}:${e.col}`));

      const anticipation = Math.round(
        (chain < 3 ? 180 : chain < 10 ? 140 : chain < 20 ? 100 : 80) * sf,
      );
      const travel = Math.round((chain < 3 ? 260 : chain < 10 ? 200 : chain < 20 ? 150 : 110) * sf);

      if (step.explosions.length > 0) {
        playSfx(settings, "explode");
        haptic(settings, "explode");
      }
      setAnim((a) => ({ ...a, explodingKeys: keys, flying: [] }));
      await sleep(anticipation);

      const orbSize = Math.max(10, Math.round(cellSize * 0.32));
      const flying: FlyingOrb[] = [];
      const hopSet = new Set<string>();
      if (step.hops) {
        for (const h of step.hops) {
          const color = colorFor(state.players[h.owner].colorIndex);
          const src = cellCenter(h.from[0], h.from[1]);
          const dst = cellCenter(h.to[0], h.to[1]);
          flying.push({
            key: `${i}-hop-${h.from.join(",")}-${h.to.join(",")}`,
            x: src.x - orbSize / 2,
            y: src.y - orbSize / 2,
            tx: dst.x - src.x,
            ty: dst.y - src.y,
            color,
            size: orbSize,
            duration: travel,
          });
          hopSet.add(`${h.from[0]}:${h.from[1]}`);
        }
      }
      for (const ex of step.explosions) {
        const color = colorFor(state.players[ex.owner].colorIndex);
        const src = cellCenter(ex.row, ex.col);
        const srcCell = state.board.cells[ex.row * state.board.cols + ex.col];
        const orbsPerNeighbor = srcCell.tile === "amplifier" ? 2 : 1;
        for (const [nr, nc] of neighbors(res.boardBefore, ex.row, ex.col)) {
          const target = state.board.cells[nr * state.board.cols + nc];
          if (target.tile === "wall") continue;
          // Portal-bound orbs are animated via `step.hops`; skip a duplicate
          // straight-line orb into the portal here.
          if (target.tile === "portal") continue;
          const dst = cellCenter(nr, nc);
          for (let k = 0; k < orbsPerNeighbor; k++) {
            flying.push({
              key: `${i}-${ex.row}:${ex.col}->${nr}:${nc}-${k}`,
              x: src.x - orbSize / 2,
              y: src.y - orbSize / 2,
              tx: dst.x - src.x,
              ty: dst.y - src.y,
              color,
              size: orbSize,
              duration: travel,
            });
          }
        }
      }
      setAnim((a) => ({ ...a, flying }));
      await sleep(travel);

      chain += step.explosions.length;
      const newBanner =
        chain >= 3 ? { count: chain, key: ++bannerRef.current } : anim.showChainBanner;
      setAnim((a) => ({
        ...a,
        displayBoard: step.boardAfter,
        explodingKeys: new Set(),
        flying: [],
        showChainBanner: newBanner,
      }));

      await sleep(Math.round(60 * sf));
    }
    setAnim((a) => ({
      ...a,
      running: false,
      displayBoard: res.boardAfter,
      explodingKeys: new Set(),
      flying: [],
    }));
  };

  const animateShrink = async (): Promise<void> => {
    setAnim((a) => ({ ...a, running: true, showShrinkBanner: { key: ++shrinkBannerRef.current } }));
    await sleep(900);
    setAnim((a) => ({ ...a, running: false, showShrinkBanner: null }));
  };

  const activePlayers = state.players.filter((p) => !state.eliminated[p.id]);
  const durationMs = (state.endedAt ?? now) - state.startedAt;

  if (state.winner !== null) {
    const winner = state.players.find((p) => p.id === state.winner)!;
    return (
      <VictoryScreen
        winner={winner}
        turns={state.turn}
        durationMs={durationMs}
        largestChain={state.largestChain}
        eliminated={state.players.length - activePlayers.length}
        cellsCaptured={state.totalCapturedCells}
        largestTerritory={Math.max(...state.players.map((p) => cellsOwnedBy(state.board, p.id)))}
        onRematch={onRematch}
        onMenu={onExit}
      />
    );
  }

  if (state.draw) {
    return (
      <div className="min-h-screen grid place-items-center px-6 py-12">
        <div className="text-center">
          <div className="font-display text-6xl font-black tracking-tight text-foreground">
            DRAW
          </div>
          <div className="mt-2 text-sm text-muted-foreground">
            All active players eliminated simultaneously.
          </div>
          <div className="mt-8 flex justify-center gap-3">
            <button
              onClick={onRematch}
              className="rounded-md bg-foreground px-6 py-2 font-display text-xs tracking-[0.2em] text-background transition hover:bg-foreground/80"
            >
              REMATCH
            </button>
            <button
              onClick={onExit}
              className="rounded-md border border-foreground/30 px-6 py-2 font-display text-xs tracking-[0.2em] transition hover:bg-foreground/10"
            >
              MENU
            </button>
          </div>
        </div>
      </div>
    );
  }

  const boardWidth =
    state.board.cols * cellSize + (state.board.cols - 1) * CELL_GAP + BOARD_PADDING * 2;
  const boardHeight =
    state.board.rows * cellSize + (state.board.rows - 1) * CELL_GAP + BOARD_PADDING * 2;

  // Compute highlight map for ability targeting.
  const highlight = new Map<string, "target" | "selected">();
  if (selectedAbility) {
    const def = abilityById(selectedAbility);
    if (def.targets >= 1) {
      for (let r = 0; r < state.board.rows; r++) {
        for (let c = 0; c < state.board.cols; c++) {
          const step: 0 | 1 = abilityFirstTarget ? 1 : 0;
          if (def.validate(state, r, c, step, abilityFirstTarget ?? undefined)) {
            highlight.set(`${r}:${c}`, "target");
          }
        }
      }
    }
    if (abilityFirstTarget) {
      highlight.set(`${abilityFirstTarget[0]}:${abilityFirstTarget[1]}`, "selected");
    }
  }
  if (pendingCell) highlight.set(`${pendingCell[0]}:${pendingCell[1]}`, "selected");

  const currentPid = currentPlayer.id;
  const extraPlacement = state.extraPlacementFor === currentPid;

  return (
    <div className="min-h-screen px-3 py-4 sm:px-6 sm:py-6">
      <div className="mx-auto max-w-[1600px]">
        <header className="mb-4 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 sm:flex sm:items-center sm:justify-between">
          <div className="min-w-0">
            <button
              onClick={onExit}
              className="text-[10px] tracking-[0.3em] text-muted-foreground hover:text-foreground"
            >
              ← MENU
            </button>
            <h1 className="mt-1 break-words font-display text-base leading-tight tracking-widest sm:text-xl">
              {modeLabel.toUpperCase()} · {state.board.rows}×{state.board.cols}
            </h1>
          </div>
          {/* Actions: their own row on phones (three buttons would squeeze the title to nothing). */}
          <div
            className="col-span-2 row-start-2 flex flex-wrap items-center gap-2 sm:order-2 sm:col-span-1 sm:row-start-auto sm:ml-auto sm:mr-4"
            data-testid="game-actions"
          >
            {canZoom && (
              <button
                onClick={() => setZoomed((z) => !z)}
                aria-pressed={zoomed}
                className={`whitespace-nowrap rounded-md border px-2 py-1 text-[10px] tracking-[0.2em] ${
                  zoomed
                    ? "border-foreground/50 text-foreground"
                    : "border-foreground/20 text-muted-foreground hover:text-foreground"
                }`}
              >
                ⌕ ZOOM
              </button>
            )}
            {undoEnabled && (
              <button
                onClick={handleUndo}
                disabled={!undoInfo.available || !clickable}
                aria-label={`Undo last move, ${undoInfo.left} left`}
                className="whitespace-nowrap rounded-md border border-foreground/20 px-2 py-1 text-[10px] tracking-[0.2em] text-muted-foreground enabled:hover:text-foreground disabled:opacity-40"
              >
                ↶ UNDO {undoInfo.left}
              </button>
            )}
            {modeConfig.specialTiles && (
              <button
                onClick={() => setShowTileInfo((v) => !v)}
                className="whitespace-nowrap rounded-md border border-foreground/20 px-2 py-1 text-[10px] tracking-[0.2em] text-muted-foreground hover:text-foreground"
              >
                TILE INFO
              </button>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-4 text-right sm:order-3">
            <div>
              <div className="text-[10px] tracking-[0.3em] text-muted-foreground">TURN</div>
              <div className="font-display text-lg">{state.turn + 1}</div>
            </div>
            <div>
              <div className="text-[10px] tracking-[0.3em] text-muted-foreground">TIME</div>
              <div className="font-display text-lg tabular-nums">{formatDur(durationMs)}</div>
            </div>
          </div>
        </header>

        <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)_240px] land:grid-cols-[minmax(0,1fr)_280px] land:items-start">
          {/* Left: players */}
          <aside className="order-2 lg:order-1 land:order-2 land:col-start-2 land:row-start-1">
            <div className="space-y-2">
              {state.players.map((p) => {
                const color = colorFor(p.colorIndex);
                const owned = cellsOwnedBy(anim.displayBoard, p.id);
                const orbs = orbsOwnedBy(anim.displayBoard, p.id);
                const isCurrent = p.id === currentPlayer.id;
                const isDead = state.eliminated[p.id];
                return (
                  <div
                    key={p.id}
                    className={`relative rounded-md border p-3 transition
                      ${isCurrent ? "border-foreground/30 bg-foreground/[0.03]" : "border-foreground/10 bg-transparent"}
                      ${isDead ? "opacity-40" : ""}`}
                  >
                    {isCurrent && (
                      <span
                        className="absolute inset-y-0 left-0 w-1 rounded-l-md"
                        style={{ background: color }}
                      />
                    )}
                    <div className="flex items-center gap-2">
                      <span
                        className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px]"
                        style={{
                          background: `radial-gradient(circle at 32% 30%, ${lighten(color, 18)}, ${color})`,
                          color: "oklch(0.12 0 0)",
                        }}
                      >
                        {PLAYER_SYMBOLS[p.colorIndex]}
                      </span>
                      <span className="min-w-0 truncate font-display text-sm">{p.name}</span>
                      {p.isAI && (
                        <span className="rounded-sm border border-foreground/20 px-1 text-[9px] tracking-[0.2em] text-muted-foreground">
                          CPU·{(p.difficulty ?? "normal").slice(0, 1).toUpperCase()}
                        </span>
                      )}
                      {isDead && (
                        <span className="ml-auto text-[10px] tracking-widest text-destructive">
                          OUT
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                      <span>{owned} cells</span>
                      <span>{orbs} orbs</span>
                    </div>
                    {modeConfig.energy && !isDead && (
                      <div className="mt-2">
                        <div className="flex items-baseline justify-between text-[9px] tracking-[0.2em] text-muted-foreground">
                          <span>EP</span>
                          <span className="tabular-nums">{state.energy[p.id]}/100</span>
                        </div>
                        <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-white/10">
                          <div
                            className="h-full"
                            style={{ width: `${state.energy[p.id]}%`, background: color }}
                          />
                        </div>
                      </div>
                    )}
                    {modeConfig.specialTiles && state.powerBonus[p.id] > 0 && !isDead && (
                      <div className="mt-1 text-[9px] tracking-[0.2em] text-[oklch(0.78_0.14_60)]">
                        ⚡ POWER READY
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </aside>

          {/* Board */}
          <div
            className={`order-1 relative flex land:order-1 land:col-start-1 land:row-span-2 land:row-start-1 lg:order-2 ${
              zoomed && canZoom
                ? // overscroll-contain keeps a pan of the zoomed board from chaining into the
                  // page once it hits an edge, which otherwise scrolls the whole screen away
                  // mid-move.
                  "max-h-[75vh] justify-start overflow-auto overscroll-contain rounded-md"
                : "items-center justify-center"
            }`}
            data-testid="board-frame"
          >
            <div
              className="relative rounded-md"
              style={{
                width: boardWidth,
                height: boardHeight,
                background: "oklch(0.18 0.008 260)",
                border: "1px solid oklch(0.30 0.008 260 / 0.7)",
                padding: BOARD_PADDING,
              }}
            >
              <div
                className="grid"
                style={{
                  gap: CELL_GAP,
                  gridTemplateColumns: `repeat(${state.board.cols}, ${cellSize}px)`,
                  gridTemplateRows: `repeat(${state.board.rows}, ${cellSize}px)`,
                  background: "oklch(0.24 0.008 260 / 0.5)",
                }}
              >
                {Array.from({ length: state.board.rows }).map((_, r) =>
                  Array.from({ length: state.board.cols }).map((_, c) => {
                    // Indexed with the display board's OWN width: for one frame after a shrink
                    // it is still the larger pre-shrink board, and mixing the two widths reads
                    // the wrong cells.
                    const cell = anim.displayBoard.cells[r * anim.displayBoard.cols + c];
                    const highlightKind = highlight.get(`${r}:${c}`) ?? null;
                    let canP: boolean;
                    if (selectedAbility) {
                      const def = abilityById(selectedAbility);
                      const step: 0 | 1 = abilityFirstTarget ? 1 : 0;
                      canP =
                        clickable &&
                        def.validate(state, r, c, step, abilityFirstTarget ?? undefined);
                    } else {
                      canP = clickable && canPlace(state, r, c);
                    }
                    return (
                      <CellView
                        key={`${r}:${c}`}
                        cell={cell}
                        row={r}
                        col={c}
                        rows={state.board.rows}
                        cols={state.board.cols}
                        cellSize={cellSize}
                        criticalMass={effectiveCriticalMass(anim.displayBoard, r, c)}
                        playerColorIndex={(pid) => state.players[pid].colorIndex}
                        onClick={() => handleCellClick(r, c)}
                        clickable={canP}
                        exploding={anim.explodingKeys.has(`${r}:${c}`)}
                        highlight={highlightKind}
                        orbMotion={settings.orbMotion}
                        reducedMotion={settings.reducedMotion}
                        showCritical={settings.showCriticalCells}
                      />
                    );
                  }),
                )}
              </div>

              {/* Flying orbs */}
              <div className="pointer-events-none absolute inset-0">
                {anim.flying.map((f) => (
                  <span
                    key={f.key}
                    className="absolute rounded-full"
                    style={{
                      left: f.x,
                      top: f.y,
                      width: f.size,
                      height: f.size,
                      background: `radial-gradient(circle at 32% 30%, ${lighten(f.color, 22)} 0%, ${f.color} 45%, ${darken(f.color, 25)} 100%)`,
                      // @ts-expect-error css vars
                      "--tx": `${f.tx}px`,
                      "--ty": `${f.ty}px`,
                      animation: `orb-fly ${f.duration}ms cubic-bezier(0.4, 0, 0.6, 1) forwards`,
                      willChange: "transform",
                    }}
                  />
                ))}
              </div>

              {anim.showChainBanner && (
                <div
                  // Namespaced: the two banners are siblings in one JSX child list, and their
                  // counters are independent — bare numbers collide whenever both happen to
                  // reach the same value with both banners on screen.
                  key={`chain-${anim.showChainBanner.key}`}
                  className="pointer-events-none absolute inset-0 flex items-center justify-center"
                >
                  <div className="combo-banner text-center">
                    <div className="font-display text-[10px] tracking-[0.5em] text-foreground/60">
                      {chainLabel(anim.showChainBanner.count)}
                    </div>
                    <div
                      className="font-display text-5xl font-bold sm:text-7xl"
                      style={{ color: currentColor }}
                    >
                      ×{anim.showChainBanner.count}
                    </div>
                  </div>
                </div>
              )}

              {anim.showShrinkBanner && (
                <div
                  key={`shrink-${anim.showShrinkBanner.key}`}
                  className="pointer-events-none absolute inset-0 flex items-center justify-center"
                >
                  <div className="shrink-banner text-center">
                    <div className="font-display text-[10px] tracking-[0.5em] text-destructive/80">
                      SUDDEN DEATH
                    </div>
                    <div className="font-display text-5xl font-bold text-destructive sm:text-7xl">
                      SHRINK
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right: current turn, abilities, tile info */}
          <aside className="order-3 space-y-2 land:col-start-2 land:row-start-2">
            <div className="rounded-md border border-foreground/10 p-3">
              <div className="text-[10px] tracking-[0.3em] text-muted-foreground">CURRENT TURN</div>
              <div className="mt-2 flex items-center gap-2">
                <span
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full"
                  style={{
                    background: `radial-gradient(circle at 32% 30%, ${lighten(currentColor, 18)}, ${currentColor})`,
                    color: "oklch(0.12 0 0)",
                  }}
                >
                  {PLAYER_SYMBOLS[currentPlayer.colorIndex]}
                </span>
                <div className="min-w-0">
                  <div className="truncate font-display text-sm">{currentPlayer.name}</div>
                  <div className="text-[10px] tracking-widest text-muted-foreground">
                    {anim.running
                      ? "REACTING…"
                      : currentPlayer.isAI
                        ? "CPU THINKING…"
                        : selectedAbility
                          ? `SELECT ${abilityById(selectedAbility).name.toUpperCase()} TARGET`
                          : extraPlacement
                            ? "EXTRA PLACEMENT"
                            : "YOUR MOVE"}
                  </div>
                </div>
              </div>
              {extraPlacement && (
                <div className="mt-2 text-[10px] tracking-[0.2em] text-[oklch(0.78_0.14_60)]">
                  ⚡ {modeConfig.specialTiles ? "POWER TILE" : "DOUBLE DROP"} — place a bonus orb
                </div>
              )}
              {selectedAbility && (
                <button
                  onClick={() => {
                    setSelectedAbility(null);
                    setAbilityFirstTarget(null);
                  }}
                  className="mt-2 w-full rounded-md border border-white/10 py-1 text-[10px] tracking-[0.25em] text-muted-foreground hover:text-white"
                >
                  CANCEL
                </button>
              )}
            </div>

            {modeConfig.abilities && (
              <AbilityBar
                energy={state.energy[currentPid]}
                selectedAbility={selectedAbility}
                onSelect={onSelectAbility}
                disabled={!clickable}
              />
            )}

            {state.rules.turnTimeMs > 0 && (
              <div className="rounded-md border border-foreground/10 p-3">
                <div className="text-[10px] tracking-[0.3em] text-muted-foreground">TURN TIMER</div>
                <div
                  className="mt-1 font-display text-2xl tabular-nums"
                  style={{ color: turnTimeLeft < 3000 ? "oklch(0.6 0.2 25)" : "inherit" }}
                >
                  {turnTimeLeft === Infinity ? "--" : formatTimer(turnTimeLeft)}
                </div>
                <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full transition-all duration-100 ease-linear"
                    style={{
                      width:
                        turnTimeLeft === Infinity
                          ? "0%"
                          : `${(turnTimeLeft / state.rules.turnTimeMs) * 100}%`,
                      background:
                        turnTimeLeft < 3000 ? "oklch(0.6 0.2 25)" : "oklch(0.72 0.18 235)",
                    }}
                  />
                </div>
              </div>
            )}

            {shrinkTurnsLeft !== null && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3">
                <div className="text-[10px] tracking-[0.3em] text-destructive/80">SHRINK IN</div>
                <div className="mt-1 font-display text-2xl tabular-nums text-destructive">
                  {shrinkTurnsLeft === 0
                    ? "NOW"
                    : `${shrinkTurnsLeft} TURN${shrinkTurnsLeft === 1 ? "" : "S"}`}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <Stat
                label="ROUND"
                value={String(Math.floor(state.turn / Math.max(1, activePlayers.length)) + 1)}
              />
              <Stat label="ALIVE" value={`${activePlayers.length}/${state.players.length}`} />
              <Stat label="BIGGEST CHAIN" value={String(state.largestChain)} />
              <Stat label="EXPLOSIONS" value={String(state.totalExplosions)} />
            </div>

            <div className="rounded-md border border-foreground/10 p-3 text-xs text-muted-foreground">
              <div className="font-display text-[10px] tracking-[0.3em] text-foreground/70">
                HOW
              </div>
              <p className="mt-1 leading-relaxed">
                Place orbs in empty cells or your own. Corners hold 2, edges 3, interior 4. Reach
                the limit to ignite a chain reaction.
              </p>
            </div>
          </aside>
        </div>

        {/* Mobile ability drawer */}
        {modeConfig.abilities && (
          <div className="fixed bottom-3 left-3 right-3 z-30 lg:hidden">
            <details className="rounded-md border border-white/10 bg-black/85 backdrop-blur">
              <summary className="cursor-pointer list-none px-3 py-2 font-display text-xs tracking-[0.3em]">
                ABILITIES · {state.energy[currentPid]}/100 EP
              </summary>
              <div className="p-2">
                <AbilityBar
                  energy={state.energy[currentPid]}
                  selectedAbility={selectedAbility}
                  onSelect={onSelectAbility}
                  disabled={!clickable}
                  compact
                />
              </div>
            </details>
          </div>
        )}

        {/* Tile Info popover */}
        {showTileInfo && modeConfig.specialTiles && (
          <div
            className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
            onClick={() => setShowTileInfo(false)}
          >
            <div
              className="max-w-md w-full rounded-md border border-white/15 bg-[oklch(0.15_0.008_260)] p-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <div className="font-display text-sm tracking-[0.3em]">TILE INFO</div>
                <button
                  onClick={() => setShowTileInfo(false)}
                  className="text-xs text-muted-foreground hover:text-white"
                >
                  CLOSE
                </button>
              </div>
              <ul className="mt-4 space-y-2 text-xs">
                <TileInfo
                  name="POWER TILE"
                  text="Capture from another player (or claim when neutral) to earn one bonus placement on your next turn."
                />
                <TileInfo
                  name="PORTAL"
                  text="Playable cell. Orbs entering via an explosion teleport to the paired portal and continue the chain there."
                />
                <TileInfo
                  name="AMPLIFIER"
                  text="Playable cell. When it explodes, it sends TWO orbs to each valid neighbor instead of one."
                />
                <TileInfo
                  name="REACTOR"
                  text="Playable cell. While you own it, its critical mass is one higher — slower to detonate, but the payoff chain is bigger."
                />
                <TileInfo
                  name="WALL"
                  text="Not playable. Blocks placement and explosion orbs — adjacent cells' critical mass drops accordingly."
                />
                <TileInfo
                  name="DEAD ZONE"
                  text="Not playable. Any orb that lands here — placed or flying in from an explosion — is destroyed for good."
                />
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TileInfo({ name, text }: { name: string; text: string }) {
  return (
    <li className="rounded border border-white/10 p-2">
      <div className="font-display text-[11px] tracking-[0.25em]">{name}</div>
      <div className="mt-0.5 text-muted-foreground">{text}</div>
    </li>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-foreground/10 p-2">
      <div className="text-[9px] tracking-[0.25em] text-muted-foreground">{label}</div>
      <div className="font-display text-lg">{value}</div>
    </div>
  );
}

function chainLabel(n: number): string {
  if (n >= 30) return "CATASTROPHIC";
  if (n >= 15) return "MASSIVE";
  if (n >= 8) return "GREAT CHAIN";
  return "CHAIN";
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}
function formatTimer(ms: number) {
  return (ms / 1000).toFixed(1);
}
function formatDur(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${m}:${String(rs).padStart(2, "0")}`;
}

function useCellSize(rows: number, cols: number) {
  const [size, setSize] = useState(() => computeSize(rows, cols));
  useEffect(() => {
    const on = () => setSize(computeSize(rows, cols));
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, [rows, cols]);
  useEffect(() => {
    setSize(computeSize(rows, cols));
  }, [rows, cols]);
  return size;
}

function computeSize(rows: number, cols: number) {
  if (typeof window === "undefined") return 40;
  return computeCellSize(rows, cols, window.innerWidth, window.innerHeight);
}

export default GameScreen;
