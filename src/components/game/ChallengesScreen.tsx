import { useEffect, useState } from "react";
import {
  ChallengeCategory, ChallengeDef, MASTERY_GROUPS, activeDefs, formatCountdown, isComplete,
  msUntilDailyReset, msUntilWeeklyReset, progressOf, useChallenges,
} from "@/game/challenges";

import { DIFFICULTY_LABEL, PUZZLES } from "@/game/puzzles";

interface Props {
  onBack: () => void;
  onPuzzles?: () => void;
}

const TABS: { value: ChallengeCategory; label: string }[] = [
  { value: "daily", label: "DAILY" },
  { value: "weekly", label: "WEEKLY" },
  { value: "mastery", label: "MASTERY" },
];

export function ChallengesScreen({ onBack, onPuzzles }: Props) {

  const { state, claim } = useChallenges();
  const [tab, setTab] = useState<ChallengeCategory>("daily");
  const [now, setNow] = useState<number | null>(null);

  // Client-only clock — avoids an SSR/hydration mismatch on the countdown.
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const defs = activeDefs(state, tab);

  const resetLabel =
    now === null
      ? null
      : tab === "daily"
        ? `Daily reset: ${formatCountdown(msUntilDailyReset(now))}`
        : tab === "weekly"
          ? `Weekly reset: ${formatCountdown(msUntilWeeklyReset(now))}`
          : "Never expires";

  return (
    <div className="min-h-screen">
      <div className="mx-auto w-full max-w-2xl px-5 py-10 sm:py-14">
        <div className="flex items-center justify-between">
          <button
            onClick={onBack}
            className="text-[10px] tracking-[0.3em] text-muted-foreground transition hover:text-foreground"
          >
            ← MENU
          </button>
          <h1 className="font-display text-2xl font-black tracking-tight sm:text-3xl">CHALLENGES</h1>
        </div>

        <div className="mt-8 flex gap-1 rounded-md border border-white/10 bg-white/[0.02] p-1">
          {TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={`flex-1 rounded-sm px-2 py-1.5 text-[10px] tracking-[0.2em] transition ${
                tab === t.value ? "bg-white/10 text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="mt-3 h-4 text-[10px] tracking-[0.25em] text-muted-foreground">
          {resetLabel}
        </div>

        {tab === "mastery" ? (
          <div className="mt-3 grid gap-6">
            {MASTERY_GROUPS.map((group) => {
              const rows = defs.filter((d) => d.group === group);
              if (rows.length === 0) return null;
              const done = rows.filter((d) => isComplete(state, d)).length;
              return (
                <section key={group}>
                  <div className="mb-2 flex items-baseline justify-between">
                    <h2 className="text-[10px] tracking-[0.35em] text-muted-foreground">{group}</h2>
                    <span className="text-[9px] tracking-[0.2em] text-muted-foreground">
                      {done} / {rows.length}
                    </span>
                  </div>
                  <div className="grid gap-2">
                    {rows.map((def) => (
                      <ChallengeRow
                        key={def.id}
                        def={def}
                        progress={progressOf(state, def)}
                        complete={isComplete(state, def)}
                        claimed={Boolean(state.claimed[def.id])}
                        onClaim={() => claim(def.id)}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        ) : (
          <div className="mt-3 grid gap-2">
            {defs.map((def) => (
              <ChallengeRow
                key={def.id}
                def={def}
                progress={progressOf(state, def)}
                complete={isComplete(state, def)}
                claimed={Boolean(state.claimed[def.id])}
                onClaim={() => claim(def.id)}
              />
            ))}
          </div>
        )}


        <section className="mt-10">
          <h2 className="mb-3 text-[10px] tracking-[0.35em] text-muted-foreground">
            PUZZLE CHALLENGES
          </h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {PUZZLES.slice(0, 4).map((p) => (
              <div
                key={p.id}
                className="rounded-md border border-white/10 bg-white/[0.02] p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display text-xs tracking-[0.2em] text-foreground">
                    {p.name}
                  </span>
                  <span className="text-[9px] tracking-[0.2em] text-muted-foreground">
                    {DIFFICULTY_LABEL[p.difficulty]}
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{p.brief}</div>
              </div>
            ))}
          </div>
          {onPuzzles && (
            <button
              onClick={onPuzzles}
              className="mt-3 rounded-md border border-white/20 px-5 py-2 font-display text-[10px] tracking-[0.3em] transition hover:bg-white/10"
            >
              OPEN PUZZLES
            </button>
          )}
        </section>


        <div className="mt-10 text-center text-[10px] tracking-[0.3em] text-muted-foreground">
          CHALLENGE REWARDS ARE COSMETIC · NO GAMEPLAY ADVANTAGE
        </div>
      </div>
    </div>
  );
}

function ChallengeRow({
  def, progress, complete, claimed, onClaim,
}: {
  def: ChallengeDef;
  progress: number;
  complete: boolean;
  claimed: boolean;
  onClaim: () => void;
}) {
  const pct = Math.min(100, (progress / def.goal) * 100);
  return (
    <div
      className={`rounded-md border p-3 transition-colors ${
        complete && !claimed
          ? "border-white/30 bg-white/[0.06]"
          : "border-white/10 bg-white/[0.02]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`font-display text-xs tracking-[0.2em] ${claimed ? "text-muted-foreground" : ""}`}>
              {def.name}
            </span>
            {def.tag && (
              <span className="rounded-sm border border-white/10 px-1.5 py-0.5 text-[9px] tracking-[0.18em] text-muted-foreground">
                {def.tag}
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{def.desc}</div>
          {def.badge && (
            <div className="mt-1.5 text-[9px] tracking-[0.22em] text-muted-foreground">
              BADGE · {def.badge}
            </div>
          )}
        </div>
        <span className="shrink-0 text-[10px] tracking-[0.2em] text-muted-foreground">
          {def.xp} XP
        </span>
      </div>

      {claimed ? (
        <div className="mt-3 text-[10px] tracking-[0.25em] text-muted-foreground">
          {def.badge ? `CLAIMED · ${def.badge} BADGE EARNED` : "CLAIMED"}
        </div>

      ) : complete ? (
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-[10px] tracking-[0.25em]">CHALLENGE COMPLETE</span>
          <button
            onClick={onClaim}
            className="rounded-md border border-white/25 bg-white/[0.06] px-3 py-1.5 font-display text-[10px] tracking-[0.25em] transition hover:border-white/50 hover:bg-white/[0.12]"
          >
            CLAIM +{def.xp} XP
          </button>
        </div>
      ) : (
        <>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-white/40 transition-[width] duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-1.5 text-[10px] tracking-[0.2em] text-muted-foreground">
            {progress.toLocaleString()} / {def.goal.toLocaleString()}
          </div>
        </>
      )}
    </div>
  );
}
