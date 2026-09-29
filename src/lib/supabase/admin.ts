import 'server-only';

import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';

import { env } from '@/lib/env';

/**
 * Supabase client dengan SERVICE ROLE key.
 * Hanya dipakai di server oleh route yang melewati validasi sesi lebih dulu
 * (pola yang sama dengan portal: login memakai lookup partners).
 */
let cached: SupabaseClient | null = null;

export function createAdminClient(): SupabaseClient {
  if (cached) return cached;

  if (!env.supabaseUrl || !env.serviceRoleKey) {
    throw new Error('Kunci service role Supabase belum diatur (SUPABASE_SECRET_KEY).');
  }

  cached = createSupabaseClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });

  return cached;
}