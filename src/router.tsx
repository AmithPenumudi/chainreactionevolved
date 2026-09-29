import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient();

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
