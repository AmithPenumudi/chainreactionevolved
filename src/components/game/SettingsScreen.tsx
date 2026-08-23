import { useState } from "react";
import { ChainSpeed, GameSettings, useSettings } from "@/game/settings";
import { PLAYER_COLOR_NAMES, PLAYER_COLOR_VARS, PLAYER_SYMBOLS } from "@/game/colors";

interface Props {
  onBack: () => void;
}

export function SettingsScreen({ onBack }: Props) {
  const { settings, update, reset } = useSettings();
  const [confirmReset, setConfirmReset] = useState(false);

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
          <h1 className="font-display text-2xl font-black tracking-tight sm:text-3xl">SETTINGS</h1>
        </div>

        <Section title="GAMEPLAY">
          <Row label="Chain Reaction Speed" hint="Visual only — game logic is unchanged.">
            <Segmented<ChainSpeed>
              value={settings.chainSpeed}
              options={[
                { value: "slow", label: "SLOW" },
                { value: "normal", label: "NORMAL" },
                { value: "fast", label: "FAST" },
              ]}
              onChange={(v) => update("chainSpeed", v)}
            />
          </Row>
          <ToggleRow
            label="Turn Confirmation"
            hint="Tap a cell to select, tap again to confirm."
            k="turnConfirmation"
            settings={settings}
            update={update}
          />
          <ToggleRow
            label="Show Critical Cells"
            hint="Subtle marker on cells one orb from exploding."
            k="showCriticalCells"
            settings={settings}
            update={update}
          />
        </Section>

        <Section title="VISUALS">
          <ToggleRow
            label="Orb Motion"
            hint="Continuous idle rotation of orb clusters."
            k="orbMotion"
            settings={settings}
            update={update}
          />
          <ToggleRow
            label="Reduced Motion"
            hint="Shorter transitions and minimal idle movement."
            k="reducedMotion"
            settings={settings}
            update={update}
          />
        </Section>

        <Section title="AUDIO">
          <ToggleRow label="Master Sound" k="masterSound" settings={settings} update={update} />
          <ToggleRow
            label="Sound Effects"
            k="soundEffects"
            settings={settings}
            update={update}
            disabled={!settings.masterSound}
          />
          <Row label="Effects Volume">
            <VolumeSlider
              value={settings.sfxVolume}
              disabled={!settings.masterSound || !settings.soundEffects}
              onChange={(v) => update("sfxVolume", v)}
            />
          </Row>
          <ToggleRow
            label="Music"
            k="music"
            settings={settings}
            update={update}
            disabled={!settings.masterSound}
          />
          <Row label="Music Volume">
            <VolumeSlider
              value={settings.musicVolume}
              disabled={!settings.masterSound || !settings.music}
              onChange={(v) => update("musicVolume", v)}
            />
          </Row>
        </Section>

        <Section title="PLAYER COLORS">
          <p className="pb-3 text-xs text-muted-foreground">
            Preview only — colors are fixed to keep every player clearly distinguishable.
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {PLAYER_COLOR_VARS.map((c, i) => (
              <div
                key={c}
                className="flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2"
              >
                <span
                  className="h-4 w-4 shrink-0 rounded-full"
                  style={{ background: c }}
                  aria-hidden
                />
                <div className="min-w-0">
                  <div className="truncate text-[11px] tracking-wide">
                    P{i + 1} {PLAYER_SYMBOLS[i]}
                  </div>
                  <div className="truncate text-[10px] text-muted-foreground">
                    {PLAYER_COLOR_NAMES[i]}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <div className="mt-10">
          {!confirmReset ? (
            <button
              onClick={() => setConfirmReset(true)}
              className="w-full rounded-md border border-destructive/40 px-6 py-3 font-display text-xs tracking-[0.25em] text-destructive transition hover:bg-destructive/10 sm:w-auto"
            >
              RESET SETTINGS
            </button>
          ) : (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4">
              <div className="text-sm">Reset all settings to their defaults?</div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => {
                    reset();
                    setConfirmReset(false);
                  }}
                  className="rounded-md bg-destructive px-5 py-2 font-display text-xs tracking-[0.2em] text-destructive-foreground transition hover:opacity-90"
                >
                  RESET
                </button>
                <button
                  onClick={() => setConfirmReset(false)}
                  className="rounded-md border border-foreground/25 px-5 py-2 font-display text-xs tracking-[0.2em] transition hover:bg-foreground/10"
                >
                  CANCEL
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-9">
      <h2 className="font-display text-[11px] tracking-[0.35em] text-muted-foreground">{title}</h2>
      <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.02] p-4">{children}</div>
    </section>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 border-b border-white/5 py-3 first:pt-0 last:border-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <div className="text-sm">{label}</div>
        {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

type BoolKeys = {
  [K in keyof GameSettings]: GameSettings[K] extends boolean ? K : never;
}[keyof GameSettings];

function ToggleRow({
  label,
  hint,
  k,
  settings,
  update,
  disabled,
}: {
  label: string;
  hint?: string;
  k: BoolKeys;
  settings: GameSettings;
  update: <K extends keyof GameSettings>(key: K, value: GameSettings[K]) => void;
  disabled?: boolean;
}) {
  return (
    <Row label={label} hint={hint}>
      <Toggle on={settings[k]} disabled={disabled} onChange={(v) => update(k, v)} label={label} />
    </Row>
  );
}

function Toggle({
  on,
  onChange,
  disabled,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`flex items-center gap-2 rounded-full border px-1 py-1 transition ${
        disabled ? "opacity-40" : ""
      } ${on ? "border-primary/60 bg-primary/15" : "border-white/15 bg-white/[0.04]"}`}
    >
      <span
        className="h-4 w-4 rounded-full transition-transform"
        style={{
          background: on ? "var(--primary)" : "oklch(0.6 0.01 260)",
          transform: on ? "translateX(18px)" : "translateX(0)",
        }}
      />
      <span className="w-9 pr-2 text-right font-display text-[10px] tracking-[0.15em] text-muted-foreground">
        {on ? "ON" : "OFF"}
      </span>
    </button>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-white/10 bg-white/[0.03] p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded px-3 py-1.5 font-display text-[10px] tracking-[0.2em] transition ${
            value === o.value
              ? "bg-primary/20 text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function VolumeSlider({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 ${disabled ? "opacity-40" : ""}`}>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-40 cursor-pointer appearance-none rounded-full bg-white/15 accent-[var(--primary)]"
        aria-label="Volume"
      />
      <span className="w-8 text-right text-xs tabular-nums text-muted-foreground">{value}</span>
    </div>
  );
}
