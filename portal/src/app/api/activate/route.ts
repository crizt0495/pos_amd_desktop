import { NextResponse } from 'next/server';
import { z } from 'zod';

import { MAX_ACTIVATE, clientIpFromRequest, consume, rateLimitKey } from '@/lib/rate-limit';
import { createAdminClient, hasServiceRole } from '@/lib/supabase/admin';
import { normalizeSerialKey } from '@/lib/serial';
import type { ActivationCode } from '@/types';

/**
 * ===========================================================================
 *  POST /api/activate
 * ===========================================================================
 *  Endpoint publik yang ditembak oleh APLIKASI DESKTOP "Komputer Kasir".
 *  Wajib online 1x saat aktivasi.
 *
 *  Request  : { serial_key: "KPRO-XXXX-XXXX-XXXX", hwid: "32HEX",
 *               device_name?: "...", app_version?: "1.0.0" }
 *  Response : { ok, code, message, license?: {...} }
 *
 *  Aturan:
 *   - serial_key `unused`            -> diubah jadi `active` + HWID dikunci
 *   - serial_key `active`, HWID sama -> ALREADY_ACTIVE (idempoten)
 *   - serial_key `active`, HWID beda -> HWID_MISMATCH (terikat perangkat lain)
 *   - `blocked` / `revoked`          -> ditolak
 *   - `langganan` lewat tanggal       -> EXPIRED
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  serial_key: z.string().min(6).max(64),
  hwid: z
    .string()
    .min(8, 'HWID tidak valid')
    .max(128)
    .regex(/^[A-Za-z0-9-]+$/, 'HWID tidak valid'),
  device_name: z.string().max(120).optional(),
  app_version: z.string().max(32).optional(),
});

/** Mapping code -> HTTP status. */
const STATUS: Record<ActivationCode, number> = {
  ACTIVATED: 200,
  ALREADY_ACTIVE: 200,
  INVALID_KEY: 404,
  NOT_ACTIVE: 403,
  BLOCKED: 403,
  EXPIRED: 403,
  HWID_MISMATCH: 403,
  RATE_LIMITED: 429,
  NETWORK: 500,
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: Request) {
  // Batasi percobaan aktivasi per IP (anti brute-force / tebak serial key).
  const limit = consume(rateLimitKey(clientIpFromRequest(req), 'activate'), MAX_ACTIVATE);
  if (!limit.ok) {
    return NextResponse.json(
      {
        ok: false,
        success: false,
        code: 'RATE_LIMITED',
        message: 'Terlalu banyak percobaan aktivasi dari perangkat ini. Coba lagi nanti.',
      },
      { status: 429, headers: CORS },
    );
  }

  if (!hasServiceRole()) {
    return NextResponse.json(
      {
        ok: false,
        success: false,
        code: 'NETWORK',
        message: 'Server belum dikonfigurasi (SERVICE_KEY / SUPABASE_SECRET_KEY kosong).',
      },
      { status: 500, headers: CORS },
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, success: false, code: 'INVALID_KEY', message: 'Body JSON tidak valid.' },
      { status: 400, headers: CORS },
    );
  }

  // Terima juga versi camelCase agar klien tidak pernah gagal karena format.
  const input = (raw ?? {}) as Record<string, unknown>;
  const parsed = BodySchema.safeParse({
    serial_key: input.serial_key ?? input.serialKey,
    hwid: input.hwid,
    device_name: input.device_name ?? input.deviceName,
    app_version: input.app_version ?? input.appVersion,
  });

  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        success: false,
        code: 'INVALID_KEY',
        message: parsed.error.issues[0]?.message ?? 'Data aktivasi tidak valid.',
      },
      { status: 422, headers: CORS },
    );
  }

  const serialKey = normalizeSerialKey(parsed.data.serial_key);
  if (!serialKey) {
    return NextResponse.json(
      {
        ok: false,
        success: false,
        code: 'INVALID_KEY',
        message: 'Format Serial Key tidak dikenali.',
      },
      { status: 422, headers: CORS },
    );
  }

  const hwid = parsed.data.hwid.toUpperCase();

  try {
    const admin = createAdminClient();

    const { data, error } = await admin.rpc('activate_license', {
      p_serial_key: serialKey,
      p_hwid: hwid,
      p_device_name: parsed.data.device_name ?? null,
      p_app_version: parsed.data.app_version ?? null,
    });

    if (error) {
      const msg = error.message ?? '';
      const schemaBelumAda = /activate_license|PGRST202|PGRST205|Could not find/i.test(msg);
      return NextResponse.json(
        {
          ok: false,
          success: false,
          code: 'NETWORK',
          message: schemaBelumAda
            ? 'Database portal belum siap. Jalankan portal/supabase/schema.sql di Supabase SQL Editor.'
            : `Gagal memproses aktivasi: ${msg}`,
        },
        { status: 500, headers: CORS },
      );
    }

    const row = (Array.isArray(data) ? data[0] : data) as
      | {
          ok: boolean;
          code: string;
          message: string;
          license_id: string | null;
          partner_id: string | null;
          nama_toko: string | null;
          pembeli_nama: string | null;
          paket_type: string | null;
          license_type: string | null;
          status: string | null;
          hwid_locked: string | null;
          locked_now: boolean;
          activated_at: string | null;
          expires_at: string | null;
        }
      | null;

    if (!row) {
      return NextResponse.json(
        { ok: false, success: false, code: 'NETWORK', message: 'Respons server tidak dikenali.' },
        { status: 500, headers: CORS },
      );
    }

    const code = (row.code ?? 'NETWORK') as ActivationCode;
    const status = STATUS[code] ?? 400;

    return NextResponse.json(
      {
        ok: Boolean(row.ok),
        // alias supaya klien mana pun (ok / success) bisa membaca
        success: Boolean(row.ok),
        code,
        message: row.message,
        license: row.ok
          ? {
              serial_key: serialKey,
              partner_id: row.partner_id,
              nama_toko: row.nama_toko,
              pembeli_nama: row.pembeli_nama,
              paket_type: row.paket_type,
              license_type: row.license_type,
              status: row.status,
              hwid_locked: row.hwid_locked,
              locked_now: row.locked_now,
              activated_at: row.activated_at,
              expires_at: row.expires_at,
            }
          : undefined,
        locked_hwid: code === 'HWID_MISMATCH' ? (row.hwid_locked ?? null) : null,
        server_time: new Date().toISOString(),
      },
      { status, headers: CORS },
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        success: false,
        code: 'NETWORK',
        message: err instanceof Error ? err.message : 'Kesalahan server saat aktivasi.',
      },
      { status: 500, headers: CORS },
    );
  }
}
