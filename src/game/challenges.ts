import { createContext, useContext } from "react";
import type { MatchOutcome, StatsMode } from "./profile";

/* ---------------------------------------------------------------------------
 * Challenge architecture
 *
 * Challenges are pure *definitions*: a metric extracted from real engine-driven
 * match outcomes, a goal, and an XP reward. Progress is accumulated from the
 * same MatchOutcome the profile records (engine events, never animations).
 * Rewards are cosmetic progression only — challenges never affect gameplay.
 * ------------------------------------------------------------------------- */

export type ChallengeCategory = "daily" | "weekly" | "mastery";
export type ChallengeTag = "CLASSIC" | "ABILITIES" | "ARENA";

/** How repeated matches combine into a challenge's progress value. */
export type Accumulation = "sum" | "max" | "union";

export interface ChallengeDef {
  id: string;
  category: ChallengeCategory;
  name: string;
  desc: string;
  goal: number;
  xp: number;
  tag?: ChallengeTag;
  accumulate?: Accumulation;
  /** Mastery grouping header (e.g. "CHAIN MASTER"). */
  group?: string;
  /** Cosmetic badge earned on completion. */
  badge?: string;
  /** Value contributed by a single finished match. */
  value: (o: MatchOutcome) => number;
  /** For `union` accumulation: distinct keys contributed by a match. */
  keys?: (o: MatchOutcome) => string[];
}

/* --------------------------- metric helpers ------------------------------ */

const inMode = (o: MatchOutcome, mode: StatsMode) => o.mode === mode;
const won = (o: MatchOutcome) => (o.won ? 1 : 0);

/* ------------------------------ pools ------------------------------------ */

export const DAILY_POOL: ChallengeDef[] = [
  {
    id: "d-chain-starter",
    category: "daily",
    name: "CHAIN STARTER",
    desc: "Trigger 10 explosions.",
    goal: 10,
    xp: 100,
    value: (o) => o.explosions,
  },
  {
    id: "d-territory",
    category: "daily",
    name: "TERRITORY CONTROL",
    desc: "Capture 30 enemy cells.",
    goal: 30,
    xp: 150,
    value: (o) => o.cellsCaptured,
  },
  {
    id: "d-victor",
    category: "daily",
    name: "VICTOR",
    desc: "Win 1 match.",
    goal: 1,
    xp: 200,
    value: won,
  },
  {
    id: "d-combo-maker",
    category: "daily",
    name: "COMBO MAKER",
    desc: "Create a chain reaction of at least 8 explosions.",
    goal: 1,
    xp: 175,
    value: (o) => (o.largestChain >= 8 ? 1 : 0),
  },
  {
    id: "d-orb-master",
    category: "daily",
    name: "ORB MASTER",
    desc: "Place 80 orbs across any matches.",
    goal: 80,
    xp: 125,
    value: (o) => o.orbsPlaced ?? 0,
  },
  {
    id: "d-arena-fighter",
    category: "daily",
    name: "ARENA FIGHTER",
    tag: "ARENA",
    desc: "Play one Arena match.",
    goal: 1,
    xp: 150,
    value: (o) => (inMode(o, "arena") ? 1 : 0),
  },
  {
    id: "d-power-user",
    category: "daily",
    name: "POWER USER",
    tag: "ABILITIES",
    desc: "Use 5 abilities.",
    goal: 5,
    xp: 150,
    value: (o) => (inMode(o, "abilities") ? o.abilitiesUsed : 0),
  },
];

