# Three Game Modes: Classic / Abilities / Arena

Rebuild the mode system around three clearly separate experiences that share one engine. Existing Blitz / Sudden Death / Custom become **rule modifiers** available inside Classic (kept as-is under the hood) — the primary axis becomes the three modes above.

## Step 1 — Mode selection & shared config

- Replace the current mode picker in `SetupScreen.tsx` with three large cards: **CLASSIC / ABILITIES / ARENA**, each with tagline and feature flags shown (Energy/Abilities/Special Tiles Yes/No).
- Add `GameModeKind = "classic" | "abilities" | "arena"` and a `GameModeConfig { abilities, energy, specialTiles }` to `src/game/engine.ts`. Store on `GameState`.
- Classic path stays 100% behavior-identical.
- Turn timer / shrink options continue to work but only inside Classic (kept simple).

## Step 2 — Abilities Mode

Engine (`src/game/engine.ts` + new `src/game/abilities.ts`):

- Add `energy: number[]` per player on `GameState`, capped 0–100, starting 0.
- Award energy inside `applyMove` / `commitMove`:
  - +2 place, +5 per explosion, +3 per captured cell, +10 if chain≥5, +15 if chain≥10, +20 per elimination.
- Add per-cell modifiers: `shielded?: PlayerId`, `fortified?: boolean`, `empLockedUntilTurn?: number` (stored on `Cell`).
- Explosion loop honors modifiers:
  - Shield: incoming enemy orb is absorbed; shield cleared. Auto-expires on owner's next turn start.
  - Fortify: `criticalMass()` returns base+1 while flag set; cleared when that cell explodes.
  - EMP: `canPlace` returns false for the owner on their next turn; explosions still flow through.
- Abilities implemented as engine functions returning `MoveResult`-shaped payloads so the existing animation pipeline in `GameScreen.tsx` handles them:
  - **Overload (30)**: +1 orb on owned cell, then run explosion loop.
  - **Shield (35)**: mark cell shielded.
  - **Fortify (40)**: mark cell fortified.
  - **Double Drop (45)**: state flag `pendingExtraPlacement=true`; skip player rotation after next placement resolves, clear flag.
  - **EMP (50)**: mark enemy cell locked for 1 turn.
  - **Relocate (55)**: −1 orb source, +1 dest, run explosion loop if dest critical.
  - **Overcharge (70)**: set cell orbs = cm, run explosion loop.

UI (`src/components/game/AbilityBar.tsx` new):

- Energy bar (segmented ▓/░ style, "72/100") + 7 ability buttons showing cost + disabled state (insufficient EP / no valid target).
- Targeting mode: clicking an ability enters a target-selection state; board cells highlight valid targets with a thin ring (no glow). Second click confirms; ESC/second-tap on button cancels.
- Relocate uses two-click flow (source → destination).
- Mobile: `AbilityBar` collapses into a bottom sheet triggered by an `ABILITIES` button; board stays dominant.

## Step 3 — Arena Mode

Engine:

- Add `TileKind = "normal" | "power" | "portal" | "wall" | "amplifier" | "dead" | "reactor"` on `Cell` (`tile?: TileKind`, `portalPairId?: number`).
- Add `powerBonus: number[]` (0 or 1) per player.
- `canPlace`: false for wall/dead. Placing on power tile grants `powerBonus[player] = 1` (max 1); next placement of that player consumes bonus → two orbs placed sequentially before the explosion loop.
- Explosion propagation:
  - Skip wall neighbors entirely (no orb deposited, cm unaffected since walls aren't neighbors).
  - Dead zone: orb absorbed (not added).
  - Portal: orb rerouted to paired portal's cell; loop-guard set (each explosion step routes each orb through at most one portal hop).
  - Amplifier: exploding cell sends 2 orbs per valid neighbor.
  - Reactor: `criticalMass()` returns base+1 while owned by a player; base while unowned.
- Wall/dead cells excluded from ownership counts / elimination checks.

Maps (new `src/game/arena-maps.ts`):

- Symmetric hand-built layouts. Only **Standard Arena** functional in this pass (walls, 1 portal pair, 2 power tiles, 1 amplifier, 1 reactor, a couple dead zones on a mirrored 8×12 board).
- Portal Arena / Fortress / Power Grid / Chaos Grid listed but marked **COMING SOON** (disabled cards).

UI:

- `ArenaMapPicker` inside `SetupScreen` shown only when Arena is selected.
- `CellView.tsx` renders subtle tile glyphs behind orbs: ⚡ (power), ○ ring (portal, colored per pair), solid block (wall), ×2 (amplifier), hatched pattern (dead), small core dot (reactor). No glows.
- Small **TILE INFO** button in `GameScreen` opens a compact popover with the descriptions from the spec.

## Step 4 — Separation guarantees

- `GameScreen.tsx` reads `config.mode`. `AbilityBar` renders only when `energy`. Tile glyphs render only when `specialTiles`. Cross-contamination is impossible by construction.
- All modes share `applyMove`, `commitMove`, animation pipeline, victory detection, orb visuals.

## Technical notes

- Engine remains pure/immutable — abilities return new `GameState`+optional `MoveResult`.
- `GameScreen` animation pipeline is reused for every explosion-producing ability (Overload/Overcharge/Relocate/Double Drop second placement).
- Persist mode/config across rematch (already flows through `MatchConfig`).
- Existing Blitz/SuddenDeath rules kept internally but only surfaced under Classic to avoid clutter; can be removed later if desired.

## Out of scope this pass

- Portal Arena, Fortress, Power Grid, Chaos Grid maps (cards shown as COMING SOON).
- Sounds, haptics, tutorial overlay.

## Verification

- Type check + Playwright smoke: launch each mode, place orbs, confirm Classic unchanged; in Abilities confirm energy accrues and Overload triggers a chain; in Arena confirm walls block placement, power tile grants 2-orb next turn, portal reroutes an orb, amplifier doubles output.
