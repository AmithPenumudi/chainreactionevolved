import type { GameSettings } from "./settings";

export type HapticKind = "place" | "explode" | "win" | "lose";

const PATTERNS: Record<HapticKind, number | number[]> = {
  place: 10,
  explode: 22,
  win: [50, 70, 50, 70, 120],
  lose: [140, 60, 140],
};

/** Minimum gap between successive explosion pulses so long chains feel like one rumble. */
const EXPLODE_THROTTLE_MS = 90;
let lastExplode = -Infinity;

/**
 * Short vibration for game events. Silent when the setting is off, when the platform has no
 * Vibration API, or when the user asked for reduced motion. Never throws.
 */
export function haptic(settings: GameSettings, kind: HapticKind, now = Date.now()): boolean {
  if (!settings.haptics || settings.reducedMotion) return false;
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return false;
  if (kind === "explode") {
    if (now - lastExplode < EXPLODE_THROTTLE_MS) return false;
    lastExplode = now;
  }
  try {
    return navigator.vibrate(PATTERNS[kind]);
  } catch {
    return false;
  }
}

/** Test hook: forget the explosion throttle. */
export function resetHapticThrottle() {
  lastExplode = -Infinity;
}
