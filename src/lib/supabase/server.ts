import 'server-only';

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { env } from '@/lib/env';

/** Supabase client untuk Server Component & Route Handler (sesi via cookie). */
export function createClient() {
  const cookieStore = cookies();

  return createServerClient(env.supabaseUrl || 'http://127.0.0.1:54321', env.supabaseAnonKey || 'public-anon-key', {
    cookies: {
      getAll() {
        try {
          return cookieStore.getAll().map((c) => ({ name: c.name, value: c.value }));
        } catch {
          return [];
        }
      },
      setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Di Server Component cookie tidak bisa di-set — normal.
        }
      },
    },
  });
}