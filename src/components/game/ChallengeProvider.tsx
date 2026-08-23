import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  ChallengeContext,
  ChallengeState,
  applyOutcome,
  challengeById,
  freshState,
  isComplete,
  loadChallenges,
  rollPeriods,
  saveChallenges,
} from "@/game/challenges";
import type { MatchOutcome } from "@/game/profile";
import { useProfile } from "@/game/profile";

export function ChallengeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ChallengeState>(() => freshState(0));
  const { addXp } = useProfile();

  // Load after mount so SSR markup and first client render match.
  useEffect(() => {
    setState(loadChallenges());
  }, []);

  const commit = useCallback((fn: (s: ChallengeState) => ChallengeState) => {
    setState((s) => {
      const next = fn(s);
      saveChallenges(next);
      return next;
    });
  }, []);

  const recordOutcome = useCallback(
    (o: MatchOutcome) => commit((s) => applyOutcome(s, o)),
    [commit],
  );

  const claim = useCallback(
    (id: string) => {
      const def = challengeById(id);
      if (!def) return 0;
      let granted = 0;
      commit((s) => {
        const rolled = rollPeriods(s);
        if (rolled.claimed[id] || !isComplete(rolled, def)) return rolled;
        granted = def.xp;
        return {
          ...rolled,
          claimed: { ...rolled.claimed, [id]: true },
          xpClaimed: rolled.xpClaimed + def.xp,
        };
      });
      if (granted > 0) addXp(granted);
      return granted;
    },
    [commit, addXp],
  );

  const resetChallenges = useCallback(() => {
    const fresh = freshState();
    setState(fresh);
    saveChallenges(fresh);
  }, []);

  const value = useMemo(
    () => ({ state, recordOutcome, claim, resetChallenges }),
    [state, recordOutcome, claim, resetChallenges],
  );

  return <ChallengeContext.Provider value={value}>{children}</ChallengeContext.Provider>;
}
