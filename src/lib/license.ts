import 'server-only';

import { createHash, randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Login POS memakai SIGSERIAL KEY (lisensi) dari KasirPro Portal.
 *  - key non-demo : divalidasi RPC `activate_license` (mengunci perangkat/browser).
 *  - key demo     : KPRO-DEMO-* selalu boleh masuk (tidak terkunci perangkat).
 *
 * Setelah aktivasi sukses, server membuat/menemukan akun GoTrue khusus
 * per lisensi (sandi acak disimpan di tabel `kasir_license_accounts`,
 * hanya service_role yang bisa membaca) lalu sign-in via cookie.
 */

export const APP_NAME = 'KasirPro POS';
export const APP_VERSION = '2.0.0';
export const DEMO_SERIAL = 'KPRO-DEMO-AAAA-0001';
const DEMO_PREFIX = 'KPRO-DEMO-';

/** Rapikan input menjadi `KPRO-XXXX-XXXX-XXXX` (atau KPRO-DEMO-*). '' bila tak dikenal. */
export function normalizeSerialKey(input: string): string {
  const raw = (input ?? '').toUpperCase().replace(/[^A-Z0-9-]/g, '').replace(/\s+/g, '');
  if (!raw) return '';

  if (raw.startsWith(DEMO_PREFIX)) {
    return /^KPRO-DEMO-[A-Z0-9]{4}-\d{4}$/.test(raw) ? raw : '';
  }

  // format standar: KPRO + 12 karakter
  let body = raw;
  while (body.startsWith('KPRO')) body = body.slice(4);
  body = body.replace(/-/g, '');
  if (body.length !== 12) return '';
  const groups = body.match(/.{1,4}/g) ?? [];
  return `KPRO-${groups.join('-')}`;
}

export function isDemoKey(serialKey: string): boolean {
  return serialKey.startsWith(DEMO_PREFIX);
}

function sha1Hex(s: string): string {
  return createHash('sha1').update(s).digest('hex');
}

/** Email GoTrue deterministik per lisensi supaya tidak pernah duplikat. */
export function appEmailFor(serialKey: string): string {
  return `kasir-${sha1Hex(serialKey).slice(0, 16)}@kasirpro.app`;
}

export interface ActivationResult {
  ok: boolean;
  code: string;
  message: string;
  data?: Record<string, unknown>;
}

/**
 * Panggil RPC `activate_license` (milik portal) dengan klien service role.
 * Implementasi RPC ada di schema portal; grant execute hanya untuk service_role.
 */
export async function activateLicense(
  admin: SupabaseClient,
  serialKey: string,
  hwid: string,
  deviceName?: string,
  appVersion?: string,
): Promise<ActivationResult> {
  const { data, error } = await admin.rpc('activate_license', {
    p_serial_key: serialKey,
    p_hwid: hwid,
    p_device_name: deviceName ?? null,
    p_app_version: appVersion ?? null,
  });

  if (error) {
    const msg = error.message ?? '';
    const bukanSkema = /activate_license|could not find/i.test(msg);
    if (bukanSkema) {
      return {
        ok: false,
        code: 'NETWORK',
        message:
          'Fungsi aktivasi belum tersedia di database. Jalankan supabase/schema.sql (bagian 5) di Supabase SQL Editor.',
      };
    }
    return { ok: false, code: 'NETWORK', message: `Gagal memproses aktivasi: ${msg}` };
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | Record<string, unknown>
    | null;
  if (!row) {
    return { ok: false, code: 'NETWORK', message: 'Respons server tidak dikenali.' };
  }
  return {
    ok: Boolean(row.ok),
    code: String(row.code ?? 'NETWORK'),
    message: String(row.message ?? 'Gagal aktivasi.'),
    data: row,
  };
}

export interface AppAccount {
  email: string;
  password: string;
}

/**
 * Siapkan akun GoTrue untuk sebuah lisensi.
 *  - membaca (serial_key -> app_email/app_password) dari kasir_license_accounts
 *  - belum ada -> buat user GoTrue + simpan sandi acak di tabel
 * Aman terhadap race (409 "sudah terdaftar" -> set ulang sandi via admin).
 */
export async function resolveAppAccount(
  admin: SupabaseClient,
  serialKey: string,
): Promise<{ ok: true; account: AppAccount } | { ok: false; message: string }> {
  const email = appEmailFor(serialKey);

  const { data: row, error: readErr } = await admin
    .from('kasir_license_accounts')
    .select('app_email, app_password')
    .eq('serial_key', serialKey)
    .maybeSingle();

  if (!readErr && row) {
    return { ok: true, account: { email: row.app_email as string, password: row.app_password as string } };
  }

  const password = randomBytes(18).toString('hex');
  const { error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createErr) {
    const sudahAda = createErr.status === 409 || /already.*(exist|register)/i.test(createErr.message ?? '');
    if (!sudahAda) {
      return { ok: false, message: `Akun lisensi gagal dibuat: ${createErr.message}` };
    }
    // User sudah ada (dua browser login bersamaan saat pertama kali).
    // Akun dibuat + sandi disimpan oleh request pertama — cukup baca barisnya.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await new Promise((r) => setTimeout(r, 250));
      const { data: row2, error: read2 } = await admin
        .from('kasir_license_accounts')
        .select('app_email, app_password')
        .eq('serial_key', serialKey)
        .maybeSingle();
      if (!read2 && row2) {
        return {
          ok: true,
          account: { email: row2.app_email as string, password: row2.app_password as string },
        };
      }
    }
    return { ok: false, message: 'Akun lisensi sedang disiapkan. Silakan coba beberapa saat lagi.' };
  }

  const { error: upsertErr } = await admin
    .from('kasir_license_accounts')
    .upsert({ serial_key: serialKey, app_email: email, app_password: password }, { onConflict: 'serial_key' });

  if (upsertErr) {
    return { ok: false, message: `Gagal menyimpan akun lisensi: ${upsertErr.message}` };
  }
  return { ok: true, account: { email, password } };
}