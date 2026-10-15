'use client';

/**
 * Penyimpanan draft lokal (keranjang berjalan & transaksi pending).
 *
 * Di aplikasi desktop, data ditulis ke tabel `local_kv` di file SQLite
 * (`kasir.db`, lihat `desktop/src/db/engine.cjs`) lewat jembatan
 * `window.kasirproDesktop` — BUKAN `localStorage`. Dengan begitu kapasitasnya
 * tidak dibatasi penyimpanan kecil milik browser dan ikut tersimpan permanen di
 * file database bersama data barang/transaksi.
 *
 * Di browser biasa (tanpa jembatan desktop) data hanya bertahan di memori
 * selama sesi ini — sengaja tidak memakai `localStorage` untuk data bisnis.
 */

interface KvBridge {
  kvGet?: (key: string) => Promise<string | null>;
  kvSet?: (key: string, value: string | null) => Promise<boolean>;
  kvDel?: (key: string) => Promise<boolean>;
}

/** Cadangan in-memory untuk browser biasa / sebelum jembatan siap. */
const mem = new Map<string, string>();

function kvBridge(): KvBridge | null {
  if (typeof window === 'undefined') return null;
  const b = (window as unknown as { kasirproDesktop?: KvBridge }).kasirproDesktop;
  return b && typeof b === 'object' ? b : null;
}

/** Baca & parse JSON dari penyimpanan draft. Mengembalikan `null` bila kosong/rusak. */
export async function draftGet<T>(key: string): Promise<T | null> {
  try {
    const b = kvBridge();
    const raw = b?.kvGet ? await b.kvGet(key) : (mem.get(key) ?? null);
    if (raw == null || raw === '') return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Tulis draft (di-serialize ke JSON). Nilai `null` menghapus entri. */
export function draftSet(key: string, value: unknown): void {
  let raw: string | null;
  try {
    raw = value == null ? null : JSON.stringify(value);
  } catch {
    return;
  }
  if (raw == null) mem.delete(key);
  else mem.set(key, raw);
  try {
    const b = kvBridge();
    if (b?.kvSet) void b.kvSet(key, raw);
  } catch {
    /* biarkan nilai tetap ada di memori */
  }
}

/** Hapus draft. */
export function draftDel(key: string): void {
  mem.delete(key);
  try {
    const b = kvBridge();
    if (b?.kvDel) void b.kvDel(key);
  } catch {
    /* abaikan */
  }
}
