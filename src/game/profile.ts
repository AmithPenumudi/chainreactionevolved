import { createContext, useContext } from "react";
import type { ModeKind } from "./engine";

export type StatsMode = "classic" | "abilities" | "arena";

export interface ModeStats {
  games: number;
  wins: number;
  eliminations: number;
  cellsCaptured: number;
  explosions: number;
  largestChain: number;
  /** Abilities mode extras */
  abilitiesUsed: number;
  energyEarned: number;
  energySpent: number;
  abilityCounts: Record<string, number>;
  /** Arena mode extras */
  portalTransfers: number;
  amplifierExplosions: number;
  powerTilesCaptured: number;
}

export interface MatchRecord {
  id: string;
  at: number;
  mode: StatsMode;
  result: "win" | "loss";
  players: number;
  turns: number;
  largestChain: number;
  detail?: string;
  xp: number;
}

export interface PlayerProfile {
  username: string;
  avatarId: string;
  xp: number;
  currentStreak: number;
  longestStreak: number;
  bestMatchEliminations: number;
  stats: Record<StatsMode, ModeStats>;
  recent: MatchRecord[];
}

export const AVATARS: { id: string; glyph: string; label: string; colorVar: string }[] = [
  { id: "core", glyph: "◆", label: "Core", colorVar: "var(--p1)" },
  { id: "spark", glyph: "▲", label: "Spark", colorVar: "var(--p2)" },
  { id: "orbit", glyph: "●", label: "Orbit", colorVar: "var(--p3)" },
  { id: "prism", glyph: "■", label: "Prism", colorVar: "var(--p4)" },
  { id: "nova", glyph: "★", label: "Nova", colorVar: "var(--p5)" },
  { id: "flux", glyph: "✚", label: "Flux", colorVar: "var(--p6)" },
  { id: "shard", glyph: "◼", label: "Shard", colorVar: "var(--p7)" },
  { id: "hex", glyph: "⬢", label: "Hex", colorVar: "var(--p8)" },
];

export function avatarFor(id: string) {
  return AVATARS.find((a) => a.id === id) ?? AVATARS[0];
}

export function emptyModeStats(): ModeStats {
  return {
    games: 0,
    wins: 0,
    eliminations: 0,
    cellsCaptured: 0,
    explosions: 0,
    largestChain: 0,
    abilitiesUsed: 0,
    energyEarned: 0,
    energySpent: 0,
    abilityCounts: {},
    portalTransfers: 0,
    amplifierExplosions: 0,
    powerTilesCaptured: 0,
  };
}

export const DEFAULT_PROFILE: PlayerProfile = {
  username: "PLAYER",
  avatarId: "core",
  xp: 0,
  currentStreak: 0,
  longestStreak: 0,
  bestMatchEliminations: 0,
  stats: { classic: emptyModeStats(), abilities: emptyModeStats(), arena: emptyModeStats() },
  recent: [],
};

const STORAGE_KEY = "cr-profile-v1";
const MAX_RECENT = 5;

export function loadProfile(): PlayerProfile {
  if (typeof window === "undefined") return DEFAULT_PROFILE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PROFILE;
    const p = JSON.parse(raw) as Partial<PlayerProfile>;
    return {
      ...DEFAULT_PROFILE,
      ...p,
      stats: {
        classic: { ...emptyModeStats(), ...(p.stats?.classic ?? {}) },
        abilities: { ...emptyModeStats(), ...(p.stats?.abilities ?? {}) },
        arena: { ...emptyModeStats(), ...(p.stats?.arena ?? {}) },
      },
      recent: p.recent ?? [],
    };
  } catch {
    return DEFAULT_PROFILE;
  }
}

export function saveProfile(p: PlayerProfile) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

/* ---------------- Leveling (cosmetic only — never affects gameplay) ------------- */

/** XP required to advance from `level` to `level + 1`. */
export function xpForLevel(level: number): number {
  return 250 * Math.max(1, level);
}

export function levelInfo(totalXp: number) {
  let level = 1;
  let remaining = Math.max(0, Math.floor(totalXp));
  while (remaining >= xpForLevel(level)) {
    remaining -= xpForLevel(level);
    level += 1;
  }
  const need = xpForLevel(level);
  return { level, into: remaining, need, pct: Math.min(100, (remaining / need) * 100) };
}

export const XP_RULES = {
  complete: 25,
  win: 75,
  perElimination: 20,
  chainBonus(largestChain: number) {
    if (largestChain >= 20) return 60;
    if (largestChain >= 10) return 30;
    if (largestChain >= 5) return 15;
    return 0;
  },
};

/* ---------------- Match recording ------------- */

export interface MatchOutcome {
  mode: StatsMode;
  won: boolean;
  players: number;
  turns: number;
  detail?: string;
  eliminations: number;
  cellsCaptured: number;
  explosions: number;
  largestChain: number;
  abilitiesUsed: number;
  energyEarned: number;
  energySpent: number;
  abilityCounts: Record<string, number>;
  /** Orbs the local player placed manually this match (abilities excluded). */
  orbsPlaced?: number;
  portalTransfers: number;
  amplifierExplosions: number;
  powerTilesCaptured: number;
}

export function xpForMatch(o: MatchOutcome): number {
  return (
    XP_RULES.complete +
    (o.won ? XP_RULES.win : 0) +
    o.eliminations * XP_RULES.perElimination +
    XP_RULES.chainBonus(o.largestChain)
  );
}

