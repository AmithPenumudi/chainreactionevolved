import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/*
 * Supabase connection.
 *
 * Every export here degrades to "no backend" rather than throwing: the game must play exactly
 * the same offline, on a fork with no project of its own, and in CI. Nothing in the game is
 * allowed to await a network call before the player can press a button.
 *
 * The publishable key is public by design — it ships inside the Android bundle, so treating it
 * as a secret would be theatre. Row-level security is what actually protects the data, and
 * nothing is granted to the `anon` role (see supabase/migrations/0001_player_data.sql).
 */

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** True when a backend is configured at build time. Vite inlines these, so this is static. */
export const backendConfigured = Boolean(URL && KEY);

let client: SupabaseClient | null = null;

export function getClient(): SupabaseClient | null {
  if (!backendConfigured) return null;
  if (!client) {
    client = createClient(URL!, KEY!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // The Capacitor WebView is a normal browser context, so localStorage is the right
        // store; there is no OAuth redirect to parse in the anonymous flow.
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}

/**
 * The player's user id, creating an anonymous account on first use.
 *
 * Called lazily — on the first finished match, not at launch — because an anonymous user is
 * billed as a monthly active user, and someone who opens the app once should not cost one.
 * Returns null on any failure: being offline is the normal case, not an error.
 */
export async function ensureUserId(): Promise<string | null> {
  const supabase = getClient();
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session?.user?.id) return data.session.user.id;
    const { data: created, error } = await supabase.auth.signInAnonymously();
    if (error) return null;
    return created.user?.id ?? null;
  } catch {
    return null;
  }
}

/** Whether this session is signed in at all (anonymous counts). */
export async function currentUserId(): Promise<string | null> {
  const supabase = getClient();
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.user?.id ?? null;
  } catch {
    return null;
  }
}
