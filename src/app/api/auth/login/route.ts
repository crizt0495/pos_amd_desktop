import { NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import {
  APP_NAME,
  APP_VERSION,
  activateLicense,
  isDemoKey,
  normalizeSerialKey,
  resolveAppAccount,
} from '@/lib/license';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/login — login POS dengan SERIAL KEY (lisensi dari Portal).
 *
 * Body (form-urlencoded di halaman login, atau JSON untuk API):
 *   serial_key       : "KPRO-XXXX-XXXX-XXXX" (atau key demo KPRO-DEMO-*)
 *   device_id        : HWID stabil perangkat (machine-id/registry) — 1 key = 1 device
 *   legacy_device_id?: HWID skema lama (<= v2.3.11, UUID acak di secrets.json).
 *                      Bila lisensi masih terikat nilai lama ini (upgrade dari
 *                      versi lama di perangkat yang SAMA), kunci dipindahkan
 *                      ke HWID baru tanpa campur tangan admin. Nilai ini hanya
 *                      ada di secrets.json terenkripsi perangkat pemilik.
 *   device_name?     : label perangkat
 *   app_version?     : versi aplikasi
 *   next?            : redirect tujuan
 *
 * Alur:
 *   1. normalisasi + validasi format serial key
 *   2. key non-demo -> RPC activate_license (portal) → ACTIVATED / ALREADY_ACTIVE
 *      (blocked/expired/hwid-mismatch => login ditolak dengan pesan sesuai;
 *      HWID_MISMATCH + legacy_device_id cocok -> re-bind ke HWID baru,
 *      kasus upgrade app di perangkat yang sama)
 *      key demo (KPRO-DEMO-*) -> langsung boleh, tanpa kunci perangkat
 *   3. siapkan akun GoTrue khusus lisensi (lihat src/lib/license.ts)
 *   4. signInWithPassword (sesi cookie) -> redirect ke next (/kasir)
 */

const HWID_RE = /^[A-Za-z0-9-]{8,128}$/;

function safeNext(raw: string): string {
  return raw.startsWith('/') && !raw.startsWith('//') ? raw : '/kasir';
}

function isFormRequest(ct: string): boolean {
  return !ct.toLowerCase().includes('application/json');
}

const MESSAGES: Record<string, string> = {
  INVALID_KEY: 'Serial Key tidak ditemukan. Periksa kembali kode dari toko Anda.',
  BLOCKED: 'Lisensi ini telah diblokir atau dicabut. Hubungi toko Anda.',
  EXPIRED: 'Lisensi ini telah kedaluwarsa. Perpanjangan silakan hubungi toko Anda.',
  HWID_MISMATCH:
    'Serial Key sudah digunakan di perangkat lain. Gunakan perangkat yang pertama, atau minta reset ke toko Anda.',
  NOT_ACTIVE: 'Lisensi belum aktif. Silakan ulangi aktivasi.',
};

function activationMessage(code: string, fallback: string): string {
  return MESSAGES[code] ?? fallback;
}

export async function POST(req: Request) {
  const ct = req.headers.get('content-type') || '';

  let raw: unknown;
  if (isFormRequest(ct)) {
    const fd = await req.formData().catch(() => null);
    if (!fd) {
      return NextResponse.json({ ok: false, message: 'Body tidak valid.' }, { status: 400 });
    }
    raw = {
      serial_key: fd.get('serial_key'),
      device_id: fd.get('device_id'),
      legacy_device_id: fd.get('legacy_device_id'),
      device_name: fd.get('device_name'),
      app_version: fd.get('app_version'),
      next: fd.get('next'),
    };
  } else {
    try {
      raw = await req.json();
    } catch {
      return NextResponse.json({ ok: false, message: 'Body JSON tidak valid.' }, { status: 400 });
    }
  }

  const body = (raw ?? {}) as {
    serial_key?: unknown;
    device_id?: unknown;
    legacy_device_id?: unknown;
    device_name?: unknown;
    app_version?: unknown;
    next?: unknown;
  };

  const serial = normalizeSerialKey(String(body.serial_key ?? ''));
  const deviceId = String(body.device_id ?? '').trim();
  const legacyHwid = String(body.legacy_device_id ?? '').trim().toUpperCase();
  const deviceName = String(body.device_name ?? '').trim().slice(0, 120);
  const appVersion = String(body.app_version ?? '').trim().slice(0, 32);
  const next = safeNext(String(body.next ?? '/kasir'));

  const fail = (message: string, status = 401) => {
    if (isFormRequest(ct)) {
      return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(message)}`, req.url), 303);
    }
    return NextResponse.json({ ok: false, message }, { status });
  };

  if (!serial) {
    return fail('Format Serial Key tidak dikenali. Contoh: KPRO-XXXX-XXXX-XXXX.');
  }

  const demo = isDemoKey(serial);

  if (!demo && (!deviceId || !HWID_RE.test(deviceId))) {
    return fail('Perangkat tidak dikenali. Muat ulang halaman login lalu coba lagi.');
  }

  // --- 1. Aktivasi lisensi (kecuali key demo) -------------------------------
  if (!demo) {
    const admin = createAdminClient();
    const hwid = deviceId.toUpperCase();
    let result = await activateLicense(admin, serial, hwid, deviceName || 'Web Browser', appVersion || APP_VERSION);

    // Perangkat lama yang upgrade app: kunci server masih UUID acak skema lama.
    // Bila permintaan datang membawa nilai legacy yang COCOK dengan HWID yang
    // terkunci (hanya diketahui perangkat pemilik, dari secrets terenkripsi),
    // pindahkan kunci ke HWID stabil baru lalu aktivasi ulang.
    if (!result.ok && result.code === 'HWID_MISMATCH' && legacyHwid && legacyHwid !== hwid) {
      const locked = String(
        (result.data as Record<string, unknown> | null)?.hwid_locked ?? '',
      ).trim().toUpperCase();
      if (legacyHwid === locked) {
        const { data: rebind, error: rebindErr } = await admin
          .from('licenses')
          .update({ hwid_locked: hwid, hwid_locked_at: new Date().toISOString() })
          .eq('serial_key', serial)
          .eq('hwid_locked', locked)
          .eq('status', 'active')
          .select('serial_key,status');
        if (!rebindErr && rebind && rebind.length === 1) {
          console.log(`[login] rebind skema lama -> HWID baru untuk ${serial}.`);
          result = await activateLicense(admin, serial, hwid, deviceName || 'Web Browser', appVersion || APP_VERSION);
        }
      }
    }

    if (!result.ok) {
      return fail(activationMessage(result.code, result.message), result.code === 'NETWORK' ? 500 : 403);
    }
  }

  // --- 2. Akun GoTrue khusus lisensi ----------------------------------------
  const admin = createAdminClient();
  const account = await resolveAppAccount(admin, serial);
  if (!account.ok) {
    return fail(account.message, 500);
  }

  // --- 3. Sign in (sesi cookie) ---------------------------------------------
  const supabase = createClient();
  const { data: signIn, error: signInErr } = await supabase.auth.signInWithPassword({
    email: account.account.email,
    password: account.account.password,
  });
  if (signInErr) {
    return fail('Gagal masuk sebagai lisensi ini. Coba lagi.', 500);
  }

  if (isFormRequest(ct)) {
    return NextResponse.redirect(new URL(next, req.url), 303);
  }

  const isDesktop = req.headers.get('x-kasirpro-desktop') === '1' || req.headers.get('X-KasirPro-Desktop') === '1';
  const payload: any = { ok: true, message: `Selamat datang, ${APP_NAME}!` };
  if (isDesktop && signIn?.session) {
    payload.user_id = signIn.session.user.id;
    payload.session = {
      access_token: signIn.session.access_token,
      refresh_token: signIn.session.refresh_token,
      expires_at: signIn.session.expires_at,
    };
  }
  return NextResponse.json(payload);
}