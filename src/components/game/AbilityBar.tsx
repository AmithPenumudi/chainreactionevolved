import { ABILITIES, AbilityId } from "@/game/abilities";

interface Props {
  energy: number;
  selectedAbility: AbilityId | null;
  onSelect: (id: AbilityId | null) => void;
  disabled?: boolean;
  compact?: boolean;
}

export function AbilityBar({ energy, selectedAbility, onSelect, disabled, compact }: Props) {
  const pct = Math.min(100, Math.max(0, energy));
  return (
    <div className="rounded-md border border-foreground/10 p-3">
      <div className="flex items-baseline justify-between">
        <div className="text-[10px] tracking-[0.3em] text-muted-foreground">ENERGY</div>
        <div className="font-display text-sm tabular-nums">{Math.round(pct)}/100</div>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full transition-all duration-300"
          style={{
            width: `${pct}%`,
            background: "oklch(0.72 0.18 235)",
          }}
        />
      </div>
      <div className={`mt-3 grid gap-1.5 ${compact ? "grid-cols-2" : "grid-cols-1"}`}>
        {ABILITIES.map((a) => {
          const affordable = energy >= a.cost;
          const isSelected = selectedAbility === a.id;
          const inactive = disabled || !affordable;
          return (
            <button
              key={a.id}
              type="button"
              disabled={inactive}
              onClick={() => onSelect(isSelected ? null : a.id)}
              title={a.desc}
              className={`group flex items-center justify-between rounded-md border px-2.5 py-1.5 text-left transition
                ${isSelected
                  ? "border-[oklch(0.72_0.18_235)] bg-[oklch(0.72_0.18_235/0.2)] text-white"
                  : affordable
                  ? "border-white/10 bg-white/[0.03] hover:border-white/30"
                  : "border-white/5 bg-white/[0.02] opacity-40"}`}
            >
              <span className="font-display text-[11px] tracking-[0.15em]">{a.name.toUpperCase()}</span>
              <span className="text-[10px] tabular-nums text-muted-foreground">{a.cost}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
