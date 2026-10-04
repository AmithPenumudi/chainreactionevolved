import { useEffect, useState } from "react";

interface Props {
  onQuickPlay: () => void;
  onSettings: () => void;
  onProfile: () => void;
  onHowToPlay: () => void;
  onChallenges: () => void;
  onPuzzles: () => void;
}

export function HomeScreen({
  onQuickPlay,
  onSettings,
  onProfile,
  onHowToPlay,
  onChallenges,
  onPuzzles,
}: Props) {
  // Generated after mount only — random values would mismatch during hydration.
  const [particles, setParticles] = useState<
    {
      id: number;
      left: number;
      top: number;
      dx: number;
      dy: number;
      delay: number;
      dur: number;
      size: number;
      hue: string;
    }[]
  >([]);

  useEffect(() => {
    setParticles(
      Array.from({ length: 40 }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        top: Math.random() * 100,
        dx: (Math.random() - 0.5) * 200,
        dy: (Math.random() - 0.5) * 200,
        delay: Math.random() * 8,
        dur: 8 + Math.random() * 10,
        size: 2 + Math.random() * 3,
        hue: Math.random() > 0.5 ? "var(--p1)" : "var(--p4)",
      })),
    );
  }, []);

  const menu = [
    { label: "QUICK PLAY", enabled: true, onClick: onQuickPlay },
    { label: "RANKED", enabled: false },
    { label: "PLAY WITH FRIENDS", enabled: false },
    { label: "CHALLENGES", enabled: true, onClick: onChallenges },
    { label: "PUZZLES", enabled: true, onClick: onPuzzles },
    { label: "HOW TO PLAY", enabled: true, onClick: onHowToPlay },
    { label: "PROFILE", enabled: true, onClick: onProfile },
    { label: "SETTINGS", enabled: true, onClick: onSettings },
  ];

  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* Particle field */}
      <div className="pointer-events-none absolute inset-0">
        {particles.map((p) => (
          <span
            key={p.id}
            className="absolute rounded-full"
            style={{
              left: `${p.left}%`,
              top: `${p.top}%`,
              width: p.size,
              height: p.size,
              background: p.hue,
              boxShadow: `0 0 8px ${p.hue}`,
              // @ts-expect-error css var
              "--dx": `${p.dx}px`,
              "--dy": `${p.dy}px`,
              animation: `particle-drift ${p.dur}s ease-in-out ${p.delay}s infinite`,
              opacity: 0,
            }}
          />
        ))}
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col items-center justify-center px-6 py-16">
        <div className="text-center">
          <h1 className="font-display text-6xl font-black tracking-tight sm:text-8xl">
            <span className="block bg-gradient-to-b from-white to-[oklch(0.75_0.18_235)] bg-clip-text text-transparent">
              CHAIN
            </span>
            <span className="block bg-gradient-to-b from-white to-[oklch(0.75_0.18_235)] bg-clip-text text-transparent -mt-2 sm:-mt-4">
              REACTION
            </span>
          </h1>
          <div className="mt-3 inline-block rounded-full border border-[oklch(0.72_0.18_235/0.4)] bg-[oklch(0.72_0.18_235/0.1)] px-4 py-1 font-display text-xs tracking-[0.4em] text-[oklch(0.85_0.15_235)] sm:text-sm">
            EVOLVED
          </div>
          <p className="mt-6 max-w-md text-sm text-muted-foreground sm:text-base">
            A modern take on the classic grid-based strategy game. Detonate energy cells, trigger
            cascading chains, and eliminate your opponents.
          </p>
        </div>

        <div className="mt-12 grid w-full max-w-md gap-3">
          {menu.map((item) => (
            <button
              key={item.label}
              onClick={item.onClick}
              disabled={!item.enabled}
              className={`group relative overflow-hidden rounded-lg border px-6 py-3 text-left font-display text-sm tracking-widest transition-all
                ${
                  item.enabled
                    ? "border-[oklch(0.72_0.18_235/0.5)] bg-[oklch(0.72_0.18_235/0.08)] text-white hover:bg-[oklch(0.72_0.18_235/0.18)] hover:border-[oklch(0.72_0.18_235)] hover:translate-x-1"
                    : "cursor-not-allowed border-white/5 bg-white/[0.02] text-muted-foreground opacity-60"
                }`}
            >
              <span className="flex items-center justify-between">
                <span>{item.label}</span>
                {!item.enabled && (
                  <span className="rounded-sm bg-white/5 px-2 py-0.5 text-[10px] tracking-normal">
                    COMING SOON
                  </span>
                )}
              </span>
              {item.enabled && (
                <span className="absolute inset-y-0 left-0 w-1 bg-[oklch(0.72_0.18_235)] shadow-[0_0_12px_var(--p1)]" />
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
