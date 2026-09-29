import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { haptic, resetHapticThrottle } from "../haptics";
import { DEFAULT_SETTINGS, loadSettings, sanitizeSettings, type GameSettings } from "../settings";

const on: GameSettings = { ...DEFAULT_SETTINGS, haptics: true, reducedMotion: false };

let vibrate: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetHapticThrottle();
  vibrate = vi.fn(() => true);
  Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
  window.localStorage.clear();
});

afterEach(() => {
  // remove the stub so other suites see a pristine navigator
  delete (navigator as unknown as { vibrate?: unknown }).vibrate;
});

describe("haptic()", () => {
  it("vibrates with a distinct pattern per event", () => {
    haptic(on, "place");
    haptic(on, "win");
    haptic(on, "lose");
    const calls = vibrate.mock.calls.map((c) => JSON.stringify(c[0]));
    expect(new Set(calls).size).toBe(3);
    expect(calls).toHaveLength(3);
  });

  it("is silent when the setting is off", () => {
    expect(haptic({ ...on, haptics: false }, "place")).toBe(false);
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("is silent under Reduced Motion, whatever the haptics flag says", () => {
    expect(haptic({ ...on, reducedMotion: true }, "explode")).toBe(false);
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("does nothing (and does not throw) when the platform has no Vibration API", () => {
    delete (navigator as unknown as { vibrate?: unknown }).vibrate;
    expect(() => haptic(on, "place")).not.toThrow();
    expect(haptic(on, "place")).toBe(false);
  });

  it("swallows errors thrown by the platform", () => {
    vibrate.mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => haptic(on, "win")).not.toThrow();
    expect(haptic(on, "win")).toBe(false);
  });

  it("throttles rapid explosions into one rumble but never throttles other events", () => {
    const t = 1_000_000;
    expect(haptic(on, "explode", t)).toBe(true);
    expect(haptic(on, "explode", t + 10)).toBe(false);
    expect(haptic(on, "explode", t + 50)).toBe(false);
    expect(haptic(on, "explode", t + 120)).toBe(true);
    expect(haptic(on, "place", t + 121)).toBe(true);
    expect(haptic(on, "place", t + 122)).toBe(true);
    expect(vibrate).toHaveBeenCalledTimes(4);
  });

  it("uses short pulses for moves and a long pattern for a win", () => {
    haptic(on, "place");
    haptic(on, "win");
    expect(vibrate.mock.calls[0][0]).toBeLessThanOrEqual(30);
    expect(Array.isArray(vibrate.mock.calls[1][0])).toBe(true);
  });
});

describe("haptics setting persistence", () => {
  it("defaults to on", () => {
    expect(DEFAULT_SETTINGS.haptics).toBe(true);
    expect(loadSettings().haptics).toBe(true);
  });

  it("round-trips false and ignores wrong types", () => {
    window.localStorage.setItem("cr-settings-v1", JSON.stringify({ haptics: false }));
    expect(loadSettings().haptics).toBe(false);
    expect(sanitizeSettings({ haptics: "yes" }).haptics).toBe(true);
    expect(sanitizeSettings({ haptics: 0 }).haptics).toBe(true);
  });

  it("an older saved settings blob without the flag gets the default", () => {
    window.localStorage.setItem("cr-settings-v1", JSON.stringify({ music: true }));
    expect(loadSettings().haptics).toBe(true);
  });
});
