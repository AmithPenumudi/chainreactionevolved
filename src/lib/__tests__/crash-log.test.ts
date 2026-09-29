import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearCrashLog,
  formatDebugInfo,
  getCrashLog,
  installCrashHandlers,
  MAX_CRASHES,
  recordCrash,
  resetCrashHandlersForTests,
} from "../crash-log";

beforeEach(() => {
  window.localStorage.clear();
  resetCrashHandlersForTests();
});

describe("crash log", () => {
  it("records message, stack and source", () => {
    recordCrash(new Error("kaboom"), "boundary");
    const [e] = getCrashLog();
    expect(e.message).toBe("kaboom");
    expect(e.source).toBe("boundary");
    expect(e.stack).toContain("kaboom");
    expect(e.at).toBeGreaterThan(0);
  });

  it("copes with non-Error values (strings, objects, undefined, circular)", () => {
    recordCrash("plain text");
    recordCrash({ code: 7 });
    recordCrash(undefined);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    recordCrash(circular);
    const log = getCrashLog();
    expect(log).toHaveLength(4);
    expect(log[0].message).toBe("plain text");
    expect(log[1].message).toContain("7");
    for (const e of log) expect(typeof e.message).toBe("string");
  });

  it("keeps only the newest entries", () => {
    for (let i = 0; i < MAX_CRASHES + 5; i++) recordCrash(new Error(`e${i}`));
    const log = getCrashLog();
    expect(log).toHaveLength(MAX_CRASHES);
    expect(log[0].message).toBe("e5");
    expect(log.at(-1)!.message).toBe(`e${MAX_CRASHES + 4}`);
  });

  it("truncates huge messages and stacks", () => {
    recordCrash(new Error("x".repeat(100_000)));
    const [e] = getCrashLog();
    expect(JSON.stringify(e).length).toBeLessThan(5000);
  });

  it("survives a corrupt or foreign stored value", () => {
    for (const junk of ["{", "null", "5", '{"a":1}', '[1,"x",null,{"message":3}]']) {
      window.localStorage.setItem("cr-crashlog-v1", junk);
      expect(() => getCrashLog()).not.toThrow();
      expect(getCrashLog()).toEqual([]);
      expect(() => recordCrash(new Error("after junk"))).not.toThrow();
    }
  });

  it("never throws when storage is blocked", () => {
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Quota");
    });
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Denied");
    });
    expect(() => recordCrash(new Error("x"))).not.toThrow();
    expect(getCrashLog()).toEqual([]);
    expect(() => clearCrashLog()).not.toThrow();
    set.mockRestore();
    get.mockRestore();
  });

  it("clear empties the log", () => {
    recordCrash(new Error("a"));
    clearCrashLog();
    expect(getCrashLog()).toEqual([]);
  });
});

describe("global handlers", () => {
  it("record window errors and unhandled rejections; installing twice does not double-log", () => {
    installCrashHandlers();
    installCrashHandlers();
    window.dispatchEvent(
      new ErrorEvent("error", { error: new Error("uncaught"), message: "uncaught" }),
    );
    const rejection = new Event("unhandledrejection") as Event & { reason: unknown };
    rejection.reason = new Error("rejected");
    window.dispatchEvent(rejection);
    const log = getCrashLog();
    expect(log.map((e) => e.message)).toEqual(["uncaught", "rejected"]);
    expect(log.map((e) => e.source)).toEqual(["error", "unhandledrejection"]);
  });
});

describe("formatDebugInfo", () => {
  it("includes device details and every recorded error", () => {
    recordCrash(new Error("first"));
    recordCrash("second");
    const text = formatDebugInfo();
    expect(text).toContain("userAgent:");
    expect(text).toContain("viewport:");
    expect(text).toContain("recorded errors: 2");
    expect(text).toContain("first");
    expect(text).toContain("second");
  });

  it("works with an empty log", () => {
    expect(formatDebugInfo()).toContain("recorded errors: 0");
  });
});
