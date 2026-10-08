import type { CartLine, CartTotals, ProductVariant } from './types';

/** Format & perhitungan lokal (salinan dari KasirPro Desktop). */

const ANGKA = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });

export const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** "Rp. 12.500" */
export function rupiah(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 'Rp. 0';
  return `Rp. ${ANGKA.format(n)}`;
}

/** Alias eksplisit untuk format ribuan gaya Indonesia. */
export const formatRupiah = rupiah;

export function angka(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '0';
  return ANGKA.format(n);
}

/** Bersihkan input uang yang diketik user: "Rp. 15.000" / "15.000" -> 15000. */
export function parseRupiah(value: string | number | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const digits = String(value ?? '').replace(/[^\d-]/g, '');
  const n = Number(digits);
  return Number.isFinite(n) ? n : 0;
}

/** "10 Nov 2025, 14:32" */
export function tanggalWaktu(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "10 Nov 2025" */
export function tanggal(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function isoHariIni(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Tanggal N hari lalu (untuk rentang 7/30 hari). */
export function isoHariLalu(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/* ------------------------------- keranjang ------------------------------ */

/** Normalisasi daftar varian dari jsonb database.
 *
 *  Menoleransi data versi lama (`harga_pokok`) dan data yang belum lengkap,
 *  serta membuang baris yang tidak punya nama satuan.
 */
export function normalisasiVarian(v: unknown): ProductVariant[] {
  if (!Array.isArray(v)) return [];

  // Bentuk lama: array of object (v1, `harga_pokok`) atau array of string
  // (kolom `satuan_list` versi paling awal).
  const objs = v.map((raw) => {
    if (typeof raw === 'string') {
      const s = raw.trim();
      return s ? { satuan: s } : null;
    }
    return (raw ?? {}) as Record<string, unknown>;
  });

  return objs
    .map((o) => {
      if (!o) return null;
      const satuan = String(o.satuan ?? '').trim();
      if (!satuan) return null;
      const hargaJual = Number(o.harga_jual);
      // `harga_pokok` = nama kolom versi v1; `harga_beli` = nama sekarang.
      const hargaBeli = Number(o.harga_beli ?? o.harga_pokok);
      const konversi = Number(o.konversi);
      const barcode = String(o.barcode ?? '').trim();
      return {
        satuan,
        harga_jual: Number.isFinite(hargaJual) ? hargaJual : 0,
        harga_beli: Number.isFinite(hargaBeli) ? hargaBeli : 0,
        konversi: Number.isFinite(konversi) && konversi > 0 ? konversi : 1,
        ...(barcode ? { barcode } : {}),
      } satisfies ProductVariant;
    })
    .filter((v): v is ProductVariant => v !== null);
}

/** Varian yang cocok dengan nama satuan (case-insensitive, longgar spasi). */
export function cariVarian(
  variants: ProductVariant[] | null | undefined,
  satuan: string,
): ProductVariant | null {
  if (!Array.isArray(variants) || !variants.length) return null;
  const key = String(satuan ?? '').trim().toLowerCase();
  if (!key) return null;
  return variants.find((v) => v.satuan.trim().toLowerCase() === key) ?? null;
}

/** Produk yang punya varian dengan barcode satuan ini (bukan barcode utama). */
export function cariProdukByBarcodeVarian(
  products: { id: string; barcode: string | null; variants: ProductVariant[] }[],
  barcode: string,
): string | null {
  const key = String(barcode ?? '').trim().toLowerCase();
  if (!key) return null;
  for (const p of products) {
    const v = normalisasiVarian(p.variants).find(
      (x) => String(x.barcode ?? '').trim().toLowerCase() === key,
    );
    if (v) return p.id;
  }
  return null;
}

/** Daftar satuan yang bisa dipilih pada satu produk (baris keranjang).
 *  Prioritas: varian produk; lalu satuan_list; fallback default + unit. */
export function satuanOptions(p: {
  unit?: string | null;
  satuanList?: string[];
  variants?: ProductVariant[] | null;
}): string[] {
  const varian = normalisasiVarian(p.variants);
  const sumber = varian.length
    ? varian.map((v) => v.satuan)
    : Array.isArray(p.satuanList) && p.satuanList.length
      ? p.satuanList.map(String)
      : ['Pcs', 'Dus/6', 'Pack'];

  const key = (s: string) => s.trim().toLowerCase();

  // Satuan dasar produk hanya menambah opsi baru bila benar-benar tidak
  // tercakup di daftar (satuan_list tidak boleh menduplikasi varian, dan
  // perbandingan case-insensitive: unit "pcs" sudah tercakup varian "Pcs").
  const tercakup = new Set(sumber.map(key));
  const base = [...sumber];
  const unit = String(p.unit ?? '').trim();
  if (unit && !tercakup.has(key(unit))) base.unshift(unit);

  // Buang duplikat yang lolos (mis. satuan_list sendiri berisi nama kembar).
  const unik = new Set<string>();
  const hasil = base.filter((s) => {
    const k = key(s);
    if (!k || unik.has(k)) return false;
    unik.add(k);
    return true;
  });

  return hasil.length ? hasil : ['Pcs'];
}

/** Harga jual/modal untuk satu satuan; jatuh ke harga produk bila tanpa varian. */
export function hargaSatuan(
  p: { price: number; cost: number },
  variants: ProductVariant[] | null | undefined,
  satuan: string,
): { price: number; cost: number } {
  const v = cariVarian(variants, satuan);
  return {
    price: v ? v.harga_jual : p.price,
    cost: v ? v.harga_beli : p.cost,
  };
}

/* --------------------------- validasi varian --------------------------- */

export type VarianBaris = {
  satuan: string;
  harga_beli: string;
  harga_jual: string;
  konversi: string;
  barcode: string;
};

export type VarianError = {
  /** Indeks baris yang bermasalah; -1 = masalah umum. */
  index: number;
  pesan: string;
};

/** Nama satuan kembar (case-insensitive)? Kembalikan nama yang kembar. */
export function satuanKembar(baris: { satuan: string }[]): string | null {
  const lihat = new Set<string>();
  for (const b of baris) {
    const k = String(b.satuan ?? '').trim().toLowerCase();
    if (!k) continue;
    if (lihat.has(k)) return b.satuan.trim();
    lihat.add(k);
  }
  return null;
}

/** Baris varian yang tidak bisa disimpan, dengan pesan per baris. */
export function validasiVarian(baris: VarianBaris[]): VarianError[] {
  const err: VarianError[] = [];
  const isi = baris.filter((b) => b.satuan.trim());

  if (isi.length === 0) {
    err.push({ index: -1, pesan: 'Minimal 1 satuan harus diisi.' });
    return err;
  }

  const kembar = satuanKembar(isi);
  if (kembar) err.push({ index: -1, pesan: `Satuan "${kembar}" dipakai lebih dari sekali.` });

  // Modal induk (baris 1) = sumber konversi untuk semua baris turunan.
  const modalUtama = parseRupiah(baris[0]?.harga_beli ?? '0');

  baris.forEach((b, i) => {
    if (!b.satuan.trim()) return; // baris kosong diabaikan, bukan error
    const jual = parseRupiah(b.harga_jual);
    const beli = parseRupiah(b.harga_beli);
    const konv = Number(b.konversi);
    if (jual <= 0) err.push({ index: i, pesan: 'Harga jual harus lebih dari 0.' });
    if (beli <= 0) err.push({ index: i, pesan: 'Harga modal harus lebih dari 0.' });
    if (!Number.isFinite(konv) || konv <= 0) {
      err.push({ index: i, pesan: 'Konversi harus lebih dari 0.' });
    }
    // Baris 2+ (turunan): modal otomatis = modal utama / konversi. Kalau
    // diisi, nilainya TIDAK BOLEH di bawah kalkulasi itu.
    if (i > 0 && Number.isFinite(konv) && konv > 0) {
      const minimal = Math.round(modalUtama / konv);
      if (beli > 0 && beli < minimal) {
        err.push({
          index: i,
          pesan: `Modal ${b.satuan.trim() || `baris ${i + 1}`} minimal Rp. ${minimal.toLocaleString('id-ID')}`,
        });
      }
    }
  });

  return err;
}

/** Varian yang dijual di bawah harga modal (peringatan kuning, bukan blocker). */
export function varianRugi(baris: VarianBaris[]): VarianBaris[] {
  return baris.filter(
    (b) => b.satuan.trim() && parseRupiah(b.harga_jual) > 0 && parseRupiah(b.harga_jual) < parseRupiah(b.harga_beli),
  );
}

/** Baris varian -> objek siap simpan (angka bersih, tanpa baris kosong). */
export function varianKeJson(baris: VarianBaris[]): ProductVariant[] {
  return baris
    .filter((b) => b.satuan.trim())
    .map((b, i) => {
      const barcode = b.barcode.trim();
      return {
        satuan: b.satuan.trim(),
        harga_beli: parseRupiah(b.harga_beli),
        harga_jual: parseRupiah(b.harga_jual),
        // Baris pertama selalu satuan dasar, apa pun yang diketik.
        konversi: i === 0 ? 1 : Math.max(1, Number(b.konversi) || 1),
        ...(barcode ? { barcode } : {}),
      } satisfies ProductVariant;
    });
}

/** Batas potongan satu baris: harga x qty (potongan tak boleh melebihi nilai baris). */
export function potonganMax(l: Pick<CartLine, 'price' | 'qty'>): number {
  return round2(Math.max(0, (Number(l.price) || 0) * (Number(l.qty) || 0)));
}

/** Potongan efektif baris = diskon yang "dipotong" beneran = min(discount, harga x qty). */
export function potonganEfektif(l: Pick<CartLine, 'price' | 'qty' | 'discount'>): number {
  return round2(Math.min(Math.max(Number(l.discount) || 0, 0), potonganMax(l)));
}

/**
 * Potongan bentuk persen -> nominal: min(pct, 100)% dari harga x qty.
 * (pct > 100 di-batas ke 100 sehingga diskon tak pernah melebihi nilai baris.)
 */
export function potonganDariPct(l: Pick<CartLine, 'price' | 'qty'>, pct: number): number {
  return round2((Math.min(Math.max(Number(pct) || 0, 0), 100) / 100) * potonganMax(l));
}

/**
 * "Diskon" pada form header -> nominal potongan satu baris (default Potongan
 * item yang baru di-scan).
 * - 'fixed'   -> Rp, dibatasi ke harga x qty (baris gratis bila >= nilai baris)
 * - 'percent' -> % dari harga x qty, dibatasi 100%
 * Nilai 0 = tanpa potongan.
 */
export function potonganDariDefault(
  l: Pick<CartLine, 'price' | 'qty'>,
  tipe: 'fixed' | 'percent',
  nilai: number,
): number {
  const v = Math.max(Number(nilai) || 0, 0);
  if (!v) return 0;
  return tipe === 'percent' ? potonganDariPct(l, v) : round2(Math.min(v, potonganMax(l)));
}

/** Persentase potongan yang sedang berlaku pada satu baris (untuk mode %). */
export function persenPotongan(l: Pick<CartLine, 'price' | 'qty' | 'discount'>): number | null {
  const max = potonganMax(l);
  const d = Math.max(Number(l.discount) || 0, 0);
  if (max <= 0 || d <= 0) return null;
  return Math.min(100, Math.round((d / max) * 100));
}

/** Jumlah satu baris: qty x H. Jual - Potongan efektif (tak pernah negatif). */
export function jumlahBaris(l: Pick<CartLine, 'price' | 'qty' | 'discount'>): number {
  return round2(potonganMax(l) - potonganEfektif(l));
}

/** Total transaksi = jumlah seluruh baris (potongan sudah dipotong per baris).
 *  Tidak ada diskon level transaksi lagi: diskon form header dipakai sebagai
 *  default Potongan tiap item baru, jadi dipotong lagi di sini akan membuat
 *  nominal terpotong dua kali. */
export function hitungTotal(lines: CartLine[]): CartTotals {
  const subtotal = round2(lines.reduce((sum, l) => sum + jumlahBaris(l), 0));
  const totalCost = round2(lines.reduce((sum, l) => sum + l.cost * l.qty, 0));
  // Potongan dihitung dari nilai efektif (min(discount, harga x qty)) supaya
  // angka yang ditampilkan = yang benar-benar dipotong, bukan angka mentah.
  const potonganBaris = round2(lines.reduce((sum, l) => sum + potonganEfektif(l), 0));

  return {
    subtotal,
    total: subtotal,
    totalCost,
    itemCount: lines.reduce((n, l) => n + l.qty, 0),
    profit: round2(subtotal - totalCost),
    potonganBaris,
  };
}

export function hitungKembali(total: number, paid: number): number {
  return round2(Math.max(0, paid - total));
}

/** Gabungkan item yang sama (produk terdaftar berdasarkan id, manual berdasarkan nama). Sama produk tidak otomatis sama: satuan/harga berbeda tidak boleh digabung. */
export function gabungKeranjang(lines: CartLine[], incoming: CartLine): CartLine[] {
  const idx = lines.findIndex(
    (l) =>
      ((incoming.product_id && l.product_id === incoming.product_id) ||
        (!incoming.product_id && l.barcode && l.barcode === incoming.barcode) ||
        (!incoming.product_id && !l.product_id && l.name === incoming.name)) &&
      l.unit.toLowerCase() === incoming.unit.toLowerCase() &&
      l.price === incoming.price,
  );

  if (idx < 0) return [...lines, { ...incoming }];

  const next = [...lines];
  const line = next[idx]!;
  const qtyBaru = round2(line.qty + incoming.qty);
  // Potongan mode % harus ikut terhitung ulang saat qty bergabung.
  const discount =
    line.potonganPct != null
      ? round2(Math.min(Math.max(0, line.price * qtyBaru * Math.min(100, Math.max(0, line.potonganPct)) / 100), potonganMax({ price: line.price, qty: qtyBaru })))
      : line.discount ?? 0;
  const merged = { ...line, qty: qtyBaru, discount };
  next[idx] =
    typeof line.stock === 'number' ? { ...merged, qty: Math.min(merged.qty, Math.max(1, line.stock)) } : merged;
  return next;
}

/** Ubah qty satu baris (minimal 1, maksimal stok bila ada). */
export function setQty(lines: CartLine[], index: number, qty: number): CartLine[] {
  const line = lines[index];
  if (!line) return lines;

  let next = Math.max(1, round2(qty));
  if (typeof line.stock === 'number') next = Math.min(next, Math.max(1, line.stock));

  const copy = [...lines];
  copy[index] = { ...line, qty: next };
  return copy;
}