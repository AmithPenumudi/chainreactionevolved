#!/usr/bin/env node
/**
 * Internal metrics dashboard.
 *
 *   npm run dashboard          # reads .env.local, writes and opens dashboard.html
 *   npm run dashboard -- --demo    # realistic sample data, no backend needed
 *
 * Runs on your machine only. The service_role key it needs bypasses row-level security, so it
 * must never reach a browser bundle or a device: this script reads it in Node, queries the
 * `metrics` views, and writes a self-contained HTML file. `dashboard.html` is gitignored.
 *
 * Put these in .env.local (also gitignored):
 *   SUPABASE_URL=https://<project>.supabase.co
 *   SUPABASE_SERVICE_KEY=<service_role key>
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  bands,
  compact,
  duration,
  labelFits,
  linearScale,
  linePoints,
  stackLayout,
} from "../src/game/metrics/charts.ts";

const demo = process.argv.includes("--demo");
const OUT = resolve(process.cwd(), "dashboard.html");

// ----------------------------------------------------------------- palette
// The validated reference palette (see the dataviz skill). Both modes are selected — the dark
// column is the same hues re-stepped for the dark surface, not an automatic flip.
// Validator: 3 categorical slots, --pairs all, PASS in both modes.
// Light-mode aqua sits below 3:1 on the surface, so the relief rule applies: the stacked bar
// carries direct labels and every chart has a table view.
const PALETTE = {
  light: { s1: "#2a78d6", s2: "#eb6834", s3: "#1baf7a" },
  dark: { s1: "#3987e5", s2: "#d95926", s3: "#199e70" },
};

/** WCAG relative luminance. */
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Ink for a label sitting INSIDE a coloured fill — the one place text may leave the text
 * tokens. Picked by contrast rather than assumed: white on the light-mode aqua would be
 * about 2.4:1, which fails, so that segment takes dark ink instead.
 */
function readableInk(hex) {
  const l = luminance(hex);
  const onWhite = 1.05 / (l + 0.05);
  const onInk = (l + 0.05) / (luminance("#0b0b0b") + 0.05);
  return onInk > onWhite ? "#0b0b0b" : "#ffffff";
}

// ----------------------------------------------------------------- data

async function fetchMetrics() {
  const env = {};
  const envFile = resolve(process.cwd(), ".env.local");
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  const url = process.env.SUPABASE_URL ?? env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY ?? env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL / SUPABASE_SERVICE_KEY not found in the environment or .env.local.\n" +
        "Run `npm run dashboard -- --demo` to preview the dashboard with sample data.",
    );
  }
  // `metrics` is not exposed over PostgREST, so the views are read through an RPC-free
  // direct select against the schema using the service key's schema header.
  const get = async (view) => {
    const res = await fetch(`${url}/rest/v1/${view}?select=*`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Accept-Profile": "metrics",
      },
    });
    if (!res.ok) {
      const body = await res.text();
      if (body.includes("Invalid schema")) {
        throw new Error(
          "The `metrics` schema is not exposed to the Data API, so its views cannot be read.\n" +
            "Add `metrics` under Project Settings → Data API → Exposed schemas. The grants in\n" +
            "0002_metrics.sql still restrict it to service_role, so this does not open it up.",
        );
      }
      throw new Error(`${view}: ${res.status} ${body}`);
    }
    return res.json();
  };
  const [overview, daily, retention, modeSplit] = await Promise.all([
    get("overview"),
    get("daily"),
    get("retention"),
    get("mode_split"),
  ]);
  return { overview: overview[0] ?? {}, daily, retention, modeSplit, demo: false };
}

/** Plausible-looking data so the dashboard can be reviewed before any players exist. */
function demoMetrics() {
  const daily = [];
  const today = new Date();
  let players = 38;
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    players = Math.max(12, Math.round(players * (0.97 + Math.random() * 0.1)));
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    const active = Math.round(players * (weekend ? 1.35 : 1));
    const minutes = 9 + Math.random() * 8;
    daily.push({
      day: d.toISOString().slice(0, 10),
      active_players: active,
      sessions: Math.round(active * (1.4 + Math.random() * 0.5)),
      matches: Math.round(active * (2.1 + Math.random() * 1.4)),
      active_hours: +((active * minutes) / 60).toFixed(2),
      minutes_per_player: +minutes.toFixed(1),
    });
  }
  const retention = daily.slice(-14).map((d) => ({
    cohort_day: d.day,
    new_players: Math.round(4 + Math.random() * 14),
    day_1_retention_pct: +(26 + Math.random() * 26).toFixed(1),
  }));
  const totalHours = daily.reduce((n, d) => n + d.active_hours, 0);
  return {
    demo: true,
    overview: {
      total_players: 612,
      dau: daily.at(-1).active_players,
      wau: Math.round(daily.slice(-7).reduce((n, d) => n + d.active_players, 0) * 0.42),
      mau: 421,
      total_hours: totalHours,
      total_matches: daily.reduce((n, d) => n + d.matches, 0),
    },
    daily,
    retention,
    modeSplit: [
      { mode: "classic", games: 8_420, wins: 4_390 },
      { mode: "abilities", games: 3_110, wins: 1_602 },
      { mode: "arena", games: 1_870, wins: 903 },
    ],
  };
}

