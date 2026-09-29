import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ErrorBoundary } from "../ErrorBoundary";
import { getCrashLog } from "@/lib/crash-log";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.localStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  vi.spyOn(console, "error").mockImplementation(() => {}); // React logs caught render errors
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

function Bomb({ armed }: { armed: boolean }) {
  if (armed) throw new Error("render exploded");
  return <p>all good</p>;
}

const button = (label: RegExp) =>
  [...host.querySelectorAll("button")].find((b) => label.test(b.textContent ?? ""))!;

describe("ErrorBoundary", () => {
  it("renders children untouched when nothing fails", async () => {
    await act(async () =>
      root.render(
        <ErrorBoundary>
          <Bomb armed={false} />
        </ErrorBoundary>,
      ),
    );
    expect(host.textContent).toBe("all good");
    expect(host.querySelector("[role='alert']")).toBeNull();
  });

  it("shows a recovery screen for a render error and writes it to the crash log", async () => {
    await act(async () =>
      root.render(
        <ErrorBoundary>
          <Bomb armed />
        </ErrorBoundary>,
      ),
    );
    expect(host.querySelector("[role='alert']")).not.toBeNull();
    expect(host.textContent).toContain("Something went wrong");
    expect(button(/TRY AGAIN/)).toBeDefined();
    expect(button(/RELOAD/)).toBeDefined();
    const log = getCrashLog();
    expect(log).toHaveLength(1);
    expect(log[0].source).toBe("boundary");
    expect(log[0].message).toBe("render exploded");
    expect(log[0].stack).toContain("component stack");
  });

  it("TRY AGAIN remounts the children (recovers once the cause is gone)", async () => {
    let armed = true;
    const onReset = vi.fn(() => {
      armed = false;
    });
    function Child() {
      return <Bomb armed={armed} />;
    }
    await act(async () =>
      root.render(
        <ErrorBoundary onReset={onReset}>
          <Child />
        </ErrorBoundary>,
      ),
    );
    expect(host.textContent).toContain("Something went wrong");
    await act(async () => button(/TRY AGAIN/).click());
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(host.textContent).toBe("all good");
  });

  it("if the child keeps failing, TRY AGAIN shows the recovery screen again instead of looping", async () => {
    await act(async () =>
      root.render(
        <ErrorBoundary>
          <Bomb armed />
        </ErrorBoundary>,
      ),
    );
    await act(async () => button(/TRY AGAIN/).click());
    expect(host.textContent).toContain("Something went wrong");
    expect(getCrashLog().length).toBe(2);
  });

  it("only the failing subtree is replaced; siblings outside the boundary keep working", async () => {
    function Page() {
      const [n, setN] = useState(0);
      return (
        <div>
          <button onClick={() => setN(n + 1)}>count {n}</button>
          <ErrorBoundary>
            <Bomb armed />
          </ErrorBoundary>
        </div>
      );
    }
    await act(async () => root.render(<Page />));
    expect(host.textContent).toContain("count 0");
    await act(async () => button(/count/).click());
    expect(host.textContent).toContain("count 1");
    expect(host.textContent).toContain("Something went wrong");
  });
});
