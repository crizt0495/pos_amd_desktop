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
  listPrinters?: () => Promise<ListPrinterResponse>;
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