// ----------------------------------------------------------------- svg helpers

const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

const PLOT = { w: 680, h: 190, padLeft: 44, padBottom: 26, padTop: 10 };

/** Hairline gridlines + left tick labels, shared by the line and column charts. */
function gridAndTicks(scale) {
  return scale.ticks
    .map((t) => {
      const y = PLOT.padTop + scale(t);
      return (
        `<line class="grid" x1="${PLOT.padLeft}" y1="${y.toFixed(1)}" x2="${PLOT.padLeft + PLOT.w}" y2="${y.toFixed(1)}"/>` +
        `<text class="tick" x="${PLOT.padLeft - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end">${compact(t)}</text>`
      );
    })
    .join("");
}

/** Every Nth x label, so dates never collide. */
function xLabels(rows, label) {
  const bs = bands(rows.length, PLOT.w);
  const every = Math.max(1, Math.ceil(rows.length / 8));
  const shown = new Set();
  for (let i = 0; i < rows.length; i += every) shown.add(i);
  // The final date is worth showing, but only when it would not land on top of the previous
  // label — 30 days at every-4 leaves index 28 and 29 adjacent, which overlaps into mojibake.
  const last = rows.length - 1;
  if (last - Math.max(...shown) >= Math.ceil(every * 0.6)) shown.add(last);
  return [...shown]
    .map(
      (i) =>
        `<text class="tick" x="${(PLOT.padLeft + bs[i].centre).toFixed(1)}" y="${PLOT.padTop + PLOT.h + 18}" text-anchor="middle">${esc(label(rows[i]))}</text>`,
    )
    .join("");
}

const shortDay = (iso) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** Single-series area + 2px line. One series needs no legend: the title names it. */
function lineChart(rows, pick, fmt) {
  const values = rows.map(pick);
  const scale = linearScale(Math.max(...values, 0), PLOT.h);
  const pts = linePoints(values, scale, PLOT.w).map(([x, y]) => [
    x + PLOT.padLeft,
    y + PLOT.padTop,
  ]);
  const path = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const base = PLOT.padTop + scale(0);
  const area = `${path} L${pts.at(-1)[0].toFixed(1)} ${base} L${pts[0][0].toFixed(1)} ${base} Z`;
  const last = pts.at(-1);
  const hover = rows
    .map((r, i) => {
      const [x, y] = pts[i];
      return (
        `<g class="hit"><rect x="${(x - PLOT.w / rows.length / 2).toFixed(1)}" y="${PLOT.padTop}" width="${(PLOT.w / rows.length).toFixed(1)}" height="${PLOT.h}" fill="transparent"/>` +
        `<line class="crosshair" x1="${x.toFixed(1)}" y1="${PLOT.padTop}" x2="${x.toFixed(1)}" y2="${base}"/>` +
        `<circle class="dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.5"/>` +
        `<title>${esc(shortDay(r.day))} — ${esc(fmt(pick(r)))}</title></g>`
      );
    })
    .join("");
  return `<svg viewBox="0 0 ${PLOT.padLeft + PLOT.w + 56} ${PLOT.padTop + PLOT.h + PLOT.padBottom}" role="img">
    ${gridAndTicks(scale)}
    <path class="area" d="${area}"/>
    <path class="line" d="${path}"/>
    <circle class="end-dot" cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="4.5"/>
    <text class="end-label" x="${(last[0] + 10).toFixed(1)}" y="${(last[1] + 4).toFixed(1)}">${esc(fmt(values.at(-1)))}</text>
    ${xLabels(rows, (r) => shortDay(r.day))}
    ${hover}
  </svg>`;
}