export function applyMatch(profile: PlayerProfile, o: MatchOutcome): PlayerProfile {
  const s = { ...profile.stats[o.mode] };
  s.games += 1;
  if (o.won) s.wins += 1;
  s.eliminations += o.eliminations;
  s.cellsCaptured += o.cellsCaptured;
  s.explosions += o.explosions;
  s.largestChain = Math.max(s.largestChain, o.largestChain);
  s.abilitiesUsed += o.abilitiesUsed;
  s.energyEarned += o.energyEarned;
  s.energySpent += o.energySpent;
  s.abilityCounts = { ...s.abilityCounts };
  for (const [k, v] of Object.entries(o.abilityCounts)) {
    s.abilityCounts[k] = (s.abilityCounts[k] ?? 0) + v;
  }
  s.portalTransfers += o.portalTransfers;
  s.amplifierExplosions += o.amplifierExplosions;
  s.powerTilesCaptured += o.powerTilesCaptured;

  const currentStreak = o.won ? profile.currentStreak + 1 : 0;
  const xp = xpForMatch(o);

  const record: MatchRecord = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    at: Date.now(),
    mode: o.mode,
    result: o.won ? "win" : "loss",
    players: o.players,
    turns: o.turns,
    largestChain: o.largestChain,
    detail: o.detail,
    xp,
  };

  return {
    ...profile,
    xp: profile.xp + xp,
    currentStreak,
    longestStreak: Math.max(profile.longestStreak, currentStreak),
    bestMatchEliminations: Math.max(profile.bestMatchEliminations, o.eliminations),
    stats: { ...profile.stats, [o.mode]: s },
    recent: [record, ...profile.recent].slice(0, MAX_RECENT),
  };
}

export function totalStats(profile: PlayerProfile): ModeStats {
  const modes: StatsMode[] = ["classic", "abilities", "arena"];
  const out = emptyModeStats();
  for (const m of modes) {
    const s = profile.stats[m];
    out.games += s.games;
    out.wins += s.wins;
    out.eliminations += s.eliminations;
    out.cellsCaptured += s.cellsCaptured;
    out.explosions += s.explosions;
    out.largestChain = Math.max(out.largestChain, s.largestChain);
    out.abilitiesUsed += s.abilitiesUsed;
    out.energyEarned += s.energyEarned;
    out.energySpent += s.energySpent;
    out.portalTransfers += s.portalTransfers;
    out.amplifierExplosions += s.amplifierExplosions;
    out.powerTilesCaptured += s.powerTilesCaptured;
    for (const [k, v] of Object.entries(s.abilityCounts)) {
      out.abilityCounts[k] = (out.abilityCounts[k] ?? 0) + v;
    }
  }
  return out;
}

export function favoriteAbility(s: ModeStats): string | null {
  const entries = Object.entries(s.abilityCounts);
  if (entries.length === 0) return null;
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

/* ---------------- Achievements (status only — no gameplay effect) ------------- */

export interface Achievement {
  id: string;
  name: string;
  desc: string;
  goal: number;
  progress: (p: PlayerProfile) => number;
}

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: "first-reaction",
    name: "FIRST REACTION",
    desc: "Win your first game.",
    goal: 1,
    progress: (p) => totalStats(p).wins,
  },
  {
    id: "chain-master",
    name: "CHAIN MASTER",
    desc: "Create a 10+ explosion chain.",
    goal: 10,
    progress: (p) => totalStats(p).largestChain,
  },
  {
    id: "domination",
    name: "DOMINATION",
    desc: "Eliminate 3 players in one match.",
    goal: 3,
    progress: (p) => p.bestMatchEliminations,
  },
  {
    id: "portal-master",
    name: "PORTAL MASTER",
    desc: "Trigger a chain through a Portal.",
    goal: 1,
    progress: (p) => p.stats.arena.portalTransfers,
  },
  {
    id: "power-user",
    name: "POWER USER",
    desc: "Use 10 abilities.",
    goal: 10,
    progress: (p) => p.stats.abilities.abilitiesUsed,
  },
  {
    id: "veteran",
    name: "VETERAN",
    desc: "Play 25 matches.",
    goal: 25,
    progress: (p) => totalStats(p).games,
  },
  {
    id: "unstoppable",
    name: "UNSTOPPABLE",
    desc: "Reach a 5-win streak.",
    goal: 5,
    progress: (p) => p.longestStreak,
  },
];

export interface ProfileContextValue {
  profile: PlayerProfile;
  setUsername: (name: string) => void;
  setAvatar: (id: string) => void;
  recordMatch: (o: MatchOutcome) => void;
  /** Cosmetic progression XP awarded outside matches (e.g. challenge claims). */
  addXp: (amount: number) => void;
  resetProfile: () => void;
}

export const ProfileContext = createContext<ProfileContextValue>({
  profile: DEFAULT_PROFILE,
  setUsername: () => {},
  setAvatar: () => {},
  recordMatch: () => {},
  addXp: () => {},
  resetProfile: () => {},
});

export function useProfile() {
  return useContext(ProfileContext);
}

export function statsModeFor(kind: ModeKind): StatsMode {
  return kind === "abilities" ? "abilities" : kind === "arena" ? "arena" : "classic";
}
