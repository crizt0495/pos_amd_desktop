import { NextResponse } from 'next/server';

import { MAX_LOGIN, clientIpFromRequest, consume, rateLimitKey } from '@/lib/rate-limit';
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
 * Alur:
 *   1. kalau input berisi "@"  -> langsung dianggap email toko
 *   2. selain itu              -> cari email dari `partners.username`
 *   3. signInWithPassword(email, password) via sesi cookie (supabase-ssr)
 */

const USERNAME_RE = /^[a-z0-9._-]+$/;

/** `next` yang aman: hanya path lokal, hindari open redirect (//evil.com). */
function safeNext(raw: string): string {
  return raw.startsWith('/') && !raw.startsWith('//') ? raw : '/home';
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
  const username = String(body.username ?? '').trim();
  const password = String(body.password ?? '');
  const next = safeNext(String(body.next ?? ''));

  const form = isFormRequest(ct);

  // Respon error konsisten untuk dua format body (redirect vs JSON).
  const fail = (message: string, status: number) => {
    if (!form) return NextResponse.json({ ok: false, message }, { status });
    const url = new URL('/login', req.url);
    url.searchParams.set('next', next);
    url.searchParams.set('error', message);
    return NextResponse.redirect(url, { status: 303 });
  };

  // Batasi percobaan login per IP (anti brute-force password).
  // Dipanggil setelah `fail` terdefinisi supaya klien form tetap dapat redirect.
  const limit = consume(rateLimitKey(clientIpFromRequest(req), 'login'), MAX_LOGIN);
  if (!limit.ok) {
    return fail('Terlalu banyak percobaan login. Coba lagi nanti.', 429);
  }

  if (!username || !password) {
    return fail('Username dan password wajib diisi.', 422);
  }

  // --- tentukan email target -------------------------------------------------
  let email = '';
  if (username.includes('@')) {
    email = username.toLowerCase();
  } else {
    const clean = username.toLowerCase().replace(/[^a-z0-9._-]/g, '');
    if (!clean || !USERNAME_RE.test(clean)) {
      return fail('Username hanya boleh huruf, angka, titik, garis.', 422);
    }

    const admin = createAdminClient();
    const { data: partner } = await admin
      .from('partners')
      .select('email, status')
      .eq('username', clean)
      .maybeSingle();

    if (!partner?.email) {
      // Jangan bocorkan apakah usernamenya ada — respon sama untuk salah password.
      return fail('Username atau password salah.', 401);
    }
    if (partner.status === 'suspended') {
      return fail('Akun toko Anda dinonaktifkan. Hubungi admin.', 403);
    }
    email = partner.email;
  }

  // --- login lewat GoTrue (cookie sesi otomatis menempel di respons) ----------
  const supabase = createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    const msg = error.message || '';
    if (/invalid login credentials/i.test(msg)) {
      return fail('Username atau password salah.', 401);
    }
    if (/email not confirmed/i.test(msg)) {
      return fail('Email belum dikonfirmasi. Cek kotak masuk Anda.', 401);
    }
    return fail(msg, 401);
  }

  if (form) {
    return NextResponse.redirect(new URL(next, req.url), { status: 303 });
  }
  return NextResponse.json({ ok: true });
}