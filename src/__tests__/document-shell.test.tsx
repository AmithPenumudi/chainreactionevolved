import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { getRouter } from "@/router";
import { routeTree } from "@/routeTree.gen";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/*
 * The structural precondition for the freeze that shipped in the first closed-testing build.
 *
 * Mounting the router into a <div> while the root route still renders its <html>/<head>/<body>
 * shell makes React 19 adopt the document's real elements as *singletons*. Once that happens it
 * also binds its delegated listeners to the document while the root container stays the <div>,
 * and `dispatchEventForPluginEventSystem` can never reconcile the two — the first tap spins the
 * renderer forever.
 *
 * The loop itself cannot be asserted directly: reproducing it means dispatching an event and
 * never getting control back, which would hang the suite rather than fail it. The adoption that
 * causes it is observable and deterministic, so that is what is pinned here — if the Android
 * entry ever renders the shell again, the first test fails.
 */

type ShellOption = { shellComponent?: unknown };

let host: HTMLDivElement;
let root: Root | null = null;
let originalShell: unknown;

beforeEach(() => {
  originalShell = (routeTree.options as ShellOption).shellComponent;
  host = document.createElement("div");
  host.id = "root";
  document.body.appendChild(host);
});

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  host.remove();
  // getRouter mutates the shared route tree; put it back for whatever runs next.
  (routeTree.options as ShellOption).shellComponent = originalShell;
});

/** Mounts the app the way an entry point would, and reports what it did to the document. */
async function mountInto(documentShell: boolean) {
  const headBefore = document.head.children.length;
  const titlesBefore = document.head.querySelectorAll("title").length;
  const bodyBefore = document.body.children.length;

  const router = getRouter({ documentShell });
  root = createRoot(host);
  await act(async () => {
    root!.render(<RouterProvider router={router} />);
  });

  return {
    headChildrenAdded: document.head.children.length - headBefore,
    titlesAdded: document.head.querySelectorAll("title").length - titlesBefore,
    bodyChildrenAdded: document.body.children.length - bodyBefore,
    /** Did anything render inside the container we actually asked React to use? */
    hostHasContent: host.children.length > 0,
  };
}

describe("mounting into a <div>, the way capacitor-src/main.tsx does", () => {
  it("renders the app and leaves the document alone when the shell is off", async () => {
    const after = await mountInto(false);

    // The whole point: React owns the <div> and nothing above it.
    expect(after.headChildrenAdded).toBe(0);
    expect(after.titlesAdded).toBe(0);
    expect(after.bodyChildrenAdded).toBe(0);
    expect(after.hostHasContent).toBe(true);
  });

  it("reaches up into the real <head> when the shell is on — the shipped bug", async () => {
    const after = await mountInto(true);

    // Not an aspiration, a record of the defect: rendering <html>/<head>/<body> into a <div>
    // makes React adopt the document's own elements instead of creating new ones. On a device
    // that also moves its delegated listeners to the document and wedges event dispatch.
    //
    // If a future React or router stops doing this, this test fails loudly — revisit the trap in
    // ARCHITECTURE.md rather than just deleting the assertion.
    expect(after.headChildrenAdded).toBeGreaterThan(0);
    expect(after.titlesAdded).toBe(1);
  });
});
