import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_SETTINGS,
  GameSettings,
  SettingsContext,
  loadSettings,
  saveSettings,
} from "@/game/settings";

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<GameSettings>(DEFAULT_SETTINGS);

  // Load after mount so SSR markup and first client render match.
  useEffect(() => {
    setSettings(loadSettings());
  }, []);

  const update = useCallback(<K extends keyof GameSettings>(key: K, value: GameSettings[K]) => {
    setSettings((s) => {
      const next = { ...s, [key]: value };
      saveSettings(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
    saveSettings(DEFAULT_SETTINGS);
  }, []);

  const value = useMemo(() => ({ settings, update, reset }), [settings, update, reset]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}