export const WEEKLY_POOL: ChallengeDef[] = [
  {
    id: "w-chain-master",
    category: "weekly",
    name: "CHAIN MASTER",
    desc: "Trigger 200 explosions.",
    goal: 200,
    xp: 600,
    value: (o) => o.explosions,
  },
  {
    id: "w-conqueror",
    category: "weekly",
    name: "CONQUEROR",
    desc: "Win 10 matches.",
    goal: 10,
    xp: 750,
    value: won,
  },
  {
    id: "w-eliminator",
    category: "weekly",
    name: "ELIMINATOR",
    desc: "Eliminate 20 players.",
    goal: 20,
    xp: 700,
    value: (o) => o.eliminations,
  },
  {
    id: "w-arena-veteran",
    category: "weekly",
    name: "ARENA VETERAN",
    tag: "ARENA",
    desc: "Win 5 Arena matches.",
    goal: 5,
    xp: 800,
    value: (o) => (inMode(o, "arena") ? won(o) : 0),
  },
  {
    id: "w-ability-specialist",
    category: "weekly",
    name: "ABILITY SPECIALIST",
    tag: "ABILITIES",
    desc: "Use 50 abilities.",
    goal: 50,
    xp: 700,
    value: (o) => (inMode(o, "abilities") ? o.abilitiesUsed : 0),
  },
  {
    id: "w-portal-expert",
    category: "weekly",
    name: "PORTAL EXPERT",
    tag: "ARENA",
    desc: "Teleport 100 orbs through Portals.",
    goal: 100,
    xp: 800,
    value: (o) => (inMode(o, "arena") ? o.portalTransfers : 0),
  },
  {
    id: "w-amplifier-king",
    category: "weekly",
    name: "AMPLIFIER KING",
    tag: "ARENA",
    desc: "Trigger 25 Amplifier explosions.",
    goal: 25,
    xp: 750,
    value: (o) => (inMode(o, "arena") ? o.amplifierExplosions : 0),
  },
];

/** Mastery groups, in display order. */
export const MASTERY_GROUPS = [
  "CHAIN MASTER",
  "WINNER",
  "ELIMINATOR",
  "COLLECTOR",
  "ARENA",
  "ABILITIES",
] as const;
export type MasteryGroup = (typeof MASTERY_GROUPS)[number];

const ABILITY_IDS = [
  "overload",
  "shield",
  "fortify",
  "double-drop",
  "emp",
  "relocate",
  "overcharge",
];

