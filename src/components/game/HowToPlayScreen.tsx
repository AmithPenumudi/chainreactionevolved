import { useState } from "react";
import { MiniBoard } from "./MiniBoard";
import { ABILITIES } from "@/game/abilities";

interface Props {
  onBack: () => void;
}

type Tab = "basics" | "chains" | "classic" | "abilities" | "arena" | "strategy";

const TABS: { id: Tab; label: string }[] = [
  { id: "basics", label: "BASICS" },
  { id: "chains", label: "CHAIN REACTIONS" },
  { id: "classic", label: "CLASSIC" },
  { id: "abilities", label: "ABILITIES" },
  { id: "arena", label: "ARENA" },
  { id: "strategy", label: "STRATEGY" },
];

export function HowToPlayScreen({ onBack }: Props) {
  const [tab, setTab] = useState<Tab>("basics");

  return (
    <div className="min-h-screen">
      <div className="mx-auto w-full max-w-2xl px-5 py-10 sm:py-14">
        <div className="flex items-center justify-between gap-4">
          <button
            onClick={onBack}
            className="text-[10px] tracking-[0.3em] text-muted-foreground transition hover:text-foreground"
          >
            ← MENU
          </button>
          <h1 className="font-display text-xl font-black tracking-tight sm:text-3xl">HOW TO PLAY</h1>
        </div>

        <nav className="mt-6 flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-md border px-3 py-1.5 font-display text-[10px] tracking-[0.2em] transition ${
                tab === t.id
                  ? "border-[oklch(0.72_0.18_235/0.6)] bg-[oklch(0.72_0.18_235/0.15)] text-white"
                  : "border-white/10 bg-white/[0.02] text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="mt-6">
          {tab === "basics" && <Basics />}
          {tab === "chains" && <Chains />}
          {tab === "classic" && <Classic />}
          {tab === "abilities" && <Abilities />}
          {tab === "arena" && <Arena />}
          {tab === "strategy" && <Strategy />}
        </div>

        <div className="mt-10 text-center text-[10px] tracking-[0.3em] text-muted-foreground">
          TUTORIAL BOARDS DO NOT AFFECT YOUR STATS
        </div>
      </div>
    </div>
  );
}

/* ---------------- sections ---------------- */

function Basics() {
  return (
    <>
      <Section title="THE TURN">
        <Bullets
          items={[
            "Players take turns placing one orb on the board.",
            "You may place on an empty cell, or on a cell you already own.",
            "You can never place on an opponent's cell — you have to take it by exploding into it.",
          ]}
        />
        <Goal>Eliminate every opponent. The last player with orbs on the board wins.</Goal>
      </Section>

      <Section title="CRITICAL MASS">
        <p className="text-sm text-muted-foreground">
          A cell explodes when it holds as many orbs as it has neighbours.
        </p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <MassCard label="CORNER" value={2} kind="corner" />
          <MassCard label="EDGE" value={3} kind="edge" />
          <MassCard label="INTERIOR" value={4} kind="interior" />
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          On explosion, the cell empties and sends one orb to each neighbour. Any orb that lands on a
          cell converts it to the exploding player's colour.
        </p>
      </Section>

      <Section title="TRY IT">
        <MiniBoard
          rows={3}
          cols={3}
          players={1}
          caption="Tap the top-left corner twice — 2 orbs is critical mass there."
        />
      </Section>
    </>
  );
}

function Chains() {
  return (
    <>
      <Section title="HOW A CHAIN HAPPENS">
        <Flow steps={["EXPLOSION", "NEIGHBOURS RECEIVE ORBS", "A NEIGHBOUR HITS CRITICAL MASS", "CHAIN REACTION"]} />
        <p className="mt-3 text-sm text-muted-foreground">
          Every cell pushed over its limit explodes too — one placement can cascade across the whole
          board and flip many cells at once.
        </p>
      </Section>

      <Section title="TRIGGER A CASCADE">
        <MiniBoard
          rows={4}
          cols={4}
          players={1}
          seed={[
            [0, 0, 1, 0],
            [0, 1, 2, 0],
            [1, 0, 2, 0],
            [1, 1, 3, 0],
            [1, 2, 2, 0],
            [2, 1, 2, 0],
          ]}
          caption="This board is loaded. Tap the corner (top-left) and watch it cascade."
        />
      </Section>
    </>
  );
}

