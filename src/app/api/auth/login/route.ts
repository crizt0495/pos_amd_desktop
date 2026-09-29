import { NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/login — login dengan USERNAME (atau email) + password.
 *
 * Menerima dua bentuk body:
 *   1. form-urlencoded  (halaman login server-rendered) -> redirect 303
 *   2. application/json (klien API)                     -> JSON {ok,message}
 *
 * Alur (sama dengan KasirPro Portal, database Supabase sama):
 *   1. kalau input berisi "@"  -> langsung dianggap email toko
 *   2. selain itu              -> cari email dari `partners.username`
 *   3. signInWithPassword(email, password) via sesi cookie (supabase-ssr)
 *
 * Anti-enumerasi: pesan kesalahan sama untuk user tidak ditemukan / password salah.
 */

const USERNAME_RE = /^[a-z0-9._-]+$/;

function safeNext(raw: string): string {
  return raw.startsWith('/') && !raw.startsWith('//') ? raw : '/kasir';
}

function isFormRequest(ct: string): boolean {
  return !ct.toLowerCase().includes('application/json');
}

export async function POST(req: Request) {
  const ct = req.headers.get('content-type') || '';

  let raw: unknown;
  if (isFormRequest(ct)) {
    const fd = await req.formData().catch(() => null);
    if (!fd) {
      return NextResponse.json({ ok: false, message: 'Body tidak valid.' }, { status: 400 });
    }
    raw = { username: fd.get('username'), password: fd.get('password'), next: fd.get('next') };
  } else {
    try {
      raw = await req.json();
    } catch {
      return NextResponse.json({ ok: false, message: 'Body JSON tidak valid.' }, { status: 400 });
    }
  }

  const body = (raw ?? {}) as { username?: unknown; password?: unknown; next?: unknown };
  const username = String(body.username ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  const next = safeNext(String(body.next ?? '/kasir'));

  const fail = (message = 'Username atau password salah.') => {
    if (isFormRequest(ct)) {
      return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(message)}`, req.url), 303);
    }
    return NextResponse.json({ ok: false, message }, { status: 401 });
  };

  if (!username || !password) return fail();

  let email = username;
  if (!email.includes('@')) {
    if (!USERNAME_RE.test(email)) return fail();
    try {
      const admin = createAdminClient();
      const { data } = await admin.from('partners').select('email').eq('username', email).maybeSingle();
      email = (data?.email as string | undefined) ?? '';
    } catch {
      email = '';
    }
    if (!email) return fail();
  }

  const supabase = createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return fail();
  }

  if (isFormRequest(ct)) {
    return NextResponse.redirect(new URL(next, req.url), 303);
  }

  return NextResponse.json({ ok: true, message: 'Login berhasil.' });
}