import { createContext, useContext } from "react";

export type ChainSpeed = "slow" | "normal" | "fast";

export interface GameSettings {
  chainSpeed: ChainSpeed;
  turnConfirmation: boolean;
  showCriticalCells: boolean;
  masterSound: boolean;
  soundEffects: boolean;
  music: boolean;
  sfxVolume: number; // 0..100
  musicVolume: number; // 0..100
  orbMotion: boolean;
  reducedMotion: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = {
  chainSpeed: "normal",
  turnConfirmation: false,
  showCriticalCells: true,
  masterSound: true,
  soundEffects: true,
  music: false,
  sfxVolume: 70,
  musicVolume: 40,
  orbMotion: true,
  reducedMotion: false,
};

const STORAGE_KEY = "cr-settings-v1";

export function loadSettings(): GameSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<GameSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: GameSettings) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore quota / private mode errors */
  }
}

/** Animation duration multiplier — purely visual, never affects game logic. */
export function speedFactor(s: GameSettings): number {
  if (s.reducedMotion) return 0.45;
  if (s.chainSpeed === "slow") return 1.5;
  if (s.chainSpeed === "fast") return 0.6;
  return 1;
}

export interface SettingsContextValue {
  settings: GameSettings;
  update: <K extends keyof GameSettings>(key: K, value: GameSettings[K]) => void;
  reset: () => void;
}

export const SettingsContext = createContext<SettingsContextValue>({
  settings: DEFAULT_SETTINGS,
  update: () => {},
  reset: () => {},
});

export function useSettings() {
  return useContext(SettingsContext);
}
