import { useMemo } from "react";
import {
  ChaosConfig,
  buildChaosBoard,
  canIncrement,
  chaosLimits,
  specialCellCount,
} from "@/game/chaos-grid";

interface Props {
  rows: number;
  cols: number;
  config: ChaosConfig;
  seed: number;
  showPreview: boolean;
  onChange: (cfg: ChaosConfig) => void;
  onRandomize: () => void;
  onReset: () => void;
  onRegenerate: () => void;
  onTogglePreview: () => void;
}

const ROWS: { key: keyof ChaosConfig; label: string }[] = [
  { key: "portalPairs", label: "Portal Pairs" },
  { key: "amplifiers", label: "Amplifiers" },
  { key: "powerTiles", label: "Power Tiles" },
  { key: "reactors", label: "Reactors" },
  { key: "walls", label: "Walls" },
  { key: "deadZones", label: "Dead Zones" },
];

const TILE_STYLE: Record<string, { bg: string; glyph: string }> = {
  wall: { bg: "oklch(0.45 0.01 260)", glyph: "" },
  amplifier: { bg: "oklch(0.72 0.18 235 / 0.7)", glyph: "▲" },
  power: { bg: "oklch(0.8 0.16 95 / 0.7)", glyph: "⚡" },
  portal: { bg: "oklch(0.65 0.2 320 / 0.75)", glyph: "" },
  reactor: { bg: "oklch(0.55 0.12 200 / 0.75)", glyph: "◉" },
  dead: { bg: "oklch(0.12 0.01 260)", glyph: "✕" },
};

export function ChaosGridConfig(props: Props) {
  const { rows, cols, config, seed, showPreview } = props;
  const limits = chaosLimits(rows, cols);
  const used = specialCellCount(config);

  const preview = useMemo(
    () => (showPreview ? buildChaosBoard(rows, cols, config, seed) : null),
    [showPreview, rows, cols, config, seed],
  );

  const atMax = ROWS.every((r) => !canIncrement(config, r.key, rows, cols));

  const step = (key: keyof ChaosConfig, delta: number) => {
    if (delta > 0 && !canIncrement(config, key, rows, cols)) return;
    props.onChange({ ...config, [key]: Math.max(0, config[key] + delta) });
  };

  return (
    <section className="mt-6 rounded-md border border-white/10 bg-white/[0.03] p-4">
      <div className="font-display text-sm tracking-[0.25em]">CHAOS GRID</div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">Build your battlefield</p>

      <div className="mt-3 text-[10px] tracking-[0.25em] text-muted-foreground">
        BOARD · {rows} × {cols}
      </div>

      <div className="mt-3 space-y-2">
        {ROWS.map((r) => {
          const plusDisabled = !canIncrement(config, r.key, rows, cols);
          return (
            <div
              key={r.key}
              className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-black/20 px-3 py-2"
            >
              <div className="min-w-0">
                <div className="text-xs">{r.label}</div>
                <div className="text-[10px] text-muted-foreground">max {limits[r.key]}</div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => step(r.key, -1)}
                  disabled={config[r.key] <= 0}
                  aria-label={`Decrease ${r.label}`}
                  className="h-9 w-9 rounded-md border border-white/10 text-base transition hover:border-white/40 disabled:opacity-25"
                >
                  −
                </button>
                <div className="w-8 text-center font-display text-base tabular-nums">{config[r.key]}</div>
                <button
                  onClick={() => step(r.key, 1)}
                  disabled={plusDisabled}
                  aria-label={`Increase ${r.label}`}
                  className="h-9 w-9 rounded-md border border-white/10 text-base transition hover:border-white/40 disabled:opacity-25"
                >
                  +
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3 text-[11px] text-muted-foreground">
        Special Cells <span className="text-white">{used}</span> / {limits.maxSpecialCells} maximum
      </div>
      {atMax && (
        <div className="mt-1 text-[11px] text-[oklch(0.75_0.17_60)]">Maximum special tile limit reached.</div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={props.onRandomize}
          className="rounded-md border border-white/15 px-3 py-2 text-[10px] tracking-[0.25em] transition hover:border-white/40"
        >
          RANDOMIZE
        </button>
        <button
          onClick={props.onReset}
          className="rounded-md border border-white/15 px-3 py-2 text-[10px] tracking-[0.25em] transition hover:border-white/40"
        >
          RESET
        </button>
        <button
          onClick={props.onTogglePreview}
          className="rounded-md border border-white/15 px-3 py-2 text-[10px] tracking-[0.25em] transition hover:border-white/40"
        >
          {showPreview ? "HIDE PREVIEW" : "GENERATE PREVIEW"}
        </button>
        {showPreview && (
          <button
            onClick={props.onRegenerate}
            className="rounded-md border border-[oklch(0.72_0.18_235)] px-3 py-2 text-[10px] tracking-[0.25em] transition hover:bg-[oklch(0.72_0.18_235/0.2)]"
          >
            REGENERATE
          </button>
        )}
      </div>

      {preview && (
        <div className="mt-3">
          <div
            className="grid gap-[2px] rounded-md bg-black/40 p-2"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
          >
            {preview.cells.map((cell, i) => {
              const style = TILE_STYLE[cell.tile ?? "normal"] ?? null;
              return (
                <div
                  key={i}
                  className="grid aspect-square place-items-center rounded-[2px] text-[7px] leading-none"
                  style={{ background: style ? style.bg : "oklch(0.22 0.008 260)" }}
                >
                  {cell.tile === "portal" ? cell.portalPairId : style?.glyph}
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-muted-foreground">
            <span>▲ Amplifier</span>
            <span>⚡ Power</span>
            <span>◉ Reactor</span>
            <span>1/2/3 Portal pair</span>
            <span>Grey Wall</span>
            <span>✕ Dead Zone</span>
          </div>
        </div>
      )}
    </section>
  );
}
