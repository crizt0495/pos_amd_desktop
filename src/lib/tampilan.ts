/**
 * Preferensi tampilan kasir untuk "Total Besar" (display untuk pelanggan).
 *
 * Disimpan di localStorage per perangkat — bukan ke kasir_settings — karena ini
 * murni preferensi tampilan mesin kasir: posisinya harus tetap sama setelah
 * reload, dan tidak perlu ikut ke akun kasir lain. Perubahan disiarkan lewat
 * event window supaya Pengaturan dan layar kasir selalu sinkron tanpa reload.
 */

export type PosisiTotal = 'kanan-atas' | 'tengah-atas' | 'bawah' | 'floating';
export type UkuranTotal = 'kecil' | 'sedang' | 'besar' | 'jumbo';

export type PreferensiTampilan = {
  /** Sakelar utama: display ditampilkan atau disembunyikan seluruhnya. */
  aktif: boolean;
  /** true = panel besar; false = pil kecil (tombol [X] Mengecilkan). */
  terbuka: boolean;
  posisi: PosisiTotal;
  ukuran: UkuranTotal;
  /** Posisi px kiri-atas untuk mode bebas (null = pakai preset posisi). */
  x: number | null;
  y: number | null;
};

export const TAMPILAN_KEY = 'kpro_tampilan';
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

/**
 * Jarak tepi layar untuk posisi preset (px).
 * `JARAK_ATAS` sengaja dilebihkan sedikit: di bawah title bar + ribbon (~78px)
 * dan sub-ribbon kasir (~50px) — jadi kotak tidak menutupi tombol Bayar/Cetak.
 * `JARAK_BAWAH` di atas tinggi footer kasir, lestari menutupi tombol Bayar.
 */
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

/** Preferensi saat ini (aman dipanggil sebelum mount / di server). */
export function bacaTampilan(): PreferensiTampilan {
  if (typeof window === 'undefined') return { ...TAMPILAN_AWAL };
  try {
    const raw = window.localStorage.getItem(TAMPILAN_KEY);
    return raw ? gabung(JSON.parse(raw)) : { ...TAMPILAN_AWAL };
  } catch {
    return { ...TAMPILAN_AWAL };
  }
}

/** Gabung patch ke preferensi, simpan, lalu siarkan ke layar lain. */
export function setTampilan(patch: Partial<PreferensiTampilan>): PreferensiTampilan {
  const next = gabung({ ...bacaTampilan(), ...patch });
  try {
    window.localStorage.setItem(TAMPILAN_KEY, JSON.stringify(next));
  } catch {
    /* localStorage penuh / diblokir — preferensi tetap berlaku di sesi ini */
  }
  window.dispatchEvent(new CustomEvent(TAMPILAN_EVENT, { detail: next }));
  return next;
}

/** Dengarkan perubahan dari Pengaturan (tab Tampilan) dan tab lain. */
export function dengarTampilan(cb: (p: PreferensiTampilan) => void): () => void {
  const onPES = (e: Event) => cb(gabung((e as CustomEvent).detail));
  const onStorage = (e: StorageEvent) => {
    if (e.key === TAMPILAN_KEY) cb(bacaTampilan());
  };
  window.addEventListener(TAMPILAN_EVENT, onPES);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(TAMPILAN_EVENT, onPES);
    window.removeEventListener('storage', onStorage);
  };
}
