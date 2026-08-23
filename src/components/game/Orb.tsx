import { CSSProperties } from "react";

interface OrbProps {
  color: string;
  size: number;
  style?: CSSProperties;
}

/**
 * High-quality spherical orb rendered as SVG for perfectly smooth, crisp,
 * resolution-independent edges. Subtle radial shading + soft highlight give
 * a premium 3D feel without any neon/glow.
 */
export function Orb({ color, size, style }: OrbProps) {
  // Unique-ish id per render so multiple orbs with different colors don't collide.
  const id = `orb-${color.replace(/[^a-z0-9]/gi, "")}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      style={{
        display: "block",
        overflow: "visible",
        shapeRendering: "geometricPrecision",
        ...style,
      }}
      aria-hidden="true"
    >
      <defs>
        {/* Body shading — soft, natural sphere. */}
        <radialGradient id={`${id}-body`} cx="35%" cy="32%" r="75%">
          <stop offset="0%"   stopColor={`oklch(from ${color} calc(l + 0.14) c h)`} />
          <stop offset="45%"  stopColor={color} />
          <stop offset="100%" stopColor={`oklch(from ${color} calc(l - 0.16) c h)`} />
        </radialGradient>
        {/* Very soft top highlight for depth. */}
        <radialGradient id={`${id}-hi`} cx="35%" cy="28%" r="30%">
          <stop offset="0%"   stopColor="oklch(1 0 0 / 0.55)" />
          <stop offset="60%"  stopColor="oklch(1 0 0 / 0.10)" />
          <stop offset="100%" stopColor="oklch(1 0 0 / 0)" />
        </radialGradient>
        {/* Subtle bottom terminator to sit the sphere in space. */}
        <radialGradient id={`${id}-shade`} cx="55%" cy="90%" r="55%">
          <stop offset="0%"   stopColor={`oklch(from ${color} calc(l - 0.22) c h / 0.55)`} />
          <stop offset="100%" stopColor={`oklch(from ${color} calc(l - 0.22) c h / 0)`} />
        </radialGradient>
      </defs>

      <circle cx="50" cy="50" r="49.5" fill={`url(#${id}-body)`} />
      <circle cx="50" cy="50" r="49.5" fill={`url(#${id}-shade)`} />
      <circle cx="50" cy="50" r="49.5" fill={`url(#${id}-hi)`} />
    </svg>
  );
}
