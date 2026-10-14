'use client';

/**
 * Sinkronisasi dua arah database lokal (SQLite) ⇄ Supabase.
 *
 *  - `pushLocalChanges()`  : kosongkan `_outbox` → upsert/delete ke Supabase.
 *  - `pullFromRemote()`    : tarik baris dari Supabase → impor ke SQLite
 *                            (tanpa mencatat ke outbox, lihat engine.cjs).
 *
 * Database lokal adalah sumber kebenaran saat desktop berjalan offline. Satu PC
 * per toko → konflik praktis tidak ada (yang terakhir menang). Baris yang masih
 * punya perubahan lokal tertunda TIDAK ditimpa saat menarik data.
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
  dbImport?: (payload: { tbl: string; rows: unknown[] }) => Promise<{ ok: boolean; data?: { imported: number }; error?: string }>;
  dbMarkPull?: () => Promise<{ ok: boolean }>;
  dbPullDone?: () => Promise<{ ok: boolean; done?: boolean }>;
  authSession?: () => Promise<{ ok: boolean; session?: { access_token?: string; refresh_token?: string } | null }>;
  reportSync?: (status: Record<string, unknown>) => void;
  onCommand?: (cb: (cmd: string) => void) => () => void;
}

/** Tabel yang disinkronkan (samakan dengan APP_TABLES di engine.cjs). */
const TABLES = [
  'kasir_products',
  'kasir_customers',
  'kasir_suppliers',
  'master_satuan',
  'kasir_settings',
  'kasir_transactions',
  'kasir_transaction_items',
  'kasir_shifts',
  'kasir_returns',
  'kasir_return_items',
  'kasir_stock_logs',
  'kasir_purchases',
  'kasir_purchase_items',
];

const PAGE = 1000;
const MAX_ROWS = 300_000;

function bridge(): SyncBridge {
  if (typeof window === 'undefined') return {};
  return (window as unknown as { kasirproDesktop?: SyncBridge }).kasirproDesktop || {};
}

function onConflictFor(tbl: string): string {
  return tbl === 'kasir_settings' ? 'user_id,key' : 'id';
}

function rowKeyFor(tbl: string, row: Record<string, unknown>): string {
  return tbl === 'kasir_settings' ? String(row.key ?? '') : String(row.id ?? '');
}

/** Pasang sesi login tersimpan ke klien remote. `null` bila tidak ada sesi. */
async function remoteWithSession() {
  const remote = createRemoteClient();
  const b = bridge();
  try {
    if (b.authSession) {
      const r = await b.authSession();
      if (r?.session?.access_token) {
        await remote.auth.setSession({
          access_token: r.session.access_token,
          refresh_token: r.session.refresh_token || '',
        });
      }
    }
  } catch {
    /* offline / belum login */
  }
  try {
    const { data } = await remote.auth.getSession();
    if (!data?.session) return null;
  } catch {
    return null;
  }
  return remote;
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

  const remote = await remoteWithSession();
  if (!remote) return { pushed: 0, failed: 0 };

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
 * Tarik semua data milik user dari Supabase lalu impor ke SQLite.
 * Baris yang masih punya perubahan lokal tertunda dilewati (tidak ditimpa).
 */
export async function pullFromRemote(): Promise<{ tables: number; rows: number; failed: number }> {
  const b = bridge();
  const result = { tables: 0, rows: 0, failed: 0 };
  if (!b.dbImport) return result;

  const remote = await remoteWithSession();
  if (!remote) return result;

  // Baris yang belum terkirim jangan ditimpa.
  const skip = new Set<string>();
  try {
    const res = await b.dbOutbox?.();
    for (const e of (res && res.data) || []) skip.add(`${e.tbl}:${e.row_id}`);
  } catch {
    /* abaikan */
  }

  for (const tbl of TABLES) {
    try {
      // Urutkan dengan kolom kunci agar paging stabil (tidak ada baris terlewat
      // saat data besar). kasir_settings tidak punya `id` → pakai `key`.
      const orderCol = tbl === 'kasir_settings' ? 'key' : 'id';
      const all: unknown[] = [];
      for (let from = 0; from < MAX_ROWS; from += PAGE) {
        const { data, error } = await remote
          .from(tbl)
          .select('*')
          .order(orderCol, { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) throw new Error(error.message);
        const batch = (data || []) as Record<string, unknown>[];
        for (const row of batch) {
          if (skip.has(`${tbl}:${rowKeyFor(tbl, row)}`)) continue;
          all.push(row);
        }
        if (batch.length < PAGE) break;
      }
      const res = await b.dbImport({ tbl, rows: all });
      if (!res?.ok) throw new Error(res?.error || 'impor gagal');
      result.tables++;
      result.rows += all.length;
    } catch {
      result.failed++;
    }
  }

  if (result.failed === 0) {
    try {
      await b.dbMarkPull?.();
    } catch {
      /* abaikan */
    }
  }
  return result;
}

/** Kirim ringkasan status sinkron ke proses utama (untuk menu tray). */
async function reportStatus(extra: Record<string, unknown> = {}): Promise<void> {
  const b = bridge();
  if (!b.reportSync) return;
  let pending: number | null = null;
  try {
    const res = await b.dbOutbox?.();
    pending = (res && res.data ? res.data.length : 0) ?? null;
  } catch {
    /* abaikan */
  }
  try {
    b.reportSync({ pending, at: new Date().toISOString(), online: typeof navigator !== 'undefined' ? navigator.onLine : true, ...extra });
  } catch {
    /* abaikan */
  }
}

/** Tarikan awal sekali per user (saat pertama kali memakai mode lokal). */
async function initialPullIfNeeded(): Promise<void> {
  const b = bridge();
  if (!b.dbPullDone || !b.dbImport) return;
  try {
    const st = await b.dbPullDone();
    if (st?.done) return;
  } catch {
    return;
  }
  const res = await pullFromRemote();
  if (res.failed === 0) await reportStatus({ pulled: res.rows });
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
      const res = await pushLocalChanges();
      await reportStatus({ pushed: res.pushed, failed: res.failed });
    } finally {
      running = false;
    }
  };

  const pullAll = async () => {
    if (running) return;
    running = true;
    try {
      const res = await pullFromRemote();
      await reportStatus({ pulled: res.rows, pullFailed: res.failed });
    } finally {
      running = false;
    }
  };

  const timer = window.setInterval(run, 60_000);
  const onOnline = () => void run();
  window.addEventListener('online', onOnline);
  window.addEventListener('focus', onOnline);
  const initial = window.setTimeout(() => {
    void initialPullIfNeeded().then(() => run());
  }, 1500);

  // Perintah dari menu tray: "Sinkronkan Sekarang" / "Ambil Data dari Server".
  const offCommand = b.onCommand
    ? b.onCommand((cmd) => {
        if (cmd === 'sync-now') void run();
        else if (cmd === 'pull-remote') void pullAll();
      })
    : () => {};

  return () => {
    window.clearInterval(timer);
    window.clearTimeout(initial);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('focus', onOnline);
    try { offCommand(); } catch { /* abaikan */ }
  };
}
