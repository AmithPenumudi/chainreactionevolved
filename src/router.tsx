import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export interface RouterOptions {
  /**
   * Whether the root route renders its `shellComponent` — the `<html>/<head>/<body>` document
   * shell in `routes/__root.tsx`.
   *
   * The web build is server-rendered and hydrates the whole document, so it needs the shell and
   * this stays true. The Android build is client-only: `capacitor-src/index.html` already
   * supplies the document, and the app is mounted into the `<div id="root">` inside it.
   *
   * Rendering the shell there as well is not merely redundant, it wedges the app. React 19
   * treats `<html>`, `<head>` and `<body>` as *singletons*: instead of creating elements it
   * adopts the real ones, and attaches its delegated event listeners to the document. The root
   * container, however, is still that `<div>`. `dispatchEventForPluginEventSystem` then walks
   * `div#root -> body -> html -> #document` looking for a container matching the one the
   * listener is bound to; it finds a singleton fiber, jumps to it, climbs back to the host root,
   * resets to `div#root` and starts again. Its only exit is `container === targetContainer`,
   * which can never hold, so the first tap spins the renderer at 100% CPU forever — no error, no
   * crash, just a frozen page. Dropping the shell keeps the root container and the listener
   * target the same node, and the traversal terminates immediately.
   */
  documentShell?: boolean;
}

export const getRouter = ({ documentShell = true }: RouterOptions = {}) => {
  const queryClient = new QueryClient();

  if (!documentShell) {
    // Mutating the generated root route is the only hook the router gives us: `shellComponent`
    // is read off `route.options` at render time, and the route tree is a module singleton
    // created at import. Safe because a process only ever builds one router.
    // `shellComponent` is a *root* route option, but the generated tree types `options` as the
    // narrower RouteOptions, so reach it through a precise cast rather than widening to `any`.
    (routeTree.options as { shellComponent?: unknown }).shellComponent = undefined;
  }

  const router = createRouter({
    routeTree,
    context: { queryClient },
    // Screens are React state inside one route, so per-location scroll restoration only ever
    // re-applies the previous screen's offset (see Screens in routes/index.tsx).
    scrollRestoration: false,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
