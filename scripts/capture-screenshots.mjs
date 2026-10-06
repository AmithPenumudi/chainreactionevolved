#!/usr/bin/env node
/**
 * Captures Play Store screenshots from the app running on an emulator or device.
 *
 *   npm run store-screenshots
 *   npm run store-screenshots -- --serial emulator-5554 --keep-status-bar
 *
 * Drives the real app rather than mocking screens, so what ships to the listing is what a
 * player actually sees. Needs the debug APK installed and running (DevTools only attaches to a
 * debuggable WebView) — the store build is identical in layout.
 *
 * The status bar is cropped off by default: it carries the emulator's fake clock and battery,
 * which look wrong in a listing. Cropping is done here, on the captured pixels, rather than by
 * changing any setting on the device.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { APP_ID, btn, connect, makeAdb, makeAdbBinary, sleep, bodyText } from "./lib/device.mjs";
import { Canvas, cropToAspect, decodePNG, encodePNG } from "./lib/png.mjs";

const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const flag = (name) => args.includes(name);

const serial = opt("--serial");
const adb = makeAdb(serial);
const adbBinary = makeAdbBinary(serial);

const outDir = fileURLToPath(new URL("../store/screenshots/", import.meta.url));
mkdirSync(outDir, { recursive: true });

/**
 * The system bar insets in px, so the status bar and the gesture pill can be cropped away.
 *
 * Read from the window manager's own decor insets for the unrotated display, which is reported
 * as `configInsets=[left,top][right,bottom]`.
 */
function systemBarInsets() {
  try {
    const dump = adb("shell", "dumpsys", "window", "displays");
    const m = /ROTATION_0=\{[^}]*configInsets=\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(dump);
    if (m) return { top: Number(m[2]), bottom: Number(m[4]) };
  } catch {
    // fall through to no cropping — a screenshot with chrome beats no screenshot
  }
  return { top: 0, bottom: 0 };
}

const insets = flag("--keep-status-bar") ? { top: 0, bottom: 0 } : systemBarInsets();

let index = 0;
function capture(name) {
  const raw = adbBinary("exec-out", "screencap", "-p");
  const img = decodePNG(raw);
  // Guard against a nonsensical inset reading eating the whole screenshot.
  const top = Math.min(insets.top, Math.floor(img.height / 4));
  const bottom = Math.min(insets.bottom, Math.floor(img.height / 4));
  const height = img.height - top - bottom;
  const canvas = new Canvas(img.width, height);
  canvas.drawImage(img, 0, 0, img.width, height, {
    sx: 0,
    sy: top,
    sw: img.width,
    sh: height,
  });
  // Play only counts a screenshot toward promotion eligibility at exactly 9:16; a phone capture
  // is taller than that even after the system bars come off.
  const framed = cropToAspect(canvas, 9 / 16);
  const file = join(outDir, `${String(++index).padStart(2, "0")}-${name}.png`);
  const png = encodePNG(framed);
  writeFileSync(file, png);
  console.log(
    `  ${String(index).padStart(2, "0")}  ${name.padEnd(18)} ${framed.width}x${framed.height}  ${(png.length / 1024).toFixed(0)} kB`,
  );
}

async function main() {
  adb("shell", "am", "force-stop", APP_ID);
  adb("shell", "monkey", "-p", APP_ID, "-c", "android.intent.category.LAUNCHER", "1");
  await sleep(6000);

  const { evaluate, tap } = await connect({ adb });

  const onHome = async () => /QUICK PLAY/.test(await evaluate(bodyText));

  /**
   * Walks back to the home screen using the app's own back control.
   *
   * Deliberately NOT the hardware Back key: pressing it one time too many on Home leaves the
   * app, which tears down the WebView and silently kills this script's DevTools connection —
   * exactly what happened when this was written against a fixed number of key presses.
   */
  const goHome = async () => {
    for (let i = 0; i < 6 && !(await onHome()); i++) {
      if (!(await tap(btn("/^←/")))) break;
      await sleep(800);
    }
    if (!(await onHome())) throw new Error("could not get back to the home screen");
  };

  console.log(`capturing to ${outDir}`);
  if (insets.top || insets.bottom) {
    console.log(`  (cropping ${insets.top}px status bar, ${insets.bottom}px gesture bar)`);
  }

  // -------------------------------------------------------------- home
  await sleep(600);
  capture("home");

  // -------------------------------------------------------------- a real match
  await tap(btn("/QUICK PLAY/"));
  await sleep(900);
  capture("setup");

  // The start control is labelled for the chosen mode — "PLAY CLASSIC →", not "START".
  if (!(await tap(btn("/^PLAY (CLASSIC|ABILITIES|ARENA)/")))) {
    throw new Error("could not find the button that starts a match");
  }
  await sleep(1800);
  if (await onHome()) throw new Error("expected a match to have started");

  // Play enough moves that the board shows a genuine mid-game position rather than an empty
  // grid. Cells are addressed by their accessibility label (1-based row/column) so the same
  // few cells get stacked toward critical mass and actually set off chains — picking the
  // "nth enabled button" instead would wander, because ownership changes which cells are
  // tappable between turns.
  const cell = (row, col) =>
    `document.querySelector("button[aria-label^='Row ${row}, column ${col},']")`;

  /** The bot's turn disables every cell; wait for control to come back before tapping. */
  const waitForTurn = async (ms = 10000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const mine = await evaluate(
        `[...document.querySelectorAll("button[aria-label^='Row ']")].some(b=>!b.disabled)`,
      );
      if (mine) return true;
      await sleep(250);
    }
    return false;
  };

  // A corner cluster (critical mass 2 in the corner, 3 on an edge) fills quickly and pops,
  // which is the thing worth showing in a store screenshot.
  const moves = [
    [1, 1],
    [1, 2],
    [2, 1],
    [2, 2],
    [1, 2],
    [2, 2],
    [3, 2],
    [2, 3],
    [3, 3],
    [2, 2],
    [3, 3],
    [4, 3],
  ];
  for (const [row, col] of moves) {
    if (!(await waitForTurn())) break;
    if (!(await tap(cell(row, col)))) continue; // that cell is the bot's now; try the next
    await sleep(650); // let the chain animate
  }
  await sleep(1200);
  capture("match");
  await goHome();

  // -------------------------------------------------------------- the other screens
  for (const [label, name] of [
    ["/PUZZLES/", "puzzles"],
    ["/CHALLENGES/", "challenges"],
    ["/PROFILE/", "profile"],
    ["/HOW TO PLAY/", "how-to-play"],
  ]) {
    if (!(await tap(btn(label)))) {
      console.log(`  -- ${name}: button not found, skipped`);
      continue;
    }
    await sleep(1400);
    capture(name);
    await goHome();
  }

  console.log(`\n${index} screenshots written.`);
  console.log("Play needs at least 2 phone screenshots; 4-8 is typical.");
  process.exit(0);
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
