import { draftGet, draftSet } from './localStore';

/**
 * Preferensi tampilan kasir untuk "Total Besar" (display untuk pelanggan).
 *
 * Disimpan di database lokal per perangkat (tabel `local_kv` di `kasir.db`),
 * bukan di localStorage. Murni preferensi tampilan mesin kasir.
 */

export type PosisiTotal = 'kanan-atas' | 'tengah-atas' | 'bawah' | 'floating';
export type UkuranTotal = 'kecil' | 'sedang' | 'besar' | 'jumbo';

export type PreferensiTampilan = {
  aktif: boolean;
  terbuka: boolean;
  posisi: PosisiTotal;
  ukuran: UkuranTotal;
  x: number | null;
  y: number | null;
};

export const TAMPILAN_KEY = 'tampilan';
export const TAMPILAN_EVENT = 'kpro:tampilan';

export const TAMPILAN_AWAL: PreferensiTampilan = {
  aktif: true,
  terbuka: true,
  posisi: 'kanan-atas',
  ukuran: 'besar',
  x: null,
  y: null,
};

export const OPSI_POSISI: { value: PosisiTotal; label: string }[] = [
  { value: 'kanan-atas', label: 'Kanan Atas' },
  { value: 'tengah-atas', label: 'Tengah Atas' },
  { value: 'bawah', label: 'Bawah' },
  { value: 'floating', label: 'Floating (bebas)' },
];

export const OPSI_UKURAN: { value: UkuranTotal; label: string; px: number }[] = [
  { value: 'kecil', label: 'Kecil', px: 22 },
  { value: 'sedang', label: 'Sedang', px: 30 },
  { value: 'besar', label: 'Besar', px: 40 },
  { value: 'jumbo', label: 'Jumbo', px: 56 },
];

export const JARAK_ATAS = 132;
export const JARAK_SISI = 20;
export const JARAK_BAWAH = 78;
export const MARGIN_MIN = 8;

/** Ukuran huruf nominal total, mengikuti pilihan kasir. */
export function ukuranFont(u: UkuranTotal): number {
  return OPSI_UKURAN.find((o) => o.value === u)?.px ?? 40;
}

type Gaya = {
  left?: number | string;
  top?: number | string;
  right?: number;
  bottom?: number;
  transform?: string;
};

/**
 * Gaya posisi untuk CSS `position: fixed`.
 * `seret` dipakai saat sedang digeser: kotak mengikuti kursor walau
 * preferensinya masih berpreset (pas dilepas, geseran disimpan sebagai mode bebas).
 */
export function gayaPosisi(p: PreferensiTampilan, seret?: { x: number; y: number } | null): Gaya {
  if (seret) return { left: seret.x, top: seret.y };
  if (p.posisi === 'floating' && p.x != null && p.y != null) {
    return { left: p.x, top: p.y };
  }
  if (p.posisi === 'tengah-atas') {
    return { top: JARAK_ATAS, left: '50%', transform: 'translateX(-50%)' };
  }
  if (p.posisi === 'bawah') {
    // Dinaikkan dari dasar supaya tidak menutupi tombol Bayar.
    return { bottom: JARAK_BAWAH, left: '50%', transform: 'translateX(-50%)' };
  }
  return { top: JARAK_ATAS, right: JARAK_SISI };
}

/** Jaga kotak tetap kelihatan penuh di dalam layar. */
export function jepitPosisi(
  x: number,
  y: number,
  lebar: number,
  tinggi: number,
  vw: number,
  vh: number,
): { x: number; y: number } {
  const maksX = Math.max(MARGIN_MIN, vw - lebar - MARGIN_MIN);
  const maksY = Math.max(MARGIN_MIN, vh - tinggi - MARGIN_MIN);
  return {
    x: Math.min(Math.max(MARGIN_MIN, x), maksX),
    y: Math.min(Math.max(MARGIN_MIN, y), maksY),
  };
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function gabung(v: unknown): PreferensiTampilan {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<PreferensiTampilan>;
  return {
    aktif: o.aktif !== false,
    terbuka: o.terbuka !== false,
    posisi: OPSI_POSISI.some((p) => p.value === o.posisi)
      ? (o.posisi as PosisiTotal)
      : TAMPILAN_AWAL.posisi,
    ukuran: OPSI_UKURAN.some((p) => p.value === o.ukuran)
      ? (o.ukuran as UkuranTotal)
      : TAMPILAN_AWAL.ukuran,
    x: num(o.x),
    y: num(o.y),
  };
}

let cache: PreferensiTampilan | null = null;
let memuat = false;

const LS_KEY_LAMA = 'kpro_tampilan';

function bacaDariLS(): PreferensiTampilan | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(LS_KEY_LAMA);
    return raw ? gabung(JSON.parse(raw)) : null;
  } catch { return null; }
}

async function muatDariDb() {
  if (memuat) return;
  memuat = true;
  try {
    const db = await draftGet<PreferensiTampilan>(TAMPILAN_KEY);
    if (db) {
      cache = gabung(db);
    } else if (cache) {
      draftSet(TAMPILAN_KEY, cache);
    }
    try {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(LS_KEY_LAMA);
    } catch {}
  } finally {
    memuat = false;
  }
}

/** Preferensi saat ini (aman dipanggil sebelum mount / di server). */
export function bacaTampilan(): PreferensiTampilan {
  try {
    if (typeof window === 'undefined') return { ...TAMPILAN_AWAL };
  } catch { return { ...TAMPILAN_AWAL }; }
  if (cache) return cache;
  const lama = bacaDariLS();
  cache = lama ? lama : { ...TAMPILAN_AWAL };
  void muatDariDb();
  return cache;
}

/** Gabung patch ke preferensi, simpan, lalu siarkan ke layar lain. */
export function setTampilan(patch: Partial<PreferensiTampilan>): PreferensiTampilan {
  const next = gabung({ ...(cache ?? TAMPILAN_AWAL), ...patch });
  cache = next;
  draftSet(TAMPILAN_KEY, next);
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(LS_KEY_LAMA);
  } catch {}
  window.dispatchEvent(new CustomEvent(TAMPILAN_EVENT, { detail: next }));
  return next;
}

/** Dengarkan perubahan dari Pengaturan (tab Tampilan) dan tab lain. */
export function dengarTampilan(cb: (p: PreferensiTampilan) => void): () => void {
  const onPES = (e: Event) => cb(gabung((e as CustomEvent).detail));
  window.addEventListener(TAMPILAN_EVENT, onPES);
  return () => {
    window.removeEventListener(TAMPILAN_EVENT, onPES);
  };
}
