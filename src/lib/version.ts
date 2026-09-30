/**
 * The release this build came from — the same string as the Android `versionName` and
 * package.json's `version`, injected at build time by every Vite config.
 *
 * A bug report that does not name a version is most of the way to useless, so this is read by
 * the debug-info block and shown in Settings.
 */

declare const __APP_VERSION__: string | undefined;

/** Falls back only in environments that never ran through a Vite config (e.g. a bare `tsx`). */
export const APP_VERSION: string =
  typeof __APP_VERSION__ === "string" && __APP_VERSION__.length > 0 ? __APP_VERSION__ : "unknown";
