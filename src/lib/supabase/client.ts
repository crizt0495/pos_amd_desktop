'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

import { env } from '@/lib/env';

let client: SupabaseClient | null = null;

/** Supabase client untuk browser — semua query mengikuti RLS. */
export function createClient(): SupabaseClient {
  if (!client) {
    client = createBrowserClient(
      env.supabaseUrl || 'http://127.0.0.1:54321',
      env.supabaseAnonKey || 'public-anon-key',
    );
  }
  return client;
}