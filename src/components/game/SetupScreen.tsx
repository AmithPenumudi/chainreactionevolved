import { useState } from "react";
import {
  DEFAULT_RULES,
  GameMode,
  GameRules,
  MODE_CONFIGS,
  ModeKind,
  PlayerConfig,
} from "@/game/engine";
import { PLAYER_COLOR_NAMES, PLAYER_SYMBOLS, colorFor } from "@/game/colors";
import { ARENA_MAPS, ArenaMapId } from "@/game/arena-maps";
import {
  ChaosConfig,
  clampChaosConfig,
  defaultChaosConfig,
  randomChaosConfig,
  randomSeed,
} from "@/game/chaos-grid";
import { ChaosGridConfig } from "./ChaosGridConfig";

export interface MatchConfig {
  players: PlayerConfig[];
  rows: number;
  cols: number;
  mode: GameMode;
  rules: GameRules;
  modeKind: ModeKind;
  arenaMapId?: ArenaMapId;
  chaosConfig?: ChaosConfig;
  chaosSeed?: number;
}

interface Props {
  onBack: () => void;
  onStart: (cfg: MatchConfig) => void;
}

const MODE_CARDS: {
  kind: ModeKind;
  label: string;
  tag: string;
  desc: string;
  flags: [string, boolean][];
}[] = [
  {
    kind: "classic",
    label: "CLASSIC",
    tag: "Pure Strategy",
    desc: "Original Chain Reaction. No powers. No special tiles.",
    flags: [["Energy", false], ["Abilities", false], ["Special Tiles", false]],
  },
  {
    kind: "abilities",
    label: "ABILITIES",
    tag: "Power Strategy",
    desc: "Build energy and unleash tactical abilities.",
    flags: [["Energy", true], ["Abilities", true], ["Special Tiles", false]],
  },
  {
    kind: "arena",
    label: "ARENA",
    tag: "Battlefield Strategy",
    desc: "Fight across boards with portals, walls, amplifiers and more.",
    flags: [["Energy", false], ["Abilities", false], ["Special Tiles", true]],
  },
];

const CLASSIC_VARIANTS: { mode: GameMode; label: string; tagline: string }[] = [
  { mode: "classic", label: "STANDARD", tagline: "No timer, no shrink." },
  { mode: "blitz", label: "BLITZ", tagline: "Timed turns; act fast or forfeit." },
  { mode: "sudden-death", label: "SUDDEN DEATH", tagline: "The board shrinks every few rounds." },
  { mode: "custom", label: "CUSTOM", tagline: "Mix your own rules." },
];

const TURN_TIME_OPTIONS = [5000, 10000, 15000, 20000, 30000];
const SHRINK_INTERVAL_OPTIONS = [4, 6, 8, 10, 12];
const BOARD_SIZES = [
  { label: "6 × 9", rows: 6, cols: 9 },
  { label: "8 × 12", rows: 8, cols: 12 },
  { label: "10 × 15", rows: 10, cols: 15 },
];

const DEFAULT_NAMES = ["Player 1", "Player 2", "Player 3", "Player 4", "Player 5", "Player 6", "Player 7", "Player 8"];

