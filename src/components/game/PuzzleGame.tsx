import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyMove,
  cellsOwnedBy,
  cloneBoard,
  commitMove,
  effectiveCriticalMass,
  idx,
  makeInitialState,
  MODE_CONFIGS,
  type BoardState,
  type GameState,
  type PlayerConfig,
} from "@/game/engine";
import { CellView } from "./CellView";
import { colorFor } from "@/game/colors";
import { speedFactor, useSettings } from "@/game/settings";
import { playSfx } from "@/game/sound";
import { useProfile } from "@/game/profile";
import {
  applySolve,
  buildPuzzleBoard,
  DIFFICULTY_LABEL,
  highlightedCells,
  loadPuzzleProgress,
  medalFor,
  MEDAL_COLOR,
  MEDAL_LABEL,
  objectiveText,
  savePuzzleProgress,
  type Medal,
  type PuzzleDef,
} from "@/game/puzzles";

interface Props {
  puzzle: PuzzleDef;
  onBack: () => void;
  onNext?: () => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Status =
  | { kind: "playing" }
  | { kind: "solved"; medal: Medal; moves: number; xp: number }
  | { kind: "failed" };

export function PuzzleGame({ puzzle, onBack, onNext }: Props) {
  const { settings } = useSettings();
  const { addXp } = useProfile();
  const sf = speedFactor(settings);

  const players = useMemo<PlayerConfig[]>(
    () =>
      puzzle.playerColors.map((colorIndex, i) => ({
        id: i,
        name: i === 0 ? "YOU" : `AI ${i}`,
        colorIndex,
      })),
    [puzzle],
  );

  const makeState = useCallback(
    (): GameState =>
      makeInitialState(
        players,
        puzzle.rows,
        puzzle.cols,
        "classic",
        undefined,
        MODE_CONFIGS[puzzle.modeKind],
        buildPuzzleBoard(puzzle),
      ),
    [players, puzzle],
  );

  const [state, setState] = useState<GameState>(makeState);
  const [display, setDisplay] = useState<BoardState>(() => state.board);
  const [moves, setMoves] = useState(0);
  const [status, setStatus] = useState<Status>({ kind: "playing" });
  const [attempts, setAttempts] = useState(1);
  const [showHint, setShowHint] = useState(false);
  const busy = useRef(false);
  const [animating, setAnimating] = useState(false);

  const highlights = useMemo(() => highlightedCells(puzzle), [puzzle]);
  const cellSize = useCellSize(puzzle.rows, puzzle.cols);

  // Reset when the puzzle changes.
  useEffect(() => {
    const s = makeState();
    setState(s);
    setDisplay(s.board);
    setMoves(0);
    setStatus({ kind: "playing" });
    setAttempts(1);
    setShowHint(false);
    busy.current = false;
  }, [makeState]);

  const retry = () => {
    if (busy.current) return;
    const s = makeState();
    setState(s);
    setDisplay(s.board);
    setMoves(0);
    setStatus({ kind: "playing" });
    setAttempts((a) => a + 1);
  };

  const checkObjective = (board: BoardState, chain: number): boolean => {
    const o = puzzle.objective;
    if (o.kind === "chain") return chain >= o.minExplosions;
    if (o.kind === "capture") return board.cells[o.row * board.cols + o.col].owner === 0;
    if (o.kind === "eliminate") return cellsOwnedBy(board, o.playerIdx) === 0;
    return players.slice(1).every((p) => cellsOwnedBy(board, p.id) === 0);
  };

  const solve = (movesUsed: number) => {
    const medal = medalFor(puzzle, movesUsed) ?? "bronze";
    const progress = loadPuzzleProgress();
    const { progress: next, xpGained } = applySolve(progress, puzzle, movesUsed, medal);
    savePuzzleProgress(next);
    if (xpGained > 0) addXp(xpGained);
    playSfx(settings, "explode");
    setStatus({ kind: "solved", medal, moves: movesUsed, xp: xpGained });
  };

  const onCell = async (r: number, c: number) => {
    if (busy.current || status.kind !== "playing") return;
    const res = applyMove(state, r, c);
    if (!res) return;
    busy.current = true;
    setAnimating(true);
    playSfx(settings, "place");

    // Placement snapshot before any explosions.
    const placed = cloneBoard(res.boardBefore);
    const pc = placed.cells[idx(placed, r, c)];
    pc.orbs += 1;
    pc.owner = res.player;
    setDisplay(placed);
    await sleep(Math.round(180 * sf));

    for (const step of res.steps) {
      playSfx(settings, "explode");
      setDisplay(step.boardAfter);
      await sleep(Math.round(260 * sf));
    }

    // Solver-only puzzle: opponents never move, so the turn returns to you.
    const committed = commitMove(state, res);
    const next: GameState = { ...committed, currentPlayerIdx: 0, winner: null, draw: false };
    setState(next);
    setDisplay(next.board);

    const used = moves + 1;
    setMoves(used);
    busy.current = false;
    setAnimating(false);

    if (checkObjective(next.board, res.chainCount)) solve(used);
    else if (used >= puzzle.maxMoves) setStatus({ kind: "failed" });
  };

  const clickable = status.kind === "playing" && !animating;

  return (
    <div className="min-h-screen px-5 py-8">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center justify-between gap-3">
          <button
            onClick={onBack}
            className="rounded-sm border border-white/15 px-3 py-1.5 font-display text-[10px] tracking-[0.25em] text-muted-foreground transition hover:bg-white/5 hover:text-foreground"
          >
            ← PUZZLES
          </button>
          <span className="text-[10px] tracking-[0.3em] text-muted-foreground">
            {DIFFICULTY_LABEL[puzzle.difficulty]}
          </span>
        </div>

        <h1 className="mt-6 font-display text-3xl font-black tracking-tight">{puzzle.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{puzzle.brief}</p>

        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-[10px] tracking-[0.25em] text-muted-foreground">
          <span>OBJECTIVE · {objectiveText(puzzle).toUpperCase()}</span>
          <span>
            MOVES · {moves}/{puzzle.maxMoves}
          </span>
          <span>ATTEMPT · {attempts}</span>
        </div>

        <div className="mt-3 flex flex-wrap gap-2 text-[9px] tracking-[0.2em]">
          {(["gold", "silver", "bronze"] as Medal[]).map((m) => (
            <span
              key={m}
              className="rounded-sm border border-white/10 px-2 py-1"
              style={{ color: MEDAL_COLOR[m] }}
            >
              {MEDAL_LABEL[m]} ≤ {puzzle.medals[m]}
            </span>
          ))}
        </div>

        <div className="mt-6 flex justify-center">
          <div
            className="grid gap-[3px] rounded-[4px] bg-white/[0.06] p-[3px]"
            style={{ gridTemplateColumns: `repeat(${puzzle.cols}, ${cellSize}px)` }}
          >
            {Array.from({ length: puzzle.rows * puzzle.cols }, (_, i) => {
              const r = Math.floor(i / puzzle.cols);
              const c = i % puzzle.cols;
              const cell = display.cells[i];
              return (
                <CellView
                  key={i}
                  cell={cell}
                  row={r}
                  col={c}
                  rows={puzzle.rows}
                  cols={puzzle.cols}
                  cellSize={cellSize}
                  criticalMass={effectiveCriticalMass(display, r, c)}
                  playerColorIndex={(pid) => players[pid]?.colorIndex ?? pid}
                  onClick={() => void onCell(r, c)}
                  clickable={clickable && cell.tile !== "wall"}
                  highlight={highlights.has(`${r}:${c}`) ? "target" : null}
                  orbMotion={settings.orbMotion}
                  reducedMotion={settings.reducedMotion}
                  showCritical={settings.showCriticalCells}
                />
              );
            })}
          </div>
        </div>

        {puzzle.hint && status.kind === "playing" && (
          <div className="mt-5 flex justify-center">
            {showHint ? (
              <div className="max-w-md text-center text-xs text-muted-foreground">
                Hint: {puzzle.hint}
              </div>
            ) : (
              <button
                onClick={() => setShowHint(true)}
                className="rounded-sm border border-white/15 px-3 py-1.5 font-display text-[10px] tracking-[0.25em] text-muted-foreground transition hover:bg-white/5 hover:text-foreground"
              >
                SHOW HINT
              </button>
            )}
          </div>
        )}

        <div className="mt-6 flex justify-center gap-3">
          <button
            onClick={retry}
            className="rounded-md border border-white/20 px-6 py-2 font-display text-[10px] tracking-[0.3em] transition hover:bg-white/10"
          >
            RETRY
          </button>
        </div>

        {status.kind !== "playing" && (
          <div className="mt-6 rounded-lg border border-white/15 bg-white/[0.04] p-6 text-center">
            {status.kind === "solved" ? (
              <>
                <div
                  className="font-display text-3xl font-black tracking-tight"
                  style={{ color: MEDAL_COLOR[status.medal] }}
                >
                  {MEDAL_LABEL[status.medal]}
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  Solved in {status.moves} {status.moves === 1 ? "move" : "moves"}
                  {status.xp > 0 ? ` · +${status.xp} XP` : " · no new XP"}
                </div>
                <div className="mt-5 flex flex-wrap justify-center gap-3">
                  <button
                    onClick={retry}
                    className="rounded-md border border-white/20 px-6 py-2 font-display text-[10px] tracking-[0.3em] transition hover:bg-white/10"
                  >
                    PLAY AGAIN
                  </button>
                  {onNext && (
                    <button
                      onClick={onNext}
                      className="rounded-md bg-foreground px-6 py-2 font-display text-[10px] tracking-[0.3em] text-background transition hover:bg-foreground/80"
                    >
                      NEXT PUZZLE
                    </button>
                  )}
                  <button
                    onClick={onBack}
                    className="rounded-md border border-white/20 px-6 py-2 font-display text-[10px] tracking-[0.3em] transition hover:bg-white/10"
                  >
                    PUZZLE LIST
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="font-display text-2xl font-black tracking-tight">OUT OF MOVES</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  Unlimited retries — reset and try another line.
                </div>
                <div className="mt-5 flex justify-center gap-3">
                  <button
                    onClick={retry}
                    className="rounded-md bg-foreground px-6 py-2 font-display text-[10px] tracking-[0.3em] text-background transition hover:bg-foreground/80"
                  >
                    RETRY
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        <div className="mt-8 flex justify-center gap-2">
          {players.slice(1).map((p) => (
            <span
              key={p.id}
              className="flex items-center gap-2 rounded-sm border border-white/10 px-2 py-1 text-[10px] tracking-[0.2em] text-muted-foreground"
            >
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: colorFor(p.colorIndex) }}
              />
              {cellsOwnedBy(display, p.id)} CELLS
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function useCellSize(rows: number, cols: number) {
  const [size, setSize] = useState(46);
  useEffect(() => {
    const calc = () => {
      const w = Math.min(window.innerWidth - 48, 640);
      const h = window.innerHeight - 460;
      setSize(Math.max(26, Math.min(56, Math.floor(Math.min(w / cols, Math.max(220, h) / rows)))));
    };
    calc();
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, [rows, cols]);
  return size;
}
