/**
 * Jembatan opsional ke aplikasi desktop (Electron) KasirPro POS.
 *
 * Aplikasi web yang sama dipakai baik di browser biasa maupun di dalam
 * shell desktop (lihat folder `desktop/`). Di desktop, preload menyuntik
 * `window.kasirproDesktop`; di browser, objek itu tidak ada.
 *
 * Semua akses lewat modul ini supaya:
 *  - aman saat SSR (`window` belum ada),
 *  - aman bila dijalankan di browser biasa (semua fungsi mengembalikan
 *    nilai netral, bukan melempar error).
 */

export interface PrinterInfo {
  /** Nama printer di sistem operasi — dipakai `print({ deviceName })`. */
  name: string;
  displayName: string;
  isDefault: boolean;
  status?: number;
}

interface ListPrinterResponse {
  ok: boolean;
  data?: PrinterInfo[];
  error?: string;
}

interface DesktopBridge {
  platform?: string;
  /** Apakah mode database lokal (SQLite) aktif di shell desktop. */
  localDb?: boolean;
  listPrinters?: () => Promise<ListPrinterResponse>;
  /** Status database lokal siap dipakai (dipanggil sebelum memuat data). */
  dbReady?: () => Promise<{ ok?: boolean; enabled?: boolean; path?: string; error?: string | null }>;
  reload?: () => Promise<{ ok?: boolean }>;
  openDbFolder?: () => Promise<{ ok?: boolean; error?: string }>;
  /** Kontrol jendela dari title bar kustom (Electron). */
  minimize?: () => void;
  maximize?: () => void;
  close?: () => void;
}

/** Ambil objek jembatan bila aplikasi berjalan di dalam shell desktop. */
export function desktopBridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null;
  const b = (window as unknown as { kasirproDesktop?: DesktopBridge }).kasirproDesktop;
  return b && b.platform === 'desktop' ? b : null;
}

/** True bila dijalankan sebagai aplikasi desktop (Electron). */
export function desktopAktif(): boolean {
  return desktopBridge() !== null;
}

export interface StatusDatabase {
  /** true = aman memuat data (web, DB lokal nonaktif, atau DB lokal siap). */
  ok: boolean;
  path?: string;
  error?: string;
}

/**
 * Cek apakah database lokal siap dipakai SEBELUM layar memuat data.
 *
 * Penting agar UI tidak menampilkan "0 produk / Rp 0" ketika database gagal
 * dibuka. Di browser biasa (atau saat mode lokal dimatikan) hasilnya selalu
 * `ok:true` supaya perilaku Supabase tidak berubah.
 */
export async function cekKesiapanDatabase(): Promise<StatusDatabase> {
  if (typeof window === 'undefined') return { ok: true };
  const b = (window as unknown as { kasirproDesktop?: DesktopBridge }).kasirproDesktop;
  if (!b || b.platform !== 'desktop') return { ok: true };
  if (b.localDb !== true) return { ok: true };
  if (typeof b.dbReady !== 'function') return { ok: true };
  try {
    const r = await b.dbReady();
    if (r && r.ok) return { ok: true, path: r.path };
    return { ok: false, path: r?.path, error: (r && r.error) || 'Database lokal tidak aktif.' };
  } catch (e) {
    const pesan = e instanceof Error ? e.message : String(e);
    // Build lama mungkin belum punya handler ini — jangan blokir aplikasi.
    if (/No handler registered/i.test(pesan)) return { ok: true };
    return { ok: false, error: 'Tidak bisa menghubungi proses utama: ' + pesan };
  }
}

/** Buka folder tempat file kasir.db berada (khusus desktop). */
export async function bukaFolderDatabase(): Promise<{ ok: boolean; error?: string }> {
  const b = (window as unknown as { kasirproDesktop?: DesktopBridge }).kasirproDesktop;
  if (!b?.openDbFolder) return { ok: false, error: 'Hanya tersedia di aplikasi desktop.' };
  try {
    const r = await b.openDbFolder();
    return { ok: r?.ok !== false, error: r?.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Muat ulang aplikasi desktop setelah database diperbaiki. */
export async function muatUlangAplikasi(): Promise<void> {
  const b = (window as unknown as { kasirproDesktop?: DesktopBridge }).kasirproDesktop;
  if (b?.reload) {
    try { await b.reload(); return; } catch { /* fallback */ }
  }
  if (typeof window !== 'undefined') window.location.reload();
}

/**
 * Kontrol jendela dari title bar kustom (hanya berlaku di aplikasi desktop).
 * Di browser biasa panggilan ini tidak melakukan apa-apa.
 */
export function kontrolJendela(action: 'minimize' | 'maximize' | 'close'): void {
  const b = desktopBridge();
  if (!b) return;
  if (action === 'minimize') b.minimize?.();
  else if (action === 'maximize') b.maximize?.();
  else b.close?.();
}

/**
 * Daftar printer yang terpasang di perangkat (khusus desktop).
 * Di browser biasa mengembalikan daftar kosong.
 */
export async function daftarPrinterTerdeteksi(): Promise<PrinterInfo[]> {
  const b = desktopBridge();
  if (!b?.listPrinters) return [];
  try {
    const r = await b.listPrinters();
    if (r?.ok && Array.isArray(r.data)) return r.data;
  } catch {
    /* abaikan — perlakukan seperti tidak ada printer terdeteksi */
  }
  return [];
}
