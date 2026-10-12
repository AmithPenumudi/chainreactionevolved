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
  /**
   * Sends a DevTools command, rejecting if the device does not answer.
   *
   * The timeout is not belt-and-braces. A renderer stuck in an infinite loop never services the
   * protocol again, so without it every caller waits forever and a wedged WebView looks like a
   * hung script instead of a failing test — which is exactly how the document-shell freeze got
   * past the smoke test and into a release. Some commands are also simply unimplemented on newer
   * WebViews and never reply at all (see `tap`).
   */
  const send = (method, params = {}, timeoutMs = 20_000) =>
    new Promise((res, rej) => {
      const n = ++id;
      const timer = setTimeout(() => {
        waiting.delete(n);
        rej(
          new Error(
            `DevTools did not answer ${method} within ${timeoutMs} ms — ` +
              `the renderer is wedged, or the command is unsupported on this WebView`,
          ),
        );
      }, timeoutMs);
      waiting.set(n, (v) => {
        clearTimeout(timer);
        res(v);
      });
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
   * Sends a real touch down/up pair at viewport coordinates, in CSS pixels.
   *
   * `Input.dispatchTouchEvent` rather than `Input.synthesizeTapGesture`: the latter never
   * answers on WebView 153 (measured on a Pixel 9 Pro — the call times out and no tap is
   * delivered), so every tap silently did nothing. It also matters for what the tests can
   * *catch*: a dispatched touch reproduced the document-shell freeze exactly as a finger does,
   * where the synthesized gesture did not.
   */
  const touchAt = async (x, y) => {
    await send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y, radiusX: 8, radiusY: 8, force: 1, id: 1 }],
    });
    await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
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
    await touchAt(again.x, again.y);
    return true;
  };

  /**
   * Taps viewport coordinates directly, scrolling nothing.
   *
   * `tap` centres its target first, which is what you want for driving the app but ruins any
   * measurement of scrolling — it moves the page before every tap. Use this when the scroll
   * position is the thing under test.
   */
  const tapAt = async (x, y) => {
    await touchAt(x, y);
  };

  /** Taps an element where it currently sits, or returns false if it is not on screen. */
  const tapWhereItIs = async (findExpression) => {
    const rect = await evaluate(`(()=>{const el=(${findExpression});if(!el)return null;
      const r=el.getBoundingClientRect();
      if(r.top<0||r.bottom>innerHeight||r.left<0||r.right>innerWidth)return null;
      return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    if (!rect) return false;
    await tapAt(rect.x, rect.y);
    return true;
  };

  /**
   * Taps an element with a tap the system delivers — `adb shell input tap`, the same path a
   * finger takes — rather than anything injected through DevTools.
   *
   * Everything else here drives the WebView from inside its own debugger. That is convenient,
   * but it means a whole class of failure never gets exercised: the document-shell freeze wedged
   * the renderer on any genuine touch and the smoke test sailed past it. One check driven this
   * way keeps the suite honest.
   *
   * Coordinates come back in CSS pixels and `input tap` wants device pixels, so the rect is
   * scaled by the ratio of the display to the layout viewport.
   */
  const nativeTap = async (findExpression) => {
    const r = await evaluate(`(()=>{const el=(${findExpression});if(!el)return null;
      el.scrollIntoView({block:'center'});return true})()`);
    if (!r) return false;
    await sleep(250); // re-measure after the scroll, or the rect is the pre-scroll one
    const box = await evaluate(`(()=>{const el=(${findExpression});if(!el)return null;
      const b=el.getBoundingClientRect();
      return {x:b.left+b.width/2,y:b.top+b.height/2,w:innerWidth,h:innerHeight}})()`);
    if (!box) return false;
    const size = adb("shell", "wm", "size");
    const m = /Override size: (\d+)x(\d+)/.exec(size) ?? /Physical size: (\d+)x(\d+)/.exec(size);
    if (!m) throw new Error(`could not read the display size from: ${size}`);
    const [sw, sh] = m.slice(1).map(Number);
    adb(
      "shell",
      "input",
      "tap",
      String(Math.round((box.x / box.w) * sw)),
      String(Math.round((box.y / box.h) * sh)),
    );
    return true;
  };

  return {
    evaluate,
    tap,
    tapAt,
    tapWhereItIs,
    touchAt,
    nativeTap,
    exceptions,
    close: () => ws.close(),
  };
}
