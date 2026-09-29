import type { Cell } from "./engine";
import { PLAYER_COLOR_NAMES } from "./colors";

const TILE_LABEL: Record<string, string> = {
  power: "power tile",
  portal: "portal",
  wall: "wall",
  amplifier: "amplifier",
  dead: "dead zone",
  reactor: "reactor",
};

/**
 * Screen-reader description of a board cell: position, tile, owner, orbs vs. critical mass and
 * any active modifiers. Rows and columns are 1-based for humans.
 */
export function cellLabel(
  cell: Cell,
  row: number,
  col: number,
  criticalMass: number,
  ownerColorIndex?: number,
): string {
  const parts = [`Row ${row + 1}, column ${col + 1}`];
  if (cell.tile && TILE_LABEL[cell.tile]) parts.push(TILE_LABEL[cell.tile]);
  if (cell.tile === "wall" || cell.tile === "dead") return parts.join(", ");
  if (cell.owner === null || cell.orbs === 0) {
    parts.push("empty");
  } else {
    const who =
      ownerColorIndex !== undefined
        ? PLAYER_COLOR_NAMES[ownerColorIndex % PLAYER_COLOR_NAMES.length]
        : `player ${cell.owner + 1}`;
    parts.push(`${cell.orbs} of ${criticalMass} orbs, ${who}`);
    if (cell.orbs >= criticalMass - 1) parts.push("about to explode");
  }
  if (cell.shielded) parts.push("shielded");
  if (cell.fortified) parts.push("fortified");
  if (cell.empLockedFor !== undefined) parts.push("locked by EMP");
  return parts.join(", ");
}
