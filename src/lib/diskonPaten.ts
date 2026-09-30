/**
 * Diskon Paten — diskon tetap yang ditetapkan pemilik toko.
 *
 * Berbeda dari "Diskon Item" di layar kasir (boleh diubah kasir per
 * transaksi), diskon paten dikunci dari Pengaturan: nilai, satuan, dan
 * cakupannya tidak bisa diubah kasir saat melayani. Efeknya:
 *  - kolom Potongan tiap item baru langsung terisi nilai paten,
 *  - input Diskon di form header terkunci + badge "Paten dari Setting",
 *  - struk menulis label sendiri, mis. "Diskon Toko 5%".
 *
 * Baris yang SUDAH ada di keranjang tidak ikut berubah (sama seperti aturan
 * "ganti diskon tak menyentuh baris lama"), jadi kasir masih bisa mengoreksi
 * satu baris bila perlu.
 *
 * Disimpan di localStorage per perangkat — sama seperti preferensi tampilan —
 * supaya terbaca seketika tanpa query database. Tidak ada kolom baru di
 * database: nilai paten sudah ikut tersimpan per item di `transaction_items`.
 */

import { potonganDariDefault, round2, rupiah } from './format';

export type TipeDiskonPaten = 'rp' | 'pct';
export type CakupanDiskonPaten = 'semua' | 'kategori';

export type DiskonPaten = {
  /** Sakelar utama: paten aktif atau tidak. */
  aktif: boolean;
  /** 'rp' = nominal, 'pct' = persen dari harga x qty. */
  tipe: TipeDiskonPaten;
  /** Nominal (Rp) atau persen, mengikuti `tipe`. */
  nilai: number;
  /** Berlaku untuk semua barang, atau hanya satu kategori. */
  cakupan: CakupanDiskonPaten;
  /** Nama kategori yang dipilih; dipakai saat `cakupan = 'kategori'`. */
  kategori: string;
  /** Tulisan yang dicetak di struk, mis. "Diskon Toko". */
  label: string;
};

export const DISKON_PATEN_KEY = 'diskon_paten';
export const DISKON_PATEN_EVENT = 'kpro:diskon-paten';

/** Default: aktif tapi belum ada nilai — kasir tidak suddenly diskon 5%. */
export const DISKON_PATEN_AWAL: DiskonPaten = {
  aktif: false,
  tipe: 'pct',
  nilai: 0,
  cakupan: 'semua',
  kategori: '',
  label: 'Diskon Toko',
};

/** Label cadangan ketika kolom label dikosongkan. */
export const LABEL_PATEN_DEFAULT = 'Diskon Toko';

/** Batas nilai: persen maksimal 100, nominal dibatasi 1 miliar. */
const MAKS_NOMINAL = 1_000_000_000;

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Bersihkan nilai config: tipe/cakupan sah, nilai dibatasi. */
export function rapikanDiskonPaten(v: unknown): DiskonPaten {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<DiskonPaten>;
  const tipe: TipeDiskonPaten = o.tipe === 'rp' ? 'rp' : 'pct';
  const cakupan: CakupanDiskonPaten = o.cakupan === 'kategori' ? 'kategori' : 'semua';
  const kasar = Math.floor(num(o.nilai));
  const nilai =
    tipe === 'pct' ? Math.min(Math.max(kasar, 0), 100) : Math.min(Math.max(kasar, 0), MAKS_NOMINAL);
  const label =
    typeof o.label === 'string' && o.label.trim()
      ? o.label.trim().slice(0, 40)
      : LABEL_PATEN_DEFAULT;
  return {
    aktif: o.aktif === true,
    tipe,
    nilai,
    cakupan,
    // Kategori tak ada artinya cakupan kategori tidak mungkin berlaku.
    kategori: typeof o.kategori === 'string' ? o.kategori : '',
    label,
  };
}

