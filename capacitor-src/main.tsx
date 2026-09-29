import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { getRouter } from "@/router";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { browserSupportsApp, renderUnsupportedNotice } from "@/lib/compat";
import { installCrashHandlers } from "@/lib/crash-log";
import "@/styles.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element not found");

installCrashHandlers();

if (!browserSupportsApp()) {
  // A too-old WebView would render a blank/black page; say what to do instead.
  renderUnsupportedNotice(rootEl);
} else {
  const router = getRouter();
  createRoot(rootEl).render(
    <StrictMode>
      <ErrorBoundary>
        <RouterProvider router={router} />
      </ErrorBoundary>
    </StrictMode>,
  );
}