/** Columns with a 4px rounded cap and a square baseline. */
function columnChart(rows, pick, fmt, labelOf = (r) => shortDay(r.day)) {
  const values = rows.map(pick);
  const scale = linearScale(Math.max(...values, 0), PLOT.h);
  const bs = bands(rows.length, PLOT.w);
  const base = PLOT.padTop + scale(0);
  const marks = rows
    .map((r, i) => {
      const v = pick(r);
      const y = PLOT.padTop + scale(v);
      const h = Math.max(0, base - y);
      const b = bs[i];
      const r4 = Math.min(4, b.width / 2, h);
      const x = PLOT.padLeft + b.x;
      // Rounded top, square bottom — the cap is drawn as a path so the baseline stays flat.
      const d =
        h <= 0
          ? ""
          : `M${x} ${base} L${x} ${y + r4} Q${x} ${y} ${x + r4} ${y} L${x + b.width - r4} ${y} Q${x + b.width} ${y} ${x + b.width} ${y + r4} L${x + b.width} ${base} Z`;
      return (
        `<g class="hit">${d ? `<path class="bar" d="${d}"/>` : ""}` +
        `<rect x="${x.toFixed(1)}" y="${PLOT.padTop}" width="${b.width.toFixed(1)}" height="${PLOT.h}" fill="transparent"/>` +
        `<title>${esc(labelOf(r))} — ${esc(fmt(v))}</title></g>`
      );
    })
    .join("");
  return `<svg viewBox="0 0 ${PLOT.padLeft + PLOT.w + 56} ${PLOT.padTop + PLOT.h + PLOT.padBottom}" role="img">
    ${gridAndTicks(scale)}${marks}${xLabels(rows, labelOf)}
  </svg>`;
}

/** Horizontal 100% stacked bar — part-to-whole, with a 2px surface gap between segments. */
function stackedBar(entries) {
  const width = 780;
  const segs = stackLayout(entries, width, 2);
  const total = entries.reduce((n, e) => n + e.value, 0);
  const marks = segs
    .map((s, i) => {
      const pct = `${Math.round(s.share * 100)}%`;
      const text = `${s.key} ${pct}`;
      // Only label inside the segment when it genuinely fits; otherwise the legend and the
      // table carry it rather than clipping the text.
      const label = labelFits(text, s.width)
        ? `<text class="seg-label i${i + 1}" x="${(s.x + s.width / 2).toFixed(1)}" y="26" text-anchor="middle">${esc(text)}</text>`
        : labelFits(pct, s.width)
          ? `<text class="seg-label i${i + 1}" x="${(s.x + s.width / 2).toFixed(1)}" y="26" text-anchor="middle">${esc(pct)}</text>`
          : "";
      return (
        `<g class="hit"><rect class="seg s${i + 1}" x="${s.x.toFixed(1)}" y="8" width="${s.width.toFixed(1)}" height="34" rx="2"/>` +
        `${label}<title>${esc(s.key)} — ${compact(s.value)} games (${pct})</title></g>`
      );
    })
    .join("");
  const legend = entries
    .map(
      (e, i) =>
        `<span class="key"><span class="swatch s${i + 1}"></span>${esc(e.key)} <b>${compact(e.value)}</b></span>`,
    )
    .join("");
  return `<svg viewBox="0 0 ${width} 50" role="img">${marks}</svg>
    <div class="legend">${legend}<span class="key muted">total <b>${compact(total)}</b></span></div>`;
}

function statTile(label, value, sub) {
  return `<div class="tile"><div class="tile-label">${esc(label)}</div><div class="tile-value">${esc(value)}</div>${sub ? `<div class="tile-sub">${esc(sub)}</div>` : ""}</div>`;
}

function table(caption, headers, rows) {
  return `<details class="table-view"><summary>${esc(caption)}</summary><table><thead><tr>${headers
    .map((h) => `<th>${esc(h)}</th>`)
    .join("")}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table></details>`;
}

// ----------------------------------------------------------------- page

