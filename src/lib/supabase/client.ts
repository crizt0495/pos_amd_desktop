'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

import { env } from '@/lib/env';
import { createLocalClient } from '@/lib/supabase/local';

let client: SupabaseClient | null = null;
let remote: SupabaseClient | null = null;
let local: SupabaseClient | null = null;

/** Apakah aplikasi berjalan di desktop dengan database lokal aktif? */
export function isLocalDb(): boolean {
  if (typeof window === 'undefined') return false;
  const b = (window as unknown as { kasirproDesktop?: { localDb?: boolean; db?: unknown } }).kasirproDesktop;
  return !!b && b.localDb === true && typeof b.db === 'function';
}

/** Klien Supabase asli (selalu online) — untuk sinkronisasi & auth. */
export function createRemoteClient(): SupabaseClient {
  if (!remote) {
    remote = createBrowserClient(
      env.supabaseUrl || 'http://127.0.0.1:54321',
      env.supabaseAnonKey || 'public-anon-key',
    );
  }
  return remote;
}

/** Klien database lokal (SQLite) — untuk mode offline-first di desktop. */
function localClient(): SupabaseClient {
  if (!local) {
    local = createLocalClient({
      getUid: async () => {
        try {
          const { data } = await createRemoteClient().auth.getUser();
          return data?.user?.id ?? null;
        } catch {
          return null;
        }
      },
    });
  }
  return local;
}

/**
 * Supabase client untuk browser. Di aplikasi desktop yang mengaktifkan
 * database lokal (offline-first), kembaliannya adalah shim SQLite; selain itu
 * memakai Supabase seperti biasa.
 */
export function createClient(): SupabaseClient {
  if (typeof window !== 'undefined') {
    const b = (window as unknown as { kasirproDesktop?: { localDb?: boolean; db?: unknown } }).kasirproDesktop;
    if (b && b.localDb && b.db) return localClient();
  }
  return createRemoteClient();
}