export const MASTERY_CHALLENGES: ChallengeDef[] = [
  /* ----------------------------- CHAIN MASTER ---------------------------- */
  {
    id: "m-chain-1",
    category: "mastery",
    group: "CHAIN MASTER",
    name: "CHAIN REACTION I",
    desc: "Create a chain of 10 explosions.",
    goal: 10,
    xp: 250,
    badge: "SPARK",
    accumulate: "max",
    value: (o) => o.largestChain,
  },
  {
    id: "m-chain-2",
    category: "mastery",
    group: "CHAIN MASTER",
    name: "CHAIN REACTION II",
    desc: "Create a chain of 20 explosions.",
    goal: 20,
    xp: 500,
    badge: "CASCADE",
    accumulate: "max",
    value: (o) => o.largestChain,
  },
  {
    id: "m-chain-3",
    category: "mastery",
    group: "CHAIN MASTER",
    name: "CHAIN REACTION III",
    desc: "Create a chain of 35 explosions.",
    goal: 35,
    xp: 1000,
    badge: "DETONATOR",
    accumulate: "max",
    value: (o) => o.largestChain,
  },
  {
    id: "m-chain-4",
    category: "mastery",
    group: "CHAIN MASTER",
    name: "CHAIN REACTION IV",
    desc: "Create a chain of 50 explosions.",
    goal: 50,
    xp: 2000,
    badge: "SUPERNOVA",
    accumulate: "max",
    value: (o) => o.largestChain,
  },
  /* -------------------------------- WINNER ------------------------------- */
  {
    id: "m-victor-1",
    category: "mastery",
    group: "WINNER",
    name: "VICTOR I",
    desc: "Win 10 matches.",
    goal: 10,
    xp: 300,
    badge: "CONTENDER",
    value: won,
  },
  {
    id: "m-victor-2",
    category: "mastery",
    group: "WINNER",
    name: "VICTOR II",
    desc: "Win 50 matches.",
    goal: 50,
    xp: 900,
    badge: "CHAMPION",
    value: won,
  },
  {
    id: "m-victor-3",
    category: "mastery",
    group: "WINNER",
    name: "VICTOR III",
    desc: "Win 100 matches.",
    goal: 100,
    xp: 2000,
    badge: "DOMINANT",
    value: won,
  },
  {
    id: "m-victor-4",
    category: "mastery",
    group: "WINNER",
    name: "VICTOR IV",
    desc: "Win 250 matches.",
    goal: 250,
    xp: 5000,
    badge: "LEGEND",
    value: won,
  },
  /* ------------------------------ ELIMINATOR ----------------------------- */
  {
    id: "m-elim-1",
    category: "mastery",
    group: "ELIMINATOR",
    name: "ELIMINATOR I",
    desc: "Eliminate 25 players.",
    goal: 25,
    xp: 400,
    badge: "HUNTER",
    value: (o) => o.eliminations,
  },
  {
    id: "m-elim-2",
    category: "mastery",
    group: "ELIMINATOR",
    name: "ELIMINATOR II",
    desc: "Eliminate 100 players.",
    goal: 100,
    xp: 1200,
    badge: "PURGE",
    value: (o) => o.eliminations,
  },
  {
    id: "m-elim-3",
    category: "mastery",
    group: "ELIMINATOR",
    name: "ELIMINATOR III",
    desc: "Eliminate 250 players.",
    goal: 250,
    xp: 3000,
    badge: "ANNIHILATOR",
    value: (o) => o.eliminations,
  },
  /* ------------------------------- COLLECTOR ----------------------------- */
  {
    id: "m-collect-1",
    category: "mastery",
    group: "COLLECTOR",
    name: "COLLECTOR I",
    desc: "Capture 500 cells.",
    goal: 500,
    xp: 300,
    badge: "SETTLER",
    value: (o) => o.cellsCaptured,
  },
  {
    id: "m-collect-2",
    category: "mastery",
    group: "COLLECTOR",
    name: "COLLECTOR II",
    desc: "Capture 2,000 cells.",
    goal: 2000,
    xp: 900,
    badge: "EXPANSIONIST",
    value: (o) => o.cellsCaptured,
  },
  {
    id: "m-collect-3",
    category: "mastery",
    group: "COLLECTOR",
    name: "COLLECTOR III",
    desc: "Capture 10,000 cells.",
    goal: 10000,
    xp: 3000,
    badge: "SOVEREIGN",
    value: (o) => o.cellsCaptured,
  },
  /* --------------------------------- ARENA ------------------------------- */
  {
    id: "m-arena-portal",
    category: "mastery",
    group: "ARENA",
    name: "PORTAL MASTER",
    tag: "ARENA",
    desc: "Use 100 Portals.",
    goal: 100,
    xp: 800,
    badge: "WARP",
    value: (o) => o.portalTransfers,
  },
  {
    id: "m-arena-amp",
    category: "mastery",
    group: "ARENA",
    name: "AMPLIFIER MASTER",
    tag: "ARENA",
    desc: "Trigger 100 Amplifier explosions.",
    goal: 100,
    xp: 800,
    badge: "RESONANCE",
    value: (o) => o.amplifierExplosions,
  },
  {
    id: "m-arena-power",
    category: "mastery",
    group: "ARENA",
    name: "POWER CONTROL",
    tag: "ARENA",
    desc: "Capture 200 Power Tiles.",
    goal: 200,
    xp: 900,
    badge: "OVERSEER",
    value: (o) => o.powerTilesCaptured,
  },
  /* ------------------------------- ABILITIES ----------------------------- */
  {
    id: "m-abil-all",
    category: "mastery",
    group: "ABILITIES",
    name: "FULL ARSENAL",
    tag: "ABILITIES",
    desc: "Use every ability at least once.",
    goal: ABILITY_IDS.length,
    xp: 600,
    badge: "ARSENAL",
    accumulate: "union",
    value: (o) => Object.keys(o.abilityCounts).length,
    keys: (o) =>
      Object.entries(o.abilityCounts)
        .filter(([, v]) => v > 0)
        .map(([k]) => k),
  },
  {
    id: "m-abil-500",
    category: "mastery",
    group: "ABILITIES",
    name: "ABILITY MASTER",
    tag: "ABILITIES",
    desc: "Use 500 abilities.",
    goal: 500,
    xp: 2000,
    badge: "TACTICIAN",
    value: (o) => o.abilitiesUsed,
  },
  {
    id: "m-abil-energy",
    category: "mastery",
    group: "ABILITIES",
    name: "ENERGY MASTER",
    tag: "ABILITIES",
    desc: "Earn 10,000 Energy.",
    goal: 10000,
    xp: 2000,
    badge: "REACTOR",
    value: (o) => o.energyEarned,
  },
  {
    id: "m-abil-overcharge",
    category: "mastery",
    group: "ABILITIES",
    name: "OVERCHARGED",
    tag: "ABILITIES",
    desc: "Trigger 50 Overcharge explosions.",
    goal: 50,
    xp: 1200,
    badge: "SURGE",
    value: (o) => o.abilityCounts["overcharge"] ?? 0,
  },
];

const ALL_DEFS: ChallengeDef[] = [...DAILY_POOL, ...WEEKLY_POOL, ...MASTERY_CHALLENGES];