/** Config saat ini (aman dipanggil sebelum mount / di server). */
export function bacaDiskonPaten(): DiskonPaten {
  if (typeof window === 'undefined') return { ...DISKON_PATEN_AWAL };
  try {
    const raw = window.localStorage.getItem(DISKON_PATEN_KEY);
    return raw ? rapikanDiskonPaten(JSON.parse(raw)) : { ...DISKON_PATEN_AWAL };
  } catch {
    return { ...DISKON_PATEN_AWAL };
  }
}

/** Gabung patch ke config, simpan, lalu siarkan ke layar lain. */
export function setDiskonPaten(patch: Partial<DiskonPaten>): DiskonPaten {
  const next = rapikanDiskonPaten({ ...bacaDiskonPaten(), ...patch });
  try {
    window.localStorage.setItem(DISKON_PATEN_KEY, JSON.stringify(next));
  } catch {
    /* localStorage penuh / diblokir — config tetap berlaku di sesi ini */
  }
  window.dispatchEvent(new CustomEvent(DISKON_PATEN_EVENT, { detail: next }));
  return next;
}

/** Dengarkan perubahan dari Pengaturan (dan tab lain). */
export function dengarDiskonPaten(cb: (c: DiskonPaten) => void): () => void {
  const onPES = (e: Event) => cb(rapikanDiskonPaten((e as CustomEvent).detail));
  const onStorage = (e: StorageEvent) => {
    if (e.key === DISKON_PATEN_KEY) cb(bacaDiskonPaten());
  };
  window.addEventListener(DISKON_PATEN_EVENT, onPES);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(DISKON_PATEN_EVENT, onPES);
    window.removeEventListener('storage', onStorage);
  };
}

/** Cakupan paten berlaku untuk produk ini? (produk tanpa kategori = tidak). */
export function patenBerlaku(
  c: DiskonPaten,
  p: { category?: string | null } | null | undefined,
): boolean {
  if (!c.aktif) return false;
  if (c.cakupan === 'semua') return true;
  const kat = (p?.category ?? '').trim().toLowerCase();
  return Boolean(c.kategori) && kat === c.kategori.trim().toLowerCase();
}

/** True kalau paten ada dan punya nilai > 0 (baris seeded dari paten). */
export function patenAdaNilai(c: DiskonPaten | null): boolean {
  return Boolean(c && c.aktif && c.nilai > 0);
}

/** Potongan paten untuk satu baris (0 kalau tak berlaku / nilai 0). */
export function potonganPaten(
  c: DiskonPaten,
  l: { price: number; qty: number },
  p?: { category?: string | null } | null,
): number {
  if (!patenAdaNilai(c)) return 0;
  if (p !== undefined && !patenBerlaku(c, p)) return 0;
  return potonganDariDefault(l, c.tipe === 'pct' ? 'percent' : 'fixed', c.nilai);
}

/** Persen paten (untuk kolom Potongan mode %); null kalau mode nominal. */
export function persenPaten(c: DiskonPaten): number | null {
  if (!patenAdaNilai(c) || c.tipe !== 'pct') return null;
  return Math.min(100, Math.max(0, Math.floor(c.nilai)));
}

/** Label yang dicetak di struk (tanpa angka nominal — Angeles sudah di kanan). */
export function labelStrukPaten(c: DiskonPaten): string {
  return c.label || LABEL_PATEN_DEFAULT;
}

/** Ringkasan singkat buat info di bawah input kasir & pratinjau di Pengaturan. */
export function ringkasanPaten(c: DiskonPaten): string {
  if (!c.aktif) return 'Nonaktif';
  if (!patenAdaNilai(c)) return 'Aktif, tapi nilai masih 0';
  const nilai = c.tipe === 'pct' ? `${Math.floor(c.nilai)}%` : rupiah(c.nilai);
  const cakup = c.cakupan === 'kategori' && c.kategori ? `kategori ${c.kategori}` : 'semua barang';
  return `${nilai} per item baru · ${cakup}`;
}

/** Contoh nominal untuk pratinjau struk di Pengaturan (harga 3.500, qty 1). */
export function contohPotonganPaten(c: DiskonPaten): number {
  return round2(potonganPaten(c, { price: 3500, qty: 1 }));
}