export function SetupScreen({ onBack, onStart }: Props) {
  const [modeKind, setModeKind] = useState<ModeKind>("classic");
  const [arenaMapId, setArenaMapId] = useState<ArenaMapId>("standard");
  const [playerCount, setPlayerCount] = useState(2);
  const [boardIdx, setBoardIdx] = useState(0);
  const [names, setNames] = useState(DEFAULT_NAMES);
  const [colorIndices, setColorIndices] = useState([0, 1, 2, 3, 4, 5, 6, 7]);
  const [isAI, setIsAI] = useState<boolean[]>([false, true, false, false, false, false, false, false]);
  const [difficulty, setDifficulty] = useState<("easy" | "normal" | "hard")[]>(Array(8).fill("normal"));
  const [ruleVariant, setRuleVariant] = useState<GameMode>("classic");
  const [rules, setRules] = useState<GameRules>(() => ({ ...DEFAULT_RULES.classic }));
  const chaosMap = ARENA_MAPS.find((m) => m.id === "chaos")!;
  const [chaosConfig, setChaosConfig] = useState<ChaosConfig>(() =>
    defaultChaosConfig(chaosMap.rows, chaosMap.cols),
  );
  const [chaosSeed, setChaosSeed] = useState(() => randomSeed());
  const [showChaosPreview, setShowChaosPreview] = useState(false);

  const start = () => {
    const players: PlayerConfig[] = Array.from({ length: playerCount }, (_, i) => ({
      id: i,
      name: names[i] || `Player ${i + 1}`,
      colorIndex: colorIndices[i],
      isAI: isAI[i],
      difficulty: difficulty[i],
    }));
    const seen = new Set<number>();
    players.forEach((p) => {
      while (seen.has(p.colorIndex)) p.colorIndex = (p.colorIndex + 1) % 8;
      seen.add(p.colorIndex);
    });

    let rows = BOARD_SIZES[boardIdx].rows;
    let cols = BOARD_SIZES[boardIdx].cols;
    let effRules = rules;
    let effMode: GameMode = ruleVariant;
    if (modeKind !== "classic") {
      effMode = "classic";
      effRules = { ...DEFAULT_RULES.classic };
    }
    if (modeKind === "arena") {
      const m = ARENA_MAPS.find((x) => x.id === arenaMapId)!;
      rows = m.rows;
      cols = m.cols;
    }

    onStart({
      players,
      rows,
      cols,
      mode: effMode,
      rules: effRules,
      modeKind,
      arenaMapId: modeKind === "arena" ? arenaMapId : undefined,
      chaosConfig: modeKind === "arena" && arenaMapId === "chaos" ? chaosConfig : undefined,
      chaosSeed: modeKind === "arena" && arenaMapId === "chaos" ? chaosSeed : undefined,
    });
  };

  return (
    <div className="min-h-screen px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <button
          onClick={onBack}
          className="mb-6 text-xs tracking-[0.3em] text-muted-foreground hover:text-white transition"
        >
          ← BACK
        </button>
        <h2 className="font-display text-3xl font-black tracking-tight sm:text-4xl">MATCH SETUP</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Local multiplayer · {MODE_CARDS.find((m) => m.kind === modeKind)?.label}
        </p>

        {/* Top-level mode */}
        <section className="mt-8">
          <label className="font-display text-xs tracking-[0.3em] text-muted-foreground">GAME MODE</label>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {MODE_CARDS.map((m) => {
              const active = modeKind === m.kind;
              return (
                <button
                  key={m.kind}
                  onClick={() => setModeKind(m.kind)}
                  className={`rounded-md border p-4 text-left transition ${
                    active
                      ? "border-[oklch(0.72_0.18_235)] bg-[oklch(0.72_0.18_235/0.15)]"
                      : "border-white/10 bg-white/[0.03] hover:border-white/30"
                  }`}
                >
                  <div className="font-display text-base tracking-widest">{m.label}</div>
                  <div className="mt-0.5 text-[10px] tracking-[0.2em] text-muted-foreground">{m.tag}</div>
                  <div className="mt-2 text-[11px] leading-snug text-muted-foreground/90">{m.desc}</div>
                  <ul className="mt-3 space-y-0.5 text-[10px] font-mono">
                    {m.flags.map(([k, on]) => (
                      <li key={k} className={on ? "text-[oklch(0.75_0.15_150)]" : "text-muted-foreground/60"}>
                        {on ? "●" : "○"} {k}
                      </li>
                    ))}
                  </ul>
                </button>
              );
            })}
          </div>
        </section>

        {/* Arena map picker */}
        {modeKind === "arena" && (
          <section className="mt-6">
            <label className="font-display text-xs tracking-[0.3em] text-muted-foreground">SELECT ARENA</label>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {ARENA_MAPS.map((m) => {
                const active = arenaMapId === m.id;
                return (
                  <button
                    key={m.id}
                    disabled={!m.available}
                    onClick={() => m.available && setArenaMapId(m.id)}
                    className={`rounded-md border p-3 text-left transition ${
                      !m.available
                        ? "border-white/5 bg-white/[0.02] opacity-50"
                        : active
                        ? "border-[oklch(0.72_0.18_235)] bg-[oklch(0.72_0.18_235/0.15)]"
                        : "border-white/10 bg-white/[0.03] hover:border-white/30"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-display text-sm tracking-widest">{m.label.toUpperCase()}</span>
                      {!m.available && (
                        <span className="text-[9px] tracking-[0.2em] text-muted-foreground">COMING SOON</span>
                      )}
                    </div>
                    <div className="mt-1 text-[11px] leading-snug text-muted-foreground">{m.desc}</div>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {modeKind === "arena" && arenaMapId === "chaos" && (
          <ChaosGridConfig
            rows={chaosMap.rows}
            cols={chaosMap.cols}
            config={chaosConfig}
            seed={chaosSeed}
            showPreview={showChaosPreview}
            onChange={(cfg) => {
              setChaosConfig(clampChaosConfig(cfg, chaosMap.rows, chaosMap.cols));
              setChaosSeed(randomSeed());
            }}
            onRandomize={() => {
              setChaosConfig(randomChaosConfig(chaosMap.rows, chaosMap.cols));
              setChaosSeed(randomSeed());
              setShowChaosPreview(true);
            }}
            onReset={() => {
              setChaosConfig(defaultChaosConfig(chaosMap.rows, chaosMap.cols));
              setChaosSeed(randomSeed());
            }}
            onRegenerate={() => setChaosSeed(randomSeed())}
            onTogglePreview={() => setShowChaosPreview((v) => !v)}
          />
        )}

        {/* Classic rule variant */}
        {modeKind === "classic" && (
          <section className="mt-6">
            <label className="font-display text-xs tracking-[0.3em] text-muted-foreground">RULE VARIANT</label>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {CLASSIC_VARIANTS.map((m) => (
                <button
                  key={m.mode}
                  onClick={() => {
                    setRuleVariant(m.mode);
                    setRules({ ...DEFAULT_RULES[m.mode] });
                  }}
                  className={`rounded-md border p-3 text-left transition ${
                    ruleVariant === m.mode
                      ? "border-[oklch(0.72_0.18_235)] bg-[oklch(0.72_0.18_235/0.15)]"
                      : "border-white/10 bg-white/[0.03] hover:border-white/30"
                  }`}
                >
                  <div className="font-display text-sm">{m.label}</div>
                  <div className="mt-1 text-[10px] leading-snug text-muted-foreground">{m.tagline}</div>
                </button>
              ))}
            </div>

            {(ruleVariant === "blitz" || ruleVariant === "custom") && (
              <div className="mt-3 rounded-md border border-white/10 bg-white/[0.03] p-3">
                <label className="font-display text-[10px] tracking-[0.25em] text-muted-foreground">TURN TIMER</label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {TURN_TIME_OPTIONS.map((ms) => (
                    <button
                      key={ms}
                      onClick={() => setRules((r) => ({ ...r, turnTimeMs: ms }))}
                      className={`rounded-md px-3 py-1.5 text-[10px] tracking-[0.2em] transition ${
                        rules.turnTimeMs === ms
                          ? "bg-[oklch(0.72_0.18_235/0.25)] text-white"
                          : "bg-white/5 text-muted-foreground hover:text-white"
                      }`}
                    >
                      {ms / 1000}s
                    </button>
                  ))}
                  <button
                    onClick={() => setRules((r) => ({ ...r, turnTimeMs: 0 }))}
                    className={`rounded-md px-3 py-1.5 text-[10px] tracking-[0.2em] transition ${
                      rules.turnTimeMs === 0
                        ? "bg-[oklch(0.72_0.18_235/0.25)] text-white"
                        : "bg-white/5 text-muted-foreground hover:text-white"
                    }`}
                  >
                    OFF
                  </button>
                </div>
              </div>
            )}

            {(ruleVariant === "sudden-death" || ruleVariant === "custom") && (
              <div className="mt-3 rounded-md border border-white/10 bg-white/[0.03] p-3">
                <label className="font-display text-[10px] tracking-[0.25em] text-muted-foreground">
                  SHRINK INTERVAL
                </label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {SHRINK_INTERVAL_OPTIONS.map((rounds) => (
                    <button
                      key={rounds}
                      onClick={() =>
                        setRules((r) => ({ ...r, shrinkIntervalRounds: rounds, enableShrink: true }))
                      }
                      className={`rounded-md px-3 py-1.5 text-[10px] tracking-[0.2em] transition ${
                        rules.shrinkIntervalRounds === rounds
                          ? "bg-[oklch(0.72_0.18_235/0.25)] text-white"
                          : "bg-white/5 text-muted-foreground hover:text-white"
                      }`}
                    >
                      {rounds} rounds
                    </button>
                  ))}
                  <button
                    onClick={() => setRules((r) => ({ ...r, shrinkIntervalRounds: 0, enableShrink: false }))}
                    className={`rounded-md px-3 py-1.5 text-[10px] tracking-[0.2em] transition ${
                      !rules.enableShrink
                        ? "bg-[oklch(0.72_0.18_235/0.25)] text-white"
                        : "bg-white/5 text-muted-foreground hover:text-white"
                    }`}
                  >
                    OFF
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {/* Player count */}
        <section className="mt-8">
          <label className="font-display text-xs tracking-[0.3em] text-muted-foreground">PLAYERS</label>
          <div className="mt-2 flex flex-wrap gap-2">
            {[2, 3, 4, 5, 6, 7, 8].map((n) => (
              <button
                key={n}
                onClick={() => setPlayerCount(n)}
                className={`h-10 w-10 rounded-md border font-display text-sm transition ${
                  playerCount === n
                    ? "border-[oklch(0.72_0.18_235)] bg-[oklch(0.72_0.18_235/0.2)] text-white"
                    : "border-white/10 bg-white/[0.03] text-muted-foreground hover:border-white/30"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </section>

        {/* Board size — hidden for Arena (map defines its size) */}
        {modeKind !== "arena" && (
          <section className="mt-8">
            <label className="font-display text-xs tracking-[0.3em] text-muted-foreground">BOARD SIZE</label>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {BOARD_SIZES.map((s, i) => (
                <button
                  key={s.label}
                  onClick={() => setBoardIdx(i)}
                  className={`rounded-md border p-4 text-center transition ${
                    boardIdx === i
                      ? "border-[oklch(0.72_0.18_235)] bg-[oklch(0.72_0.18_235/0.2)]"
                      : "border-white/10 bg-white/[0.03] hover:border-white/30"
                  }`}
                >
                  <div className="font-display text-lg">{s.label}</div>
                  <div className="mt-1 text-[10px] tracking-[0.2em] text-muted-foreground">
                    {s.rows === 6 ? "SWIFT" : s.rows === 8 ? "STANDARD" : "GRAND"}
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Players */}
        <section className="mt-8">
          <label className="font-display text-xs tracking-[0.3em] text-muted-foreground">PLAYER PROFILES</label>
          <div className="mt-2 space-y-2">
            {Array.from({ length: playerCount }, (_, i) => (
              <div key={i} className="rounded-md border border-white/10 bg-white/[0.03] p-3">
                <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
                  <div
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-full font-display text-lg"
                    style={{
                      background: `radial-gradient(circle at 30% 30%, oklch(from ${colorFor(colorIndices[i])} calc(l + 0.15) c h), ${colorFor(colorIndices[i])})`,
                      boxShadow: `0 0 12px ${colorFor(colorIndices[i])}`,
                      color: "oklch(0.1 0 0)",
                    }}
                  >
                    {PLAYER_SYMBOLS[colorIndices[i]]}
                  </div>
                  <input
                    value={names[i]}
                    onChange={(e) => {
                      const next = names.slice();
                      next[i] = e.target.value.slice(0, 16);
                      setNames(next);
                    }}
                    className="min-w-0 rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-[oklch(0.72_0.18_235/0.6)]"
                  />
                  <div className="flex gap-1">
                    {PLAYER_COLOR_NAMES.map((_, ci) => {
                      const taken =
                        colorIndices.slice(0, playerCount).includes(ci) && colorIndices[i] !== ci;
                      return (
                        <button
                          key={ci}
                          disabled={taken}
                          onClick={() => {
                            const next = colorIndices.slice();
                            next[i] = ci;
                            setColorIndices(next);
                          }}
                          className={`h-6 w-6 rounded-full transition ${
                            taken ? "opacity-20" : "hover:scale-110"
                          } ${colorIndices[i] === ci ? "ring-2 ring-white" : ""}`}
                          style={{ background: colorFor(ci), boxShadow: `0 0 6px ${colorFor(ci)}` }}
                          title={PLAYER_COLOR_NAMES[ci]}
                        />
                      );
                    })}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <div className="flex overflow-hidden rounded-md border border-white/10">
                    <button
                      onClick={() => {
                        const next = isAI.slice(); next[i] = false; setIsAI(next);
                      }}
                      className={`px-3 py-1.5 text-[10px] tracking-[0.25em] transition ${
                        !isAI[i] ? "bg-white/10 text-white" : "text-muted-foreground hover:text-white"
                      }`}
                    >
                      HUMAN
                    </button>
                    <button
                      onClick={() => {
                        const next = isAI.slice(); next[i] = true; setIsAI(next);
                      }}
                      className={`px-3 py-1.5 text-[10px] tracking-[0.25em] transition ${
                        isAI[i] ? "bg-white/10 text-white" : "text-muted-foreground hover:text-white"
                      }`}
                    >
                      CPU
                    </button>
                  </div>
                  {isAI[i] && (
                    <div className="flex overflow-hidden rounded-md border border-white/10">
                      {(["easy", "normal", "hard"] as const).map((d) => (
                        <button
                          key={d}
                          onClick={() => {
                            const next = difficulty.slice(); next[i] = d; setDifficulty(next);
                          }}
                          className={`px-3 py-1.5 text-[10px] tracking-[0.25em] uppercase transition ${
                            difficulty[i] === d
                              ? "bg-[oklch(0.72_0.18_235/0.25)] text-white"
                              : "text-muted-foreground hover:text-white"
                          }`}
                        >
                          {d}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        <button
          onClick={start}
          className="mt-10 w-full rounded-lg border border-[oklch(0.72_0.18_235)] bg-[oklch(0.72_0.18_235/0.2)] py-4 font-display text-base tracking-[0.3em] text-white transition hover:bg-[oklch(0.72_0.18_235/0.35)] hover:shadow-[0_0_20px_var(--p1)]"
        >
          PLAY {MODE_CARDS.find((m) => m.kind === modeKind)!.label} →
        </button>

        <div className="mt-4 text-center text-[10px] tracking-[0.3em] text-muted-foreground">
          {MODE_CONFIGS[modeKind].abilities ? "TACTICAL POWERS ENABLED" : ""}
          {MODE_CONFIGS[modeKind].specialTiles ? "SPECIAL TILES ENABLED" : ""}
        </div>
      </div>
    </div>
  );
}
