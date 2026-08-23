import { Cell } from "@/game/engine";
import { Orb } from "./Orb";
import { colorFor } from "@/game/colors";

interface Props {
  cell: Cell;
  row: number;
  col: number;
  rows: number;
  cols: number;
  cellSize: number;
  /** Effective critical mass for this cell (wall/fortify/reactor aware). */
  criticalMass: number;
  playerColorIndex: (pid: number) => number;
  onClick?: () => void;
  clickable?: boolean;
  exploding?: boolean;
  /** Highlight ring for ability targeting. */
  highlight?: "target" | "selected" | null;
  /** Continuous idle rotation of orb clusters (Settings → Visuals). */
  orbMotion?: boolean;
  /** Reduce motion: slower/subtler idle rotation and shorter transitions. */
  reducedMotion?: boolean;
  /** Subtle marker on cells one orb away from exploding. */
  showCritical?: boolean;
}

export function CellView({
  cell,
  row,
  col,
  rows,
  cols,
  cellSize,
  criticalMass: cm,
  playerColorIndex,
  onClick,
  clickable,
  exploding,
  highlight,
  orbMotion = true,
  reducedMotion = false,
  showCritical = true,
}: Props) {
  const orbsForVisual = Math.min(cell.orbs, cm - 1 > 0 ? cm - 1 : cell.orbs);
  const instability = cell.orbs === 0 ? 0 : cell.orbs >= cm - 1 ? 3 : cell.orbs === cm - 2 ? 2 : 1;

  const color = cell.owner !== null ? colorFor(playerColorIndex(cell.owner)) : "transparent";

  const orbSize = Math.max(12, Math.round(cellSize * 0.42));
  const positions = clusterPositions(orbsForVisual, orbSize);

  const spinEnabled = orbMotion && instability > 0;
  const baseSpin = instability >= 3 ? 3.2 : instability === 2 ? 5.5 : 9;
  const spinDuration = `${reducedMotion ? baseSpin * 2.5 : baseSpin}s`;

  const isWall = cell.tile === "wall";

  const isCritical = showCritical && cell.orbs > 0 && cell.orbs >= cm - 1;

  const bg = isWall ? "oklch(0.32 0.008 260)" : "oklch(0.18 0.008 260)";

  const ringStyle =
    highlight === "target"
      ? "0 0 0 2px oklch(0.72 0.18 235 / 0.7) inset"
      : highlight === "selected"
        ? "0 0 0 2px oklch(0.78 0.22 60 / 0.85) inset"
        : isCritical
          ? "0 0 0 1px oklch(0.85 0.02 260 / 0.28) inset"
          : undefined;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!clickable}
      className={`relative flex items-center justify-center rounded-[2px] ${clickable ? "cursor-pointer" : "cursor-default"}`}
      style={{
        width: cellSize,
        height: cellSize,
        background: bg,
        boxShadow: ringStyle,
      }}
      aria-label={`cell ${row},${col}${cell.tile ? ` ${cell.tile}` : ""}`}
    >
      {/* Tile glyphs (behind orbs) */}
      <TileGlyph tile={cell.tile} portalPairId={cell.portalPairId} size={cellSize} />

      {/* Shield ring (subtle, no glow) */}
      {cell.shielded && (
        <span
          className="pointer-events-none absolute rounded-full"
          style={{
            inset: Math.max(2, Math.round(cellSize * 0.08)),
            border: "1.5px solid oklch(0.85 0.02 240 / 0.55)",
          }}
        />
      )}
      {/* Fortify corner ticks */}
      {cell.fortified && <FortifyCorners size={cellSize} />}
      {/* EMP overlay */}
      {cell.empLockedFor !== undefined && (
        <span
          className="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] font-display tracking-widest text-white/40"
          style={{ letterSpacing: "0.15em" }}
        >
          EMP
        </span>
      )}

      {/* Orb cluster (rotates as one unit) */}
      <span
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
        style={{
          animation: spinEnabled ? `cluster-spin ${spinDuration} linear infinite` : undefined,
          transformOrigin: "50% 50%",
          opacity: exploding ? 0 : 1,
          transform: exploding ? "scale(0.65)" : undefined,
          transition: reducedMotion
            ? "opacity 70ms ease, transform 80ms ease"
            : "opacity 120ms ease, transform 160ms ease",

          willChange: "transform",
          backfaceVisibility: "hidden",
        }}
      >
        {[0, 1, 2, 3].map((i) => {
          const active = i < positions.length;
          const p = active ? positions[i] : { x: 0, y: 0 };
          return (
            <span
              key={i}
              className="absolute"
              style={{
                width: orbSize,
                height: orbSize,
                transform: `translate3d(${p.x}px, ${p.y}px, 0) scale(${active ? 1 : 0})`,
                opacity: active ? 1 : 0,
                willChange: "transform",
                backfaceVisibility: "hidden",
              }}
            >
              {active && <Orb color={color} size={orbSize} />}
            </span>
          );
        })}
      </span>
    </button>
  );
}

