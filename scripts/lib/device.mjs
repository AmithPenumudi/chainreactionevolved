/**
 * Talks to a running Android emulator or device: adb, plus a minimal Chrome DevTools client
 * for driving the app's WebView.
 *
 * Shared by the smoke test and the screenshot capture. No dependencies — Node's built-in
 * WebSocket and fetch are enough, and the alternative (puppeteer/appium) would be a very large
 * dependency for two scripts.
 *
 * DevTools only attaches to a *debuggable* WebView, so everything here needs a debug build.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export const APP_ID = "com.chainreactionevolved.game";

function findAdb() {
  const sdk =
    process.env.ANDROID_HOME ||
    process.env.ANDROID_SDK_ROOT ||
    (process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Android", "Sdk"));
  const exe = process.platform === "win32" ? "adb.exe" : "adb";
  const candidate = sdk && join(sdk, "platform-tools", exe);
  return candidate && existsSync(candidate) ? candidate : "adb";
}

export const ADB = findAdb();

/** Runs adb and returns trimmed stdout as text. */
export function makeAdb(serial) {
  return (...a) =>
    execFileSync(ADB, [...(serial ? ["-s", serial] : []), ...a], { encoding: "utf8" }).trim();
}

/** Runs adb and returns raw stdout as a Buffer — for `exec-out screencap -p`. */
export function makeAdbBinary(serial) {
  return (...a) =>
    execFileSync(ADB, [...(serial ? ["-s", serial] : []), ...a], {
      encoding: "buffer",
      maxBuffer: 64 * 1024 * 1024,
    });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Finds the first element matching `re` by its text, as a JS expression. */
export const btn = (re) =>
  `[...document.querySelectorAll('button')].find(b=>${re}.test(b.innerText))`;

export const bodyText = `document.body.innerText.replace(/\\n+/g,' ')`;

/**
 * Attaches to the app's WebView and returns { evaluate, tap, exceptions, close }.
 */
export async function connect({ adb, port = 9222 } = {}) {
  const pid = adb("shell", "pidof", APP_ID).split(/\s+/)[0];
  if (!pid) throw new Error("app is not running");
  adb("forward", `tcp:${port}`, `localabstract:webview_devtools_remote_${pid}`);
  const pages = await (await fetch(`http://localhost:${port}/json`)).json();
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
    if (r.result.exceptionDetails) {
      throw new Error(r.result.exceptionDetails.exception?.description);
    }
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
    await sleep(150); // let scrollIntoView settle
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