export function challengeById(id: string): ChallengeDef | undefined {
  return ALL_DEFS.find((c) => c.id === id);
}

/* ------------------------- period bookkeeping ---------------------------- */

const DAY_MS = 86_400_000;

export function dailyKey(now = Date.now()): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** ISO-ish week key based on local Monday-start weeks. */
export function weeklyKey(now = Date.now()): string {
  const d = new Date(now);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
  return `w${monday.getFullYear()}-${monday.getMonth() + 1}-${monday.getDate()}`;
}

export function msUntilDailyReset(now = Date.now()): number {
  const d = new Date(now);
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  return Math.max(0, next - now);
}

export function msUntilWeeklyReset(now = Date.now()): number {
  const d = new Date(now);
  const day = (d.getDay() + 6) % 7;
  const nextMonday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + (7 - day)).getTime();
  return Math.max(0, nextMonday - now);
}

export function formatCountdown(ms: number): string {
  const total = Math.floor(ms / 1000);
  const days = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days}d ${h}h`;
  return `${h}h ${m}m`;
}

/** Deterministic rotation so everyone on the same day sees the same set. */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pickRotating(pool: ChallengeDef[], key: string, count: number): string[] {
  const seed = hashString(key);
  const idx: number[] = [];
  let cursor = seed % pool.length;
  // The step must be coprime with the pool size, otherwise the cursor cycles through fewer
  // than `count` distinct entries and this loop would never finish.
  let step = 1 + (seed % Math.max(1, pool.length - 1));
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  while (pool.length > 1 && gcd(step, pool.length) !== 1) step += 1;
  while (idx.length < Math.min(count, pool.length)) {
    if (!idx.includes(cursor)) idx.push(cursor);
    cursor = (cursor + step) % pool.length;
  }
  return idx.map((i) => pool[i].id);
}

export function pickDaily(key = dailyKey()): string[] {
  return pickRotating(DAILY_POOL, key, 3);
}

export function pickWeekly(key = weeklyKey()): string[] {
  return pickRotating(WEEKLY_POOL, key, 5);
}

/* ------------------------------ state ------------------------------------ */

export interface ChallengeState {
  dailyKey: string;
  weeklyKey: string;
  dailyIds: string[];
  weeklyIds: string[];
  progress: Record<string, number>;
  claimed: Record<string, boolean>;
  /** Distinct keys collected for `union` challenges (e.g. abilities used). */
  sets: Record<string, string[]>;
  /** Lifetime XP granted through challenge claims (display only). */
  xpClaimed: number;
}

export function freshState(now = Date.now()): ChallengeState {
  return {
    dailyKey: dailyKey(now),
    weeklyKey: weeklyKey(now),
    dailyIds: pickDaily(dailyKey(now)),
    weeklyIds: pickWeekly(weeklyKey(now)),
    progress: {},
    claimed: {},
    sets: {},
    xpClaimed: 0,
  };
}

const STORAGE_KEY = "cr-challenges-v1";

function sanitizeChallengeState(raw: unknown): Partial<ChallengeState> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const p = raw as Record<string, unknown>;
  const out: Partial<ChallengeState> = {};
  const isObj = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === "object" && !Array.isArray(v);
  const strArr = (v: unknown) =>
    Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : undefined;
  if (typeof p.dailyKey === "string") out.dailyKey = p.dailyKey;
  if (typeof p.weeklyKey === "string") out.weeklyKey = p.weeklyKey;
  const d = strArr(p.dailyIds);
  if (d) out.dailyIds = d;
  const w = strArr(p.weeklyIds);
  if (w) out.weeklyIds = w;
  if (isObj(p.progress)) {
    out.progress = {};
    for (const [k, v] of Object.entries(p.progress))
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) out.progress[k] = v;
  }
  if (isObj(p.claimed)) {
    out.claimed = {};
    for (const [k, v] of Object.entries(p.claimed)) if (v === true) out.claimed[k] = true;
  }
  if (isObj(p.sets)) {
    out.sets = {};
    for (const [k, v] of Object.entries(p.sets)) {
      const arr = strArr(v);
      if (arr) out.sets[k] = arr;
    }
  }
  if (typeof p.xpClaimed === "number" && Number.isFinite(p.xpClaimed) && p.xpClaimed >= 0)
    out.xpClaimed = p.xpClaimed;
  return out;
}

export function loadChallenges(): ChallengeState {
  if (typeof window === "undefined") return freshState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return freshState();
    const parsed = sanitizeChallengeState(JSON.parse(raw));
    const merged = rollPeriods({ ...freshState(), ...parsed });
    // Drop stale ids from an older challenge pool and repick for this period.
    const valid = (ids: string[]) => ids.every((id) => Boolean(challengeById(id)));
    return {
      ...merged,
      dailyIds: valid(merged.dailyIds) ? merged.dailyIds : pickDaily(merged.dailyKey),
      weeklyIds: valid(merged.weeklyIds) ? merged.weeklyIds : pickWeekly(merged.weeklyKey),
    };
  } catch {
    return freshState();
  }
}

export function saveChallenges(s: ChallengeState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

/** Refresh daily/weekly sets when their period has elapsed. */
export function rollPeriods(s: ChallengeState, now = Date.now()): ChallengeState {
  let next = s;
  const dk = dailyKey(now);
  const wk = weeklyKey(now);

  if (next.dailyKey !== dk) {
    const progress = { ...next.progress };
    const claimed = { ...next.claimed };
    for (const id of next.dailyIds) {
      delete progress[id];
      delete claimed[id];
    }
    next = { ...next, dailyKey: dk, dailyIds: pickDaily(dk), progress, claimed };
  }
  if (next.weeklyKey !== wk) {
    const progress = { ...next.progress };
    const claimed = { ...next.claimed };
    for (const id of next.weeklyIds) {
      delete progress[id];
      delete claimed[id];
    }
    next = { ...next, weeklyKey: wk, weeklyIds: pickWeekly(wk), progress, claimed };
  }
  return next;
}

export function activeDefs(s: ChallengeState, category: ChallengeCategory): ChallengeDef[] {
  if (category === "mastery") return MASTERY_CHALLENGES;
  const ids = category === "daily" ? s.dailyIds : s.weeklyIds;
  return ids.map(challengeById).filter((d): d is ChallengeDef => Boolean(d));
}

/** Apply a finished match's engine-derived outcome to every active challenge. */
export function applyOutcome(s: ChallengeState, o: MatchOutcome, now = Date.now()): ChallengeState {
  const rolled = rollPeriods(s, now);
  const progress = { ...rolled.progress };
  const sets = { ...(rolled.sets ?? {}) };
  const defs = [
    ...activeDefs(rolled, "daily"),
    ...activeDefs(rolled, "weekly"),
    ...MASTERY_CHALLENGES,
  ];
  for (const def of defs) {
    if (rolled.claimed[def.id]) continue;
    if (def.accumulate === "union") {
      const incoming = def.keys?.(o) ?? [];
      if (incoming.length === 0) continue;
      const merged = Array.from(new Set([...(sets[def.id] ?? []), ...incoming]));
      sets[def.id] = merged;
      progress[def.id] = Math.min(def.goal, merged.length);
      continue;
    }
    const v = def.value(o);
    if (v <= 0) continue;
    const current = progress[def.id] ?? 0;
    progress[def.id] =
      def.accumulate === "max" ? Math.max(current, v) : Math.min(def.goal, current + v);
  }
  return { ...rolled, progress, sets };
}

export function progressOf(s: ChallengeState, def: ChallengeDef): number {
  return Math.min(def.goal, s.progress[def.id] ?? 0);
}

export function isComplete(s: ChallengeState, def: ChallengeDef): boolean {
  return progressOf(s, def) >= def.goal;
}

export function claimableCount(s: ChallengeState): number {
  const defs = [...activeDefs(s, "daily"), ...activeDefs(s, "weekly"), ...MASTERY_CHALLENGES];
  return defs.filter((d) => isComplete(s, d) && !s.claimed[d.id]).length;
}

/* ------------------------------ context ---------------------------------- */

export interface ChallengeContextValue {
  state: ChallengeState;
  recordOutcome: (o: MatchOutcome) => void;
  /** Claims the reward once; returns the XP granted (0 if not claimable). */
  claim: (id: string) => number;
  resetChallenges: () => void;
}

export const ChallengeContext = createContext<ChallengeContextValue>({
  state: freshState(0),
  recordOutcome: () => {},
  claim: () => 0,
  resetChallenges: () => {},
});

export function useChallenges() {
  return useContext(ChallengeContext);
}

export const CHALLENGE_DAY_MS = DAY_MS;
