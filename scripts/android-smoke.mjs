#!/usr/bin/env node
/**
 * Android smoke test: drives the real app on a running emulator/device through adb and the
 * WebView's Chrome DevTools protocol (no extra dependencies — uses Node's built-in WebSocket).
 *
 *   npm run build:capacitor && npx cap sync android && (cd android && ./gradlew assembleDebug)
 *   npm run test:android            # installs the debug APK, then runs every check
 *   npm run test:android -- --no-install --serial emulator-5554
 *
 * Needs a debug build (DevTools attach only to debuggable WebViews) and `adb` on PATH or under
 * ANDROID_HOME / ANDROID_SDK_ROOT / %LOCALAPPDATA%\Android\Sdk.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const APP_ID = "com.chainreactionevolved.game";
const APK = "android/app/build/outputs/apk/debug/app-debug.apk";
const PORT = 9222;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

function findAdb() {
  const sdk =
    process.env.ANDROID_HOME ||
    process.env.ANDROID_SDK_ROOT ||
    (process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Android", "Sdk"));
  const exe = process.platform === "win32" ? "adb.exe" : "adb";
  const candidate = sdk && join(sdk, "platform-tools", exe);
  return candidate && existsSync(candidate) ? candidate : "adb";
}

const ADB = findAdb();
const serial = opt("--serial");
const adb = (...a) =>
  execFileSync(ADB, [...(serial ? ["-s", serial] : []), ...a], { encoding: "utf8" }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ DevTools client

async function connect() {
  const pid = adb("shell", "pidof", APP_ID).split(/\s+/)[0];
  if (!pid) throw new Error("app is not running");
  adb("forward", `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pid}`);
  const pages = await (await fetch(`http://localhost:${PORT}/json`)).json();
  const page = pages.find((p) => p.type === "page");
  if (!page) throw new Error("no debuggable WebView page (is this a debug build?)");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error("DevTools socket failed"));
  });
  let id = 0;
  const waiting = new Map();
  const exceptions = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && waiting.has(msg.id)) {
      waiting.get(msg.id)(msg);
      waiting.delete(msg.id);
    } else if (msg.method === "Runtime.exceptionThrown") {
      exceptions.push(msg.params.exceptionDetails?.exception?.description ?? "exception");
    }
  };
  const send = (method, params = {}) =>
    new Promise((res) => {
      const n = ++id;
      waiting.set(n, res);
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  await send("Runtime.enable");
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.result.exceptionDetails)
      throw new Error(r.result.exceptionDetails.exception?.description);
    return r.result.result.value;
  };
  /**
   * Taps the centre of the first element matching a JS expression, as a real touch gesture.
   * (A scripted element.click() carries no user activation, and Chrome then ignores the history
   * entries the page pushed — so Back would behave differently from what a player sees.)
   */
  const tap = async (findExpression) => {
    const rect = await evaluate(`(()=>{const el=(${findExpression});if(!el)return null;
      el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();
      return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    if (!rect) return false;
    await new Promise((r) => setTimeout(r, 150)); // let scrollIntoView settle
    const again =
      await evaluate(`(()=>{const el=(${findExpression});const r=el.getBoundingClientRect();
      return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    await send("Input.synthesizeTapGesture", {
      x: again.x,
      y: again.y,
      gestureSourceType: "touch",
    });
    return true;
  };
  return { evaluate, tap, exceptions, close: () => ws.close() };
}

// ------------------------------------------------------------------------- checks

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ok   ${name}`);
  } catch (e) {
    results.push({ name, ok: false, why: e.message });
    console.log(`  FAIL ${name}\n       ${e.message}`);
  }
}
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const btn = (re) => `[...document.querySelectorAll('button')].find(b=>${re}.test(b.innerText))`;
const cellBtn = (extra = "true") =>
  `[...document.querySelectorAll("button[aria-label^='Row ']")].filter(b=>!b.disabled&&${extra}).at(0)`;
const text = `document.body.innerText.replace(/\\n+/g,' ')`;

async function main() {
  console.log(`adb: ${ADB}${serial ? ` (serial ${serial})` : ""}`);
  if (!flag("--no-install")) {
    if (!existsSync(APK)) throw new Error(`${APK} not found — build the debug APK first`);
    console.log("installing debug APK…");
    adb("install", "-r", APK);
  }
  adb("shell", "am", "force-stop", APP_ID);
  adb("shell", "monkey", "-p", APP_ID, "-c", "android.intent.category.LAUNCHER", "1");
  await sleep(6000);

  const cdp = await connect();
  const { evaluate, tap } = cdp;
  const wait = (ms) => sleep(ms);
  console.log("running checks:");

  await check("WebView is supported by the compatibility guard", async () => {
    expect((await evaluate("window.__crSupported")) === true, "guard reported unsupported WebView");
  });

  await check("home screen renders with the main menu", async () => {
    expect(/CHAIN\s*REACTION/i.test(await evaluate(text)), "title missing");
    expect(await evaluate(`/QUICK PLAY/i.test(${text})`), "Quick Play missing");
  });

  await check("no horizontal page overflow on the home screen", async () => {
    expect(
      await evaluate("document.documentElement.scrollWidth <= innerWidth"),
      "page is wider than the viewport",
    );
  });

  await check("Back from Setup returns Home; Back from Home would exit", async () => {
    await tap(btn("/QUICK PLAY/i"));
    await wait(800);
    expect(await evaluate(`/MATCH SETUP/i.test(${text})`), "did not reach Setup");
    adb("shell", "input", "keyevent", "4");
    await wait(900);
    expect(await evaluate(`/QUICK PLAY/i.test(${text})`), "Back did not return Home");
  });

  await check("classic match vs CPU starts at the top with distinct orb colours", async () => {
    await tap(btn("/QUICK PLAY/i"));
    await wait(700);
    await tap(btn("/^PLAY /i"));
    await wait(2500);
    expect(await evaluate("scrollY === 0"), "game did not start scrolled to the top");
    await tap(cellBtn());
    await wait(4500);
    const fills = await evaluate(`JSON.stringify([...document.querySelectorAll('svg stop')]
      .map(s=>getComputedStyle(s).stopColor).filter(c=>c && !/^rgba?\\(0, 0, 0/.test(c)).length)`);
    expect(Number(fills) > 0, "orb gradients resolved to black/none (colour syntax unsupported?)");
  });

  await check("undo rewinds a move and costs one undo", async () => {
    expect(await evaluate(`/UNDO 3/.test(${text})`), "undo budget not shown");
    await tap(btn("/UNDO 3/"));
    await wait(600);
    expect(await evaluate(`/UNDO 2/.test(${text})`), "undo was not spent");
    expect(await evaluate(`/TURN\\s*1\\b/.test(${text})`), "turn did not rewind to 1");
  });

  await check("Back leaves the match to Setup, then Home", async () => {
    adb("shell", "input", "keyevent", "4");
    await wait(900);
    expect(await evaluate(`/MATCH SETUP/i.test(${text})`), "Back from match did not reach Setup");
    adb("shell", "input", "keyevent", "4");
    await wait(900);
    expect(await evaluate(`/QUICK PLAY/i.test(${text})`), "second Back did not reach Home");
  });

  await check(
    "Hard bot on the biggest board never freezes the UI (longest stall < 400 ms)",
    async () => {
      await evaluate(
        `window.__long=[];new PerformanceObserver(l=>l.getEntries().forEach(e=>window.__long.push(e.duration))).observe({entryTypes:['longtask']});1`,
      );
      await tap(btn("/QUICK PLAY/i"));
      await wait(700);
      await tap(btn("/^ARENA/i"));
      await wait(500);
      await tap(btn("/^POWER GRID/i"));
      await wait(400);
      await tap(btn("/^HARD/i"));
      await wait(300);
      await tap(btn("/^PLAY /i"));
      await wait(2500);
      const readTurn = async () =>
        Number(await evaluate(`(${text}.match(/TURN\\s*(\\d+)/)||[])[1]`));
      for (let move = 0; move < 4; move++) {
        // A tap can land on a tile or between cells; retry until the turn really advances.
        for (let attempt = 0; attempt < 4; attempt++) {
          const before = await readTurn();
          await tap(
            `(()=>{const c=[...document.querySelectorAll("button[aria-label^='Row ']")]
            .filter(b=>!b.disabled&&/, empty/.test(b.getAttribute('aria-label')));
            return c[Math.floor(Math.random()*c.length)]})()`,
          );
          await wait(6000); // the bot thinks and animates its reply
          if ((await readTurn()) > before) break;
        }
      }
      const worst = await evaluate("Math.max(0,...window.__long)");
      expect(worst < 400, `longest main-thread stall was ${Math.round(worst)} ms`);
      const finalTurn = await readTurn();
      expect(finalTurn >= 5, `the game did not progress (turn ${finalTurn})`);
    },
  );

  await check("no uncaught JavaScript exceptions during the run", async () => {
    expect(cdp.exceptions.length === 0, cdp.exceptions.join(" | "));
  });

  cdp.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error("smoke test could not run:", e.message);
  process.exit(2);
});
