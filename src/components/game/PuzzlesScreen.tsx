import { useEffect, useState } from "react";
import {
  DIFFICULTY_LABEL, DIFFICULTY_ORDER, isUnlocked, loadPuzzleProgress, MEDAL_COLOR, MEDAL_LABEL,
  objectiveText, PUZZLES, type PuzzleDef, type PuzzleProgress,
} from "@/game/puzzles";

interface Props {
  onBack: () => void;
  onPlay: (puzzle: PuzzleDef) => void;
}

export function PuzzlesScreen({ onBack, onPlay }: Props) {
  const [progress, setProgress] = useState<PuzzleProgress>({});

  // Read after mount so SSR markup and first client render match.
  useEffect(() => {
    setProgress(loadPuzzleProgress());
  }, []);

  const solved = Object.keys(progress).length;

  return (
    <div className="min-h-screen px-5 py-8">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-center justify-between gap-3">
          <button
            onClick={onBack}
            className="rounded-sm border border-white/15 px-3 py-1.5 font-display text-[10px] tracking-[0.25em] text-muted-foreground transition hover:bg-white/5 hover:text-foreground"
          >
            ← BACK
          </button>
          <span className="text-[10px] tracking-[0.3em] text-muted-foreground">
            {solved}/{PUZZLES.length} SOLVED
          </span>
        </div>

        <h1 className="mt-6 font-display text-4xl font-black tracking-tight">PUZZLES</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Fixed positions, unlimited retries. Solve each one in as few moves as possible to earn
          Bronze, Silver or Gold.
        </p>

        {DIFFICULTY_ORDER.map((d) => {
          const list = PUZZLES.filter((p) => p.difficulty === d);
          if (!list.length) return null;
          return (
            <section key={d} className="mt-9">
              <h2 className="mb-3 text-[10px] tracking-[0.35em] text-muted-foreground">
                {DIFFICULTY_LABEL[d]}
              </h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {list.map((p) => {
                  const rec = progress[p.id];
                  const unlocked = isUnlocked(progress, p);
                  return (
                    <button
                      key={p.id}
                      onClick={() => unlocked && onPlay(p)}
                      disabled={!unlocked}
                      className={`rounded-md border p-4 text-left transition ${
                        unlocked
                          ? "border-white/12 bg-white/[0.03] hover:border-white/30 hover:bg-white/[0.07]"
                          : "cursor-not-allowed border-white/5 bg-white/[0.01] opacity-50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-display text-sm tracking-[0.18em]">{p.name}</span>
                        {rec ? (
                          <span
                            className="text-[9px] tracking-[0.2em]"
                            style={{ color: MEDAL_COLOR[rec.medal] }}
                          >
                            {MEDAL_LABEL[rec.medal]}
                          </span>
                        ) : (
                          <span className="text-[9px] tracking-[0.2em] text-muted-foreground">
                            {unlocked ? `${p.xp} XP` : "LOCKED"}
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5 text-xs text-muted-foreground">{p.brief}</div>
                      <div className="mt-2 flex flex-wrap gap-x-4 text-[9px] tracking-[0.2em] text-muted-foreground">
                        <span>{objectiveText(p).toUpperCase()}</span>
                        <span>GOLD ≤ {p.medals.gold}</span>
                        {rec && <span>BEST · {rec.bestMoves}</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}

        <div className="mt-10 text-center text-[10px] tracking-[0.3em] text-muted-foreground">
          SOLVE A PUZZLE TO UNLOCK THE NEXT ONE
        </div>
      </div>
    </div>
  );
}
