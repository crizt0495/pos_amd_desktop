'use client';

/**
 * Sinkronisasi database lokal (SQLite) → Supabase.
 *
 * Database lokal adalah sumber kebenaran saat aplikasi desktop berjalan
 * offline. Setiap perubahan dicatat di `_outbox` (lihat desktop/src/db/engine.cjs).
 * Modul ini mengosongkan outbox saat online: meng-upsert/menghapus baris ke
 * Supabase memakai sesi login (cookie) yang sama. Satu PC per toko → konflik
 * praktis tidak ada (yang terakhir menang).
 */

import { createRemoteClient } from './client';

interface OutboxEntry {
  tbl: string;
  row_id: string;
  op: string;
}

interface SyncBridge {
  localDb?: boolean;
  dbOutbox?: () => Promise<{ ok: boolean; data?: OutboxEntry[] }>;
  dbSyncRow?: (tbl: string, rowId: string) => Promise<{ ok: boolean; data?: Record<string, unknown> | null }>;
  dbOutboxDone?: (e: { tbl: string; rowId: string; op: string }) => Promise<{ ok: boolean }>;
  dbStats?: () => Promise<{ ok: boolean; data?: Record<string, number | string | null> }>;
}

function bridge(): SyncBridge {
  if (typeof window === 'undefined') return {};
  return (window as unknown as { kasirproDesktop?: SyncBridge }).kasirproDesktop || {};
}

function onConflictFor(tbl: string): string {
  return tbl === 'kasir_settings' ? 'user_id,key' : 'id';
}

/**
 * Dorong semua perubahan lokal yang belum tersinkron ke Supabase.
 * Aman dipanggil berkali-kali dan saat offline (gagal diam-diam).
 */
export async function pushLocalChanges(): Promise<{ pushed: number; failed: number }> {
  const b = bridge();
  if (!b.dbOutbox || !b.dbSyncRow || !b.dbOutboxDone) return { pushed: 0, failed: 0 };

  let pending: OutboxEntry[] = [];
  try {
    const res = await b.dbOutbox();
    pending = (res && res.data) || [];
  } catch {
    return { pushed: 0, failed: 0 };
  }
  if (!pending.length) return { pushed: 0, failed: 0 };

  const remote = createRemoteClient();
  // Pastikan ada sesi login; jika belum, tunda sampai login berikutnya.
  try {
    const { data } = await remote.auth.getSession();
    if (!data?.session) return { pushed: 0, failed: 0 };
  } catch {
    return { pushed: 0, failed: 0 };
  }

  let pushed = 0;
  let failed = 0;

  for (const e of pending) {
    try {
      const tbl = e.tbl;
      const client = remote.from(tbl) as unknown as {
        upsert: (row: unknown, opts: { onConflict: string }) => Promise<{ error: { message: string } | null }>;
        delete: () => {
          eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>;
        };
      };

      if (e.op === 'delete') {
        const { error } = await client.delete().eq(tbl === 'kasir_settings' ? 'key' : 'id', e.row_id);
        if (error) {
          failed++;
          continue;
        }
      } else {
        const rowRes = await b.dbSyncRow(tbl, e.row_id);
        const row = rowRes && rowRes.data;
        if (!row) {
          // Baris sudah tidak ada lokal — anggap selesai.
          await b.dbOutboxDone({ tbl, rowId: e.row_id, op: e.op });
          continue;
        }
        const { error } = await client.upsert(row, { onConflict: onConflictFor(tbl) });
        if (error) {
          failed++;
          continue;
        }
      }
      await b.dbOutboxDone({ tbl, rowId: e.row_id, op: e.op });
      pushed++;
    } catch {
      failed++;
    }
  }

  return { pushed, failed };
}

/**
 * Pasang sinkronisasi berkala. Mengembalikan fungsi pembersih.
 * Tidak melakukan apa-apa di browser biasa / saat database lokal mati.
 */
export function attachSync(): () => void {
  if (typeof window === 'undefined') return () => {};
  const b = bridge();
  if (!b.localDb || !b.dbOutbox) return () => {};

  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await pushLocalChanges();
    } finally {
      running = false;
    }
  };

  const timer = window.setInterval(run, 60_000);
  const onOnline = () => void run();
  window.addEventListener('online', onOnline);
  window.addEventListener('focus', onOnline);
  const initial = window.setTimeout(run, 4000);

  return () => {
    window.clearInterval(timer);
    window.clearTimeout(initial);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('focus', onOnline);
  };
}
