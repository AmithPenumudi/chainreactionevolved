import { useCallback, useMemo, useRef, useState } from "react";
import {
  applyMove,
  BoardState,
  cloneBoard,
  commitMove,
  effectiveCriticalMass,
  GameState,
  idx,
  makeBoard,
  makeInitialState,
  MODE_CONFIGS,
  PlayerConfig,
} from "@/game/engine";
import { CellView } from "./CellView";

export interface TileSpec {
  row: number;
  col: number;
  tile: "wall" | "portal" | "amplifier" | "power" | "reactor" | "dead";
  portalPairId?: number;
}

interface Props {
  rows: number;
  cols: number;
  cellSize?: number;
  players?: number;
  tiles?: TileSpec[];
  /** Pre-placed orbs: [row, col, orbs, ownerIndex] */
  seed?: [number, number, number, number][];
  caption?: string;
  hint?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Small self-contained tutorial board. Uses the real engine so the rules shown
 * are the real rules, but is completely isolated from match state and profile stats.
 */
export function MiniBoard({
  rows,
  cols,
  cellSize = 34,
  players = 2,
  tiles,
  seed,
  caption,
  hint,
}: Props) {
  const playerCfg = useMemo<PlayerConfig[]>(
    () =>
      Array.from({ length: players }, (_, i) => ({
        id: i,
        name: `P${i + 1}`,
        colorIndex: i,
      })),
    [players],
  );

  const buildBoard = useCallback((): BoardState => {
    const b = makeBoard(rows, cols);
    for (const t of tiles ?? []) {
      const cell = b.cells[t.row * cols + t.col];
      cell.tile = t.tile;
      if (t.portalPairId !== undefined) cell.portalPairId = t.portalPairId;
    }
    for (const [r, c, orbs, owner] of seed ?? []) {
      const cell = b.cells[r * cols + c];
      cell.orbs = orbs;
      cell.owner = owner;
    }
    return b;
  }, [rows, cols, tiles, seed]);

  const makeState = useCallback(
    () =>
      makeInitialState(
        playerCfg,
        rows,
        cols,
        "classic",
        undefined,
        tiles?.length ? MODE_CONFIGS.arena : MODE_CONFIGS.classic,
        buildBoard(),
      ),
    [playerCfg, rows, cols, tiles, buildBoard],
  );

  const [state, setState] = useState<GameState>(makeState);
  const [display, setDisplay] = useState<BoardState>(() => state.board);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const reset = () => {
    if (busyRef.current) return;
    const s = makeState();
    setState(s);
    setDisplay(s.board);
  };

  const onCell = async (r: number, c: number) => {
    if (busyRef.current || state.winner !== null) return;
    const res = applyMove(state, r, c);
    if (!res) return;
    busyRef.current = true;
    setBusy(true);

    // Placement snapshot before any explosions.
    const placed = cloneBoard(res.boardBefore);
    const pc = placed.cells[idx(placed, r, c)];
    pc.orbs += 1;
    pc.owner = res.player;
    setDisplay(placed);

    for (const step of res.steps) {
      await sleep(340);
      setDisplay(step.boardAfter);
    }
    const next = commitMove(state, res);
    setState(next);
    setDisplay(next.board);
    busyRef.current = false;
    setBusy(false);
  };

  const current = state.players[state.currentPlayerIdx];

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 text-[11px] text-muted-foreground">
          {hint ?? (
            <span className="flex items-center gap-2">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: `var(--p${current.colorIndex + 1})` }}
              />
              Tap a cell to add an orb
            </span>
          )}
        </div>
        <button
          onClick={reset}
          className="shrink-0 rounded-sm border border-white/15 px-2 py-1 font-display text-[9px] tracking-[0.2em] text-muted-foreground transition hover:bg-white/5 hover:text-foreground"
        >
          RESET
        </button>
      </div>

      <div className="mt-3 flex justify-center">
        <div
          className="grid gap-[2px] rounded-[3px] bg-white/[0.06] p-[2px]"
          style={{ gridTemplateColumns: `repeat(${cols}, ${cellSize}px)` }}
        >
          {Array.from({ length: rows * cols }, (_, i) => {
            const r = Math.floor(i / cols);
            const c = i % cols;
            const cell = display.cells[i];
            return (
              <CellView
                key={i}
                cell={cell}
                row={r}
                col={c}
                rows={rows}
                cols={cols}
                cellSize={cellSize}
                criticalMass={effectiveCriticalMass(display, r, c)}
                playerColorIndex={(pid) => pid}
                onClick={() => void onCell(r, c)}
                clickable={!busy && cell.tile !== "wall"}
              />
            );
          })}
        </div>
      </div>

      {caption && (
        <div className="mt-3 text-center text-[11px] text-muted-foreground">{caption}</div>
      )}
    </div>
  );
}