function render(m) {
  const o = m.overview;
  const daily = m.daily.slice().sort((a, b) => a.day.localeCompare(b.day));
  const recent = daily.slice(-30);
  const retention = m.retention.slice().sort((a, b) => a.cohort_day.localeCompare(b.cohort_day));
  const modes = m.modeSplit.map((r) => ({ key: r.mode, value: Number(r.games) }));

  const avgMinutes = recent.length
    ? recent.reduce((n, d) => n + Number(d.minutes_per_player || 0), 0) / recent.length
    : 0;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Chain Reaction — internal metrics</title>
<style>
  :root {
    color-scheme: light;
    --surface-1:#fcfcfb; --plane:#f9f9f7;
    --text-primary:#0b0b0b; --text-secondary:#52514e; --muted:#898781;
    --grid:#e1e0d9; --axis:#c3c2b7; --border:rgba(11,11,11,0.10);
    --s1:${PALETTE.light.s1}; --s2:${PALETTE.light.s2}; --s3:${PALETTE.light.s3};
    --i1:${readableInk(PALETTE.light.s1)}; --i2:${readableInk(PALETTE.light.s2)}; --i3:${readableInk(PALETTE.light.s3)};
  }
  @media (prefers-color-scheme: dark) {
    :root:where(:not([data-theme="light"])) {
      color-scheme: dark;
      --surface-1:#1a1a19; --plane:#0d0d0d;
      --text-primary:#ffffff; --text-secondary:#c3c2b7; --muted:#898781;
      --grid:#2c2c2a; --axis:#383835; --border:rgba(255,255,255,0.10);
      --s1:${PALETTE.dark.s1}; --s2:${PALETTE.dark.s2}; --s3:${PALETTE.dark.s3};
      --i1:${readableInk(PALETTE.dark.s1)}; --i2:${readableInk(PALETTE.dark.s2)}; --i3:${readableInk(PALETTE.dark.s3)};
    }
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--plane);color:var(--text-primary);
    font-family:system-ui,-apple-system,"Segoe UI",sans-serif;padding:32px 20px 64px}
  .wrap{max-width:1000px;margin:0 auto}
  header{margin-bottom:8px}
  h1{font-size:20px;font-weight:600;margin:0}
  .sub{color:var(--text-secondary);font-size:13px;margin-top:4px}
  .banner{margin:16px 0 0;padding:10px 14px;border:1px solid var(--border);border-radius:8px;
    background:var(--surface-1);color:var(--text-secondary);font-size:13px}
  .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:20px 0 28px}
  .tile{background:var(--surface-1);border:1px solid var(--border);border-radius:10px;padding:14px 16px}
  .tile-label{font-size:12px;color:var(--text-secondary)}
  .tile-value{font-size:26px;font-weight:600;margin-top:4px;letter-spacing:-0.01em}
  .tile-sub{font-size:11px;color:var(--muted);margin-top:2px}
  .card{background:var(--surface-1);border:1px solid var(--border);border-radius:10px;
    padding:18px 20px 12px;margin-bottom:18px}
  .card h2{font-size:14px;font-weight:600;margin:0}
  .card p{font-size:12px;color:var(--text-secondary);margin:3px 0 12px}
  svg{width:100%;height:auto;display:block;overflow:visible}
  .grid{stroke:var(--grid);stroke-width:1}
  .tick{fill:var(--muted);font-size:11px;font-variant-numeric:tabular-nums}
  .line{fill:none;stroke:var(--s1);stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
  .area{fill:var(--s1);opacity:0.10}
  .bar{fill:var(--s1)}
  .end-dot,.dot{fill:var(--s1);stroke:var(--surface-1);stroke-width:2}
  .end-label{fill:var(--text-secondary);font-size:11px;font-weight:600}
  .crosshair{stroke:var(--axis);stroke-width:1;opacity:0}
  .dot{opacity:0}
  .hit:hover .crosshair,.hit:hover .dot{opacity:1}
  .hit:hover .bar,.hit:hover .seg{filter:brightness(1.12)}
  .hit{cursor:default}
  .seg.s1{fill:var(--s1)} .seg.s2{fill:var(--s2)} .seg.s3{fill:var(--s3)}
  .seg-label{font-size:12px;font-weight:600}
  .seg-label.i1{fill:var(--i1)} .seg-label.i2{fill:var(--i2)} .seg-label.i3{fill:var(--i3)}
  .legend{display:flex;flex-wrap:wrap;gap:16px;margin:10px 0 4px;font-size:12px;color:var(--text-secondary)}
  .key{display:flex;align-items:center;gap:6px}
  .key b{color:var(--text-primary);font-weight:600}
  .swatch{width:10px;height:10px;border-radius:2px;display:inline-block}
  .swatch.s1{background:var(--s1)} .swatch.s2{background:var(--s2)} .swatch.s3{background:var(--s3)}
  .table-view{margin-top:10px;font-size:12px}
  .table-view summary{cursor:pointer;color:var(--text-secondary);padding:4px 0}
  table{border-collapse:collapse;width:100%;margin-top:8px;font-variant-numeric:tabular-nums}
  th,td{text-align:right;padding:5px 10px;border-bottom:1px solid var(--grid)}
  th:first-child,td:first-child{text-align:left}
  th{color:var(--text-secondary);font-weight:600}
</style></head>
<body><div class="wrap">
<header>
  <h1>Chain Reaction — internal metrics</h1>
  <div class="sub">Generated ${new Date().toLocaleString("en-US")}</div>
</header>
${m.demo ? `<div class="banner"><b>Sample data.</b> No backend configured — these numbers are invented so the layout can be reviewed. Add SUPABASE_URL and SUPABASE_SERVICE_KEY to <code>.env.local</code> and re-run for real figures.</div>` : ""}

<div class="kpis">
  ${statTile("Total players", compact(o.total_players ?? 0), "accounts created")}
  ${statTile("Daily active", compact(o.dau ?? 0), "played today")}
  ${statTile("Weekly active", compact(o.wau ?? 0), "last 7 days")}
  ${statTile("Monthly active", compact(o.mau ?? 0), "last 30 days")}
  ${statTile("Total play time", duration(Number(o.total_hours ?? 0)), "all players, all time")}
  ${statTile("Matches played", compact(o.total_matches ?? 0), "all time")}
</div>

<div class="card">
  <h2>Active players per day</h2>
  <p>Distinct players with any foreground time, last ${recent.length} days.</p>
  ${
    recent.length
      ? lineChart(
          recent,
          (r) => Number(r.active_players),
          (v) => `${compact(v)} players`,
        )
      : `<p class="sub">No activity recorded yet.</p>`
  }
  ${table(
    "Show as table",
    ["Day", "Active players", "Sessions"],
    recent.map((r) => [
      shortDay(r.day),
      compact(Number(r.active_players)),
      compact(Number(r.sessions)),
    ]),
  )}
</div>

<div class="card">
  <h2>Matches played per day</h2>
  <p>How much play the active players actually did.</p>
  ${
    recent.length
      ? columnChart(
          recent,
          (r) => Number(r.matches),
          (v) => `${compact(v)} matches`,
        )
      : `<p class="sub">No matches recorded yet.</p>`
  }
  ${table(
    "Show as table",
    ["Day", "Matches"],
    recent.map((r) => [shortDay(r.day), compact(Number(r.matches))]),
  )}
</div>

<div class="card">
  <h2>Minutes per active player</h2>
  <p>Average session depth — whether people are playing or only opening the app. ${avgMinutes ? `Averaging ${avgMinutes.toFixed(1)} min.` : ""}</p>
  ${
    recent.length
      ? lineChart(
          recent,
          (r) => Number(r.minutes_per_player || 0),
          (v) => `${v.toFixed(1)} min`,
        )
      : `<p class="sub">No activity recorded yet.</p>`
  }
  ${table(
    "Show as table",
    ["Day", "Minutes per player", "Play hours"],
    recent.map((r) => [
      shortDay(r.day),
      String(r.minutes_per_player ?? 0),
      String(r.active_hours ?? 0),
    ]),
  )}
</div>

<div class="card">
  <h2>Which modes get played</h2>
  <p>Share of all matches by mode, across every synced profile.</p>
  ${modes.some((x) => x.value > 0) ? stackedBar(modes) : `<p class="sub">No mode data yet.</p>`}
  ${table(
    "Show as table",
    ["Mode", "Games", "Wins", "Win rate"],
    m.modeSplit.map((r) => [
      r.mode,
      compact(Number(r.games)),
      compact(Number(r.wins)),
      Number(r.games) ? `${Math.round((Number(r.wins) / Number(r.games)) * 100)}%` : "—",
    ]),
  )}
</div>

<div class="card">
  <h2>Day-1 retention by cohort</h2>
  <p>Of the players who first played on a given day, how many came back the next day.</p>
  ${
    retention.length
      ? columnChart(
          retention,
          (r) => Number(r.day_1_retention_pct || 0),
          (v) => `${v}% came back`,
          (r) => shortDay(r.cohort_day),
        )
      : `<p class="sub">Not enough history yet.</p>`
  }
  ${table(
    "Show as table",
    ["Cohort", "New players", "Day-1 retention"],
    retention.map((r) => [
      shortDay(r.cohort_day),
      compact(Number(r.new_players)),
      `${r.day_1_retention_pct ?? 0}%`,
    ]),
  )}
</div>

</div></body></html>`;
}

const metrics = demo ? demoMetrics() : await fetchMetrics();
writeFileSync(OUT, render(metrics));
console.log(`${demo ? "Sample" : "Live"} dashboard written to ${OUT}`);
