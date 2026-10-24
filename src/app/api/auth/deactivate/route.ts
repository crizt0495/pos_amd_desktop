import { NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import { APP_NAME, isDemoKey, normalizeSerialKey } from '@/lib/license';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/deactivate — Nonaktifkan lisensi di perangkat ini.
 *
 * Dipanggil aplikasi desktop dari menu "Bantuan > Nonaktifkan Lisensi di
 * Perangkat Ini", biasanya SEBELUM uninstall / memindahkan komputer.
 *
 * Body: { serial_key, hwid, device_name?, app_version? }
 *
 * Keamanan: hanya perangkat yang SAAT INI TERIKAT yang boleh melepas
 * lisensinya sendiri — harus Serial Key + HWID yang sama persis dengan kunci
 * yang tersimpan. Respons TIDAK pernah membocorkan HWID yang terkunci.
 *
 * Sukses: status kembali `unused` (siap dipakai), kunci perangkat
 * (hwid_locked, hwid_locked_at, activated_at) dihapus, sehingga Serial yang
 * sama bisa diaktifkan lagi di komputer yang sama (mis. setelah install
 * ulang) maupun di komputer lain.
 */

const HWID_RE = /^[A-Za-z0-9-]{8,128}$/;

export async function POST(req: Request) {
  let raw: unknown = null;
  try {
    raw = await req.json();
  } catch {
    /* body tidak valid — dibiarkan null */
  }
  const body = (raw ?? {}) as {
    serial_key?: unknown;
    hwid?: unknown;
    device_name?: unknown;
    app_version?: unknown;
  };

  const serial = normalizeSerialKey(String(body.serial_key ?? ''));
  const hwid = String(body.hwid ?? '').trim().toUpperCase();
  const deviceName = String(body.device_name ?? '').trim().slice(0, 120);
  const appVersion = String(body.app_version ?? '').trim().slice(0, 32);

  if (!serial || !hwid || !HWID_RE.test(hwid)) {
    return NextResponse.json(
      { ok: false, message: 'Permintaan tidak lengkap. Kirim Serial Key dan HWID dari aplikasi.' },
      { status: 400 },
    );
  }

  if (isDemoKey(serial)) {
    return NextResponse.json(
      { ok: false, message: 'Key demo tidak memiliki kunci perangkat — tidak perlu dinonaktifkan.' },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  // Update kondisional ATOMIK: hanya baris yang statusnya `active` dan kuncinya
  // PERSIS hwid milik pemohon. Perangkat lain / serial salah => 0 baris.
  const { data, error } = await admin
    .from('licenses')
    .update({
      status: 'unused',
      hwid_locked: null,
      hwid_locked_at: null,
      activated_at: null,
    })
    .eq('serial_key', serial)
    .eq('hwid_locked', hwid)
    .eq('status', 'active')
    .select('serial_key,status');

  if (error) {
    return NextResponse.json(
      { ok: false, message: `Gagal memproses permintaan: ${error.message}` },
      { status: 500 },
    );
  }

  if (!data || data.length === 0) {
    // Tolak tanpa menjelaskan kondisi internal (tidak bocorkan kunci/status).
    return NextResponse.json(
      {
        ok: false,
        message:
          'Lisensi tidak sedang terikat ke perangkat ini. Nonaktifkan hanya bisa dilakukan dari perangkat yang terikat, atau minta reset ke toko.',
      },
      { status: 403 },
    );
  }

  console.log(
    `[deactivate] lisensi ${serial} dilepas dari perangkat ${deviceName || '(tanpa nama)'} ` +
      `(hwid ${hwid.slice(0, 6)}…, v${appVersion || '?'}).`,
  );
  return NextResponse.json({
    ok: true,
    message:
      `${APP_NAME}: lisensi telah dilepas dari perangkat ini. ` +
      'Serial bisa diaktifkan lagi di komputer ini maupun komputer lain.',
  });
}
