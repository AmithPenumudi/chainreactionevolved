import { PlayerConfig } from "@/game/engine";
import { colorFor, PLAYER_SYMBOLS } from "@/game/colors";

interface Props {
  winner: PlayerConfig;
  turns: number;
  durationMs: number;
  largestChain: number;
  eliminated: number;
  cellsCaptured: number;
  largestTerritory: number;
  onRematch: () => void;
  onMenu: () => void;
}

export function VictoryScreen({
  winner,
  turns,
  durationMs,
  largestChain,
  eliminated,
  cellsCaptured,
  largestTerritory,
  onRematch,
  onMenu,
}: Props) {
  const color = colorFor(winner.colorIndex);
  const stats = [
    { label: "TURNS", value: String(turns) },
    { label: "DURATION", value: formatDur(durationMs) },
    { label: "CELLS CAPTURED", value: String(cellsCaptured) },
    { label: "LARGEST CHAIN", value: String(largestChain) },
    { label: "ELIMINATED", value: String(eliminated) },
    { label: "TERRITORY", value: String(largestTerritory) },
  ];
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(circle at 50% 40%, oklch(from ${color} l c h / 0.25), transparent 60%)`,
        }}
      />
      <div className="relative w-full max-w-2xl text-center">
        <div className="font-display text-xs tracking-[0.5em] text-muted-foreground">VICTORY</div>
        <div
          className="mx-auto mt-4 grid h-24 w-24 place-items-center rounded-full text-4xl"
          style={{
            background: `radial-gradient(circle at 30% 30%, oklch(from ${color} calc(l + 0.2) c h), ${color})`,
            boxShadow: `0 0 40px ${color}, 0 0 90px ${color}`,
            color: "oklch(0.1 0 0)",
          }}
        >
          {PLAYER_SYMBOLS[winner.colorIndex]}
        </div>
        <h1
          className="mt-6 font-display text-5xl font-black tracking-tight sm:text-7xl"
          style={{ color, textShadow: `0 0 30px ${color}` }}
        >
          {winner.name.toUpperCase()}
        </h1>
        <div className="mt-2 font-display text-sm tracking-[0.3em] text-white/70">WINS</div>

        <div className="mx-auto mt-8 grid max-w-lg grid-cols-2 gap-2 sm:grid-cols-3">
          {stats.map((s) => (
            <div key={s.label} className="rounded-md border border-white/10 bg-white/[0.03] p-3">
              <div className="text-[10px] tracking-[0.25em] text-muted-foreground">{s.label}</div>
              <div className="font-display text-xl">{s.value}</div>
            </div>
          ))}
        </div>

        <div className="mt-8 grid gap-2 sm:grid-cols-3">
          <button
            onClick={onRematch}
            className="rounded-md border border-[oklch(0.72_0.18_235)] bg-[oklch(0.72_0.18_235/0.2)] py-3 font-display text-sm tracking-[0.3em] hover:bg-[oklch(0.72_0.18_235/0.35)]"
          >
            REMATCH
          </button>
          <button
            disabled
            className="rounded-md border border-white/10 bg-white/[0.02] py-3 font-display text-sm tracking-[0.3em] text-muted-foreground opacity-60"
            title="Coming soon"
          >
            WATCH REPLAY
          </button>
          <button
            onClick={onMenu}
            className="rounded-md border border-white/10 bg-white/[0.02] py-3 font-display text-sm tracking-[0.3em] hover:border-white/30"
          >
            MAIN MENU
          </button>
        </div>
      </div>
    </div>
  );
}

function formatDur(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${m}:${String(rs).padStart(2, "0")}`;
}
