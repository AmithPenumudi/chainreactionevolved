import { withAlpha } from "@/game/colors";
import { useState } from "react";
import {
  ACHIEVEMENTS,
  AVATARS,
  MatchRecord,
  ModeStats,
  StatsMode,
  avatarFor,
  favoriteAbility,
  levelInfo,
  totalStats,
  useProfile,
} from "@/game/profile";
import { ABILITIES } from "@/game/abilities";

interface Props {
  onBack: () => void;
}

type Tab = "all" | StatsMode;

const TABS: { value: Tab; label: string }[] = [
  { value: "all", label: "ALL" },
  { value: "classic", label: "CLASSIC" },
  { value: "abilities", label: "ABILITIES" },
  { value: "arena", label: "ARENA" },
];

export function ProfileScreen({ onBack }: Props) {
  const { profile, setUsername, setAvatar } = useProfile();
  const [tab, setTab] = useState<Tab>("all");
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(profile.username);

  const lvl = levelInfo(profile.xp);
  const all = totalStats(profile);
  const s: ModeStats = tab === "all" ? all : profile.stats[tab];
  const avatar = avatarFor(profile.avatarId);
  const winRate = s.games > 0 ? Math.round((s.wins / s.games) * 100) : 0;

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
          <h1 className="font-display text-2xl font-black tracking-tight sm:text-3xl">PROFILE</h1>
        </div>

        {/* Identity */}
        <div className="mt-8 flex items-center gap-4 sm:gap-5">
          <div
            className="grid h-16 w-16 shrink-0 place-items-center rounded-full border text-2xl sm:h-20 sm:w-20 sm:text-3xl"
            style={{
              borderColor: avatar.colorVar,
              color: avatar.colorVar,
              background: `${withAlpha(avatar.colorVar, 0.1)}`,
            }}
          >
            {avatar.glyph}
          </div>
          <div className="min-w-0 flex-1">
            {editing ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setUsername(draftName.trim().toUpperCase() || "PLAYER");
                  setEditing(false);
                }}
                className="flex items-center gap-2"
              >
                <input
                  autoFocus
                  value={draftName}
                  maxLength={16}
                  onChange={(e) => setDraftName(e.target.value)}
                  className="min-w-0 flex-1 rounded-md border border-white/15 bg-white/[0.04] px-3 py-1.5 font-display text-lg tracking-wide outline-none focus:border-white/40"
                />
                <button
                  type="submit"
                  className="rounded-md border border-white/15 px-3 py-1.5 text-[10px] tracking-[0.25em] hover:border-white/40"
                >
                  SAVE
                </button>
              </form>
            ) : (
              <button
                onClick={() => {
                  setDraftName(profile.username);
                  setEditing(true);
                }}
                className="group flex items-baseline gap-2 text-left"
              >
                <span className="truncate font-display text-2xl font-black tracking-tight sm:text-3xl">
                  {profile.username}
                </span>
                <span className="text-[10px] tracking-[0.25em] text-muted-foreground group-hover:text-foreground">
                  EDIT
                </span>
              </button>
            )}
            <div className="mt-1 flex items-baseline justify-between text-[10px] tracking-[0.25em] text-muted-foreground">
              <span>LEVEL {lvl.level}</span>
              <span>
                {lvl.into.toLocaleString()} / {lvl.need.toLocaleString()} XP
              </span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full transition-[width] duration-500"
                style={{ width: `${lvl.pct}%`, background: avatar.colorVar }}
              />
            </div>
          </div>
        </div>

        {/* Avatars */}
        <Section title="AVATAR">
          <div className="flex flex-wrap gap-2">
            {AVATARS.map((a) => {
              const active = a.id === profile.avatarId;
              return (
                <button
                  key={a.id}
                  onClick={() => setAvatar(a.id)}
                  title={a.label}
                  aria-label={a.label}
                  className={`grid h-11 w-11 place-items-center rounded-full border text-lg transition ${
                    active ? "" : "border-white/10 hover:border-white/30"
                  }`}
                  style={
                    active
                      ? {
                          borderColor: a.colorVar,
                          color: a.colorVar,
                          background: `${withAlpha(a.colorVar, 0.12)}`,
                        }
                      : { color: a.colorVar }
                  }
                >
                  {a.glyph}
                </button>
              );
            })}
          </div>
        </Section>

        {/* Quick stats */}
        <Section title="QUICK STATS">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="GAMES" value={all.games} />
            <Stat label="WINS" value={all.wins} />
            <Stat
              label="WIN RATE"
              value={`${all.games ? Math.round((all.wins / all.games) * 100) : 0}%`}
            />
            <Stat label="LARGEST CHAIN" value={all.largestChain} />
          </div>
        </Section>

        {/* Mode stats */}
        <Section title="MODE STATS">
          <div className="mb-3 flex gap-1 rounded-md border border-white/10 bg-white/[0.02] p-1">
            {TABS.map((t) => (
              <button
                key={t.value}
                onClick={() => setTab(t.value)}
                className={`flex-1 rounded-sm px-2 py-1.5 text-[10px] tracking-[0.18em] transition ${
                  tab === t.value
                    ? "bg-white/10 text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label="GAMES PLAYED" value={s.games} />
            <Stat label="GAMES WON" value={s.wins} />
            <Stat label="WIN RATE" value={`${winRate}%`} />
            <Stat label="PLAYERS ELIMINATED" value={s.eliminations} />
            <Stat label="CELLS CAPTURED" value={s.cellsCaptured} />
            <Stat label="TOTAL EXPLOSIONS" value={s.explosions} />
            <Stat label="LARGEST CHAIN" value={s.largestChain} />
            <Stat label="LONGEST STREAK" value={profile.longestStreak} />
            <Stat label="CURRENT STREAK" value={profile.currentStreak} />
          </div>

          {(tab === "abilities" || tab === "all") && (
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="ABILITIES USED" value={s.abilitiesUsed} />
              <Stat label="ENERGY EARNED" value={s.energyEarned} />
              <Stat label="ENERGY SPENT" value={s.energySpent} />
              <Stat label="FAVORITE ABILITY" value={abilityLabel(favoriteAbility(s))} />
            </div>
          )}

          {(tab === "arena" || tab === "all") && (
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="PORTAL TRANSFERS" value={s.portalTransfers} />
              <Stat label="AMPLIFIER BLASTS" value={s.amplifierExplosions} />
              <Stat label="POWER TILES" value={s.powerTilesCaptured} />
              <Stat label="ARENA WINS" value={profile.stats.arena.wins} />
            </div>
          )}
        </Section>

        {/* Achievements */}
        <Section title="ACHIEVEMENTS">
          <div className="grid gap-2 sm:grid-cols-2">
            {ACHIEVEMENTS.map((a) => {
              const prog = Math.min(a.goal, a.progress(profile));
              const unlocked = prog >= a.goal;
              return (
                <div
                  key={a.id}
                  className={`rounded-md border p-3 ${
                    unlocked ? "border-white/25 bg-white/[0.05]" : "border-white/10 bg-white/[0.02]"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`font-display text-xs tracking-[0.2em] ${
                        unlocked ? "" : "text-muted-foreground"
                      }`}
                    >
                      {a.name}
                    </span>
                    <span className="text-[9px] tracking-[0.2em] text-muted-foreground">
                      {unlocked ? "UNLOCKED" : `${prog}/${a.goal}`}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{a.desc}</div>
                  {!unlocked && (
                    <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-white/40"
                        style={{ width: `${(prog / a.goal) * 100}%` }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Section>

        {/* Recent matches */}
        <Section title="RECENT MATCHES">
          {profile.recent.length === 0 ? (
            <div className="rounded-md border border-white/10 bg-white/[0.02] p-4 text-xs text-muted-foreground">
              No matches yet. Play a game to start tracking your history.
            </div>
          ) : (
            <div className="grid gap-2">
              {profile.recent.map((m) => (
                <RecentRow key={m.id} m={m} />
              ))}
            </div>
          )}
          <button
            disabled
            title="Coming soon"
            className="mt-3 w-full cursor-not-allowed rounded-md border border-white/10 bg-white/[0.02] py-2.5 font-display text-[10px] tracking-[0.3em] text-muted-foreground opacity-60"
          >
            VIEW MATCH HISTORY
          </button>
        </Section>

        <div className="mt-10 text-center text-[10px] tracking-[0.3em] text-muted-foreground">
          LEVELS &amp; ACHIEVEMENTS ARE COSMETIC · NO GAMEPLAY ADVANTAGE
        </div>
      </div>
    </div>
  );
}

function RecentRow({ m }: { m: MatchRecord }) {
  const win = m.result === "win";
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-white/[0.02] px-3 py-2.5">
      <div className="min-w-0">
        <div className="font-display text-xs tracking-[0.2em]">{m.mode.toUpperCase()}</div>
        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {m.players} Players · {m.turns} Turns
          {m.detail ? ` · ${m.detail}` : ""}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-[10px] tracking-[0.2em] text-muted-foreground">+{m.xp} XP</span>
        <span
          className={`rounded-sm px-2 py-0.5 font-display text-[10px] tracking-[0.2em] ${
            win ? "bg-white/12 text-foreground" : "bg-white/5 text-muted-foreground"
          }`}
        >
          {win ? "WIN" : "LOSS"}
        </span>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-[10px] tracking-[0.35em] text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.03] p-3">
      <div className="text-[9px] tracking-[0.22em] text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-lg">
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
    </div>
  );
}

function abilityLabel(id: string | null): string {
  if (!id) return "—";
  return ABILITIES.find((a) => a.id === id)?.name ?? "—";
}
