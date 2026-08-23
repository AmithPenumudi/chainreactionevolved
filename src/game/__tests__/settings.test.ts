import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, speedFactor } from "../settings";

describe("speedFactor", () => {
  it("returns 1 for normal speed with motion enabled", () => {
    expect(speedFactor({ ...DEFAULT_SETTINGS, chainSpeed: "normal", reducedMotion: false })).toBe(
      1,
    );
  });

  it("slows down for 'slow' and speeds up for 'fast'", () => {
    expect(speedFactor({ ...DEFAULT_SETTINGS, chainSpeed: "slow" })).toBe(1.5);
    expect(speedFactor({ ...DEFAULT_SETTINGS, chainSpeed: "fast" })).toBe(0.6);
  });

  it("reduced motion overrides chain speed", () => {
    expect(speedFactor({ ...DEFAULT_SETTINGS, chainSpeed: "slow", reducedMotion: true })).toBe(
      0.45,
    );
  });
});

describe("loadSettings / saveSettings round trip", () => {
  it("returns defaults with nothing stored", () => {
    window.localStorage.clear();
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("persists and reloads settings, filling in any missing fields with defaults", () => {
    saveSettings({ ...DEFAULT_SETTINGS, chainSpeed: "fast", sfxVolume: 10 });
    const reloaded = loadSettings();
    expect(reloaded.chainSpeed).toBe("fast");
    expect(reloaded.sfxVolume).toBe(10);
  });

  it("falls back to defaults on corrupted storage", () => {
    window.localStorage.setItem("cr-settings-v1", "not json");
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});