function Classic() {
  return (
    <>
      <Section title="CLASSIC MODE">
        <Bullets
          items={[
            "Pure Chain Reaction strategy.",
            "No abilities. No energy. No special tiles.",
            "You win entirely through placement, positioning and chain reactions.",
          ]}
        />
      </Section>
      <Section title="A TWO-PLAYER SKIRMISH">
        <MiniBoard
          rows={4}
          cols={5}
          players={2}
          seed={[
            [0, 0, 1, 0],
            [3, 4, 1, 1],
          ]}
          caption="Turns alternate between the two colours. Take a corner early."
        />
      </Section>
    </>
  );
}

function Abilities() {
  return (
    <>
      <Section title="ABILITIES MODE">
        <p className="text-sm text-muted-foreground">
          Chain Reaction + Energy + tactical powers. Everything from Classic still applies.
        </p>
      </Section>

      <Section title="EARNING ENERGY">
        <Bullets
          items={[
            "+5 energy per explosion in your chain.",
            "+3 energy per cell you capture.",
            "Bonus energy for big chains (5+ and 10+ explosions).",
            "+20 energy for each player you eliminate.",
          ]}
        />
        <p className="mt-2 text-xs text-muted-foreground">
          Energy is spent from the ability bar during your turn.
        </p>
      </Section>

      <Section title="THE ABILITIES">
        <ul className="divide-y divide-white/5">
          {ABILITIES.map((a) => (
            <li key={a.id} className="flex items-start justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <div className="font-display text-xs tracking-[0.15em]">{a.name.toUpperCase()}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{a.desc}</div>
              </div>
              <span className="shrink-0 rounded-sm border border-[oklch(0.72_0.18_235/0.4)] px-2 py-0.5 font-display text-[10px] tracking-wide text-[oklch(0.85_0.15_235)]">
                {a.cost} EP
              </span>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}

function Arena() {
  return (
    <>
      <Section title="ARENA MODE">
        <p className="text-sm text-muted-foreground">
          Chain Reaction + special battlefield tiles. Arena has{" "}
          <span className="text-foreground">no abilities and no energy</span> — only the board changes.
        </p>
      </Section>

      <Section title="PORTAL">
        <Flow steps={["ORB ENTERS PORTAL A", "TELEPORTS TO PORTAL B", "CHAIN CONTINUES THERE"]} />
        <p className="mt-2 text-xs text-muted-foreground">
          Only explosion orbs teleport. Manually placing an orb on a Portal does not.
        </p>
        <div className="mt-3">
          <MiniBoard
            rows={3}
            cols={5}
            players={1}
            tiles={[
              { row: 0, col: 1, tile: "portal", portalPairId: 0 },
              { row: 2, col: 4, tile: "portal", portalPairId: 0 },
            ]}
            seed={[[0, 0, 1, 0]]}
            caption="Tap the top-left corner to explode it — one orb enters the portal and pops out across the board."
          />
        </div>
      </Section>

      <Section title="AMPLIFIER ×2">
        <p className="text-sm text-muted-foreground">
          When the Amplifier cell itself explodes, it sends two orbs to every valid neighbour instead
          of one.
        </p>
        <div className="mt-3">
          <MiniBoard
            rows={3}
            cols={4}
            players={1}
            tiles={[{ row: 1, col: 1, tile: "amplifier" }]}
            seed={[[1, 1, 3, 0]]}
            caption="Tap the amplifier to detonate it — every neighbour receives two orbs."
          />
        </div>
      </Section>

      <Section title="POWER TILE">
        <Bullets
          items={[
            "Capturing the Power Tile grants Double Placement on your next turn.",
            "The bonus can only be stored once — use it before capturing another.",
          ]}
        />
      </Section>

      <Section title="REACTOR">
        <p className="text-sm text-muted-foreground">
          A playable cell with one extra critical mass while you own it — it takes one more orb to
          detonate, but sends a bigger chain outward when it finally does.
        </p>
        <div className="mt-3">
          <MiniBoard
            rows={3}
            cols={3}
            players={1}
            tiles={[{ row: 1, col: 1, tile: "reactor" }]}
            seed={[[1, 1, 4, 0]]}
            caption="This interior Reactor needs 5 orbs to explode instead of the usual 4. Tap it once."
          />
        </div>
      </Section>

      <Section title="WALL">
        <Bullets
          items={[
            "Cannot contain orbs, cannot be owned, cannot be selected.",
            "Blocks explosion paths completely.",
            "Lowers the critical mass of neighbouring cells — critical mass counts valid outgoing directions.",
          ]}
        />
        <div className="mt-3">
          <MiniBoard
            rows={3}
            cols={4}
            players={1}
            tiles={[{ row: 1, col: 1, tile: "wall" }]}
            seed={[[1, 2, 2, 0]]}
            caption="The cell right of the wall now explodes at 3 instead of 4. Tap it once."
          />
        </div>
      </Section>

      <Section title="DEAD ZONE">
        <Bullets
          items={[
            "Cannot contain orbs, cannot be owned, cannot be selected.",
            "Does not block explosions like a Wall does — orbs fly through the space around it freely.",
            "Any orb that actually lands on it, placed or flying in from a chain, is destroyed for good.",
          ]}
        />
        <div className="mt-3">
          <MiniBoard
            rows={3}
            cols={3}
            players={1}
            tiles={[{ row: 1, col: 2, tile: "dead" }]}
            seed={[[1, 1, 3, 0]]}
            caption="Tap the loaded cell — the orb it sends into the Dead Zone simply vanishes."
          />
        </div>
      </Section>

      <Section title="CHAOS GRID">
        <p className="text-sm text-muted-foreground">
          An Arena variation where you choose the battlefield before the match: Portal Pairs,
          Amplifiers, Power Tiles, Reactors, Walls and Dead Zones. It changes the configuration,
          never the fundamental Chain Reaction rules.
        </p>
      </Section>
    </>
  );
}

function Strategy() {
  return (
    <Section title="STRATEGY TIPS">
      <Bullets
        items={[
          "Corners need only 2 orbs — they are the cheapest strongholds.",
          "Never park a loaded cell next to an enemy cell that is one orb from critical.",
          "Look past the first explosion: read the whole cascade before you commit.",
          "In Arena, a Portal can relocate your reaction to the other side of the board.",
          "Amplifiers double the output of a single blast — great chain starters.",
          "In Abilities Mode, don't spend energy just because you have it. Save it for a decisive turn.",
        ]}
      />
    </Section>
  );
}

/* ---------------- primitives ---------------- */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 first:mt-0">
      <h2 className="font-display text-[11px] tracking-[0.35em] text-muted-foreground">{title}</h2>
      <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.02] p-4">{children}</div>
    </section>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2">
      {items.map((t) => (
        <li key={t} className="flex gap-2.5 text-sm text-muted-foreground">
          <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[oklch(0.72_0.18_235)]" />
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

function Goal({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 rounded-md border border-[oklch(0.72_0.18_235/0.35)] bg-[oklch(0.72_0.18_235/0.08)] px-3 py-2 text-sm">
      <span className="font-display text-[10px] tracking-[0.3em] text-[oklch(0.85_0.15_235)]">
        OBJECTIVE
      </span>
      <div className="mt-1 text-muted-foreground">{children}</div>
    </div>
  );
}

function Flow({ steps }: { steps: string[] }) {
  return (
    <div className="flex flex-col gap-1">
      {steps.map((s, i) => (
        <div key={s}>
          <div className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 font-display text-[10px] tracking-[0.2em]">
            {s}
          </div>
          {i < steps.length - 1 && (
            <div className="py-0.5 pl-3 text-xs text-muted-foreground">↓</div>
          )}
        </div>
      ))}
    </div>
  );
}

function MassCard({
  label,
  value,
  kind,
}: {
  label: string;
  value: number;
  kind: "corner" | "edge" | "interior";
}) {
  const active = kind === "corner" ? 0 : kind === "edge" ? 1 : 4;
  const arrows =
    kind === "corner" ? [1, 3] : kind === "edge" ? [0, 2, 4] : [1, 3, 5, 7];
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.03] p-3 text-center">
      <div className="mx-auto grid w-fit grid-cols-3 gap-[2px]">
        {Array.from({ length: 9 }, (_, i) => {
          const isCenter = i === active;
          const isNeighbour = arrows.includes(i);
          return (
            <span
              key={i}
              className="h-4 w-4 rounded-[2px]"
              style={{
                background: isCenter
                  ? "var(--p1)"
                  : isNeighbour
                    ? "oklch(0.28 0.008 260)"
                    : "oklch(0.2 0.008 260)",
              }}
            />
          );
        })}
      </div>
      <div className="mt-2 font-display text-[9px] tracking-[0.2em] text-muted-foreground">
        {label}
      </div>
      <div className="font-display text-lg font-black">{value}</div>
    </div>
  );
}
