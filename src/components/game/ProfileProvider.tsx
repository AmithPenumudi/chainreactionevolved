import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { SYNC_APPLIED_EVENT } from "@/game/sync/sync";
import {
  DEFAULT_PROFILE,
  MatchOutcome,
  PlayerProfile,
  ProfileContext,
  applyMatch,
  loadProfile,
  saveProfile,
} from "@/game/profile";

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<PlayerProfile>(DEFAULT_PROFILE);

  // Load after mount so SSR markup and first client render match, and again whenever a cloud
  // sync has merged a newer copy into storage.
  useEffect(() => {
    const load = () => setProfile(loadProfile());
    load();
    window.addEventListener(SYNC_APPLIED_EVENT, load);
    return () => window.removeEventListener(SYNC_APPLIED_EVENT, load);
  }, []);

  const commit = useCallback((fn: (p: PlayerProfile) => PlayerProfile) => {
    setProfile((p) => {
      const next = fn(p);
      saveProfile(next);
      return next;
    });
  }, []);

  const setUsername = useCallback(
    (name: string) => commit((p) => ({ ...p, username: name.slice(0, 16), updatedAt: Date.now() })),
    [commit],
  );
  const setAvatar = useCallback(
    (id: string) => commit((p) => ({ ...p, avatarId: id, updatedAt: Date.now() })),
    [commit],
  );
  const recordMatch = useCallback((o: MatchOutcome) => commit((p) => applyMatch(p, o)), [commit]);
  const addXp = useCallback(
    (amount: number) => commit((p) => (amount > 0 ? { ...p, xp: p.xp + Math.floor(amount) } : p)),
    [commit],
  );
  const resetProfile = useCallback(() => {
    setProfile(DEFAULT_PROFILE);
    saveProfile(DEFAULT_PROFILE);
  }, []);

  const value = useMemo(
    () => ({ profile, setUsername, setAvatar, recordMatch, addXp, resetProfile }),
    [profile, setUsername, setAvatar, recordMatch, addXp, resetProfile],
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}