function FortifyCorners({ size }: { size: number }) {
  const t = Math.max(4, Math.round(size * 0.14));
  const w = 1.5;
  const c = "oklch(0.85 0.04 60 / 0.55)";
  const style = { position: "absolute" as const };
  return (
    <>
      <span style={{ ...style, top: 2, left: 2, width: t, height: w, background: c }} />
      <span style={{ ...style, top: 2, left: 2, width: w, height: t, background: c }} />
      <span style={{ ...style, top: 2, right: 2, width: t, height: w, background: c }} />
      <span style={{ ...style, top: 2, right: 2, width: w, height: t, background: c }} />
      <span style={{ ...style, bottom: 2, left: 2, width: t, height: w, background: c }} />
      <span style={{ ...style, bottom: 2, left: 2, width: w, height: t, background: c }} />
      <span style={{ ...style, bottom: 2, right: 2, width: t, height: w, background: c }} />
      <span style={{ ...style, bottom: 2, right: 2, width: w, height: t, background: c }} />
    </>
  );
}

function TileGlyph({
  tile,
  portalPairId,
  size,
}: {
  tile: Cell["tile"];
  portalPairId?: number;
  size: number;
}) {
  if (!tile || tile === "normal") return null;
  if (tile === "wall") {
    // solid block already shown via bg; add a subtle diagonal texture
    return (
      <span
        className="pointer-events-none absolute inset-1 rounded-[2px]"
        style={{
          background:
            "repeating-linear-gradient(45deg, oklch(0.42 0.008 260) 0 4px, oklch(0.34 0.008 260) 4px 8px)",
          opacity: 0.7,
        }}
      />
    );
  }
  if (tile === "dead") {
    return (
      <span
        className="pointer-events-none absolute inset-1 rounded-[2px]"
        style={{
          background:
            "repeating-linear-gradient(-45deg, oklch(0.20 0.008 260) 0 3px, transparent 3px 7px)",
          opacity: 0.5,
        }}
      />
    );
  }
  const iconSize = Math.max(10, Math.round(size * 0.34));
  const color = "oklch(0.7 0.02 240 / 0.55)";
  if (tile === "power") {
    return (
      <svg
        className="pointer-events-none absolute"
        width={iconSize}
        height={iconSize}
        viewBox="0 0 24 24"
        style={{ opacity: 0.6 }}
      >
        <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" fill={color} />
      </svg>
    );
  }
  if (tile === "portal") {
    const hue = portalPairId !== undefined ? (portalPairId * 60) % 360 : 200;
    return (
      <>
        <span
          className="pointer-events-none absolute rounded-full"
          style={{
            width: iconSize + 6,
            height: iconSize + 6,
            border: `1.5px solid oklch(0.7 0.14 ${hue} / 0.75)`,
          }}
        />
        <span
          className="pointer-events-none absolute rounded-full"
          style={{
            width: iconSize - 4,
            height: iconSize - 4,
            border: `1px solid oklch(0.75 0.14 ${hue} / 0.55)`,
          }}
        />
      </>
    );
  }
  if (tile === "amplifier") {
    return (
      <span
        className="pointer-events-none absolute font-display tracking-tight"
        style={{
          fontSize: Math.round(size * 0.32),
          color: "oklch(0.78 0.14 30 / 0.7)",
          letterSpacing: "-0.05em",
        }}
      >
        ×2
      </span>
    );
  }
  if (tile === "reactor") {
    return (
      <span
        className="pointer-events-none absolute rounded-full"
        style={{
          width: iconSize,
          height: iconSize,
          background: "oklch(0.32 0.05 200 / 0.55)",
          border: "1px solid oklch(0.6 0.12 200 / 0.55)",
        }}
      />
    );
  }
  return null;
}

function clusterPositions(count: number, s: number): { x: number; y: number }[] {
  if (count <= 0) return [];
  if (count === 1) return [{ x: 0, y: 0 }];
  if (count === 2)
    return [
      { x: -s / 2, y: 0 },
      { x: s / 2, y: 0 },
    ];
  if (count === 3) {
    const R = s / Math.sqrt(3);
    return [
      { x: 0, y: -R },
      { x: -s / 2, y: R / 2 },
      { x: s / 2, y: R / 2 },
    ];
  }
  return [
    { x: -s / 2, y: -s / 2 },
    { x: s / 2, y: -s / 2 },
    { x: -s / 2, y: s / 2 },
    { x: s / 2, y: s / 2 },
  ];
}
