import { normalisasiVarian } from './format';
import type { Product, ProductInput, ProductVariant } from './types';

/**
 * Utilitas CSV Produk — Fitur #4 (Export/Import) tanpa library tambahan.
 *
 * Format (satu baris = satu produk):
 *   barcode,nama,kategori,harga_jual,harga_pokok,stok,stok_minimum,satuan,varians
 *
 * `varians` = daftar `satuan|harga_jual|harga_pokok|konversi|barcode` dipisah `;`
 * (contoh: `pcs|5000|3000|1|;renceng|48000|29000|10|`).
 * Nama/kategori boleh mengandung koma (dikutip); newline diganti spasi.
 */

export const KOLOM_CSV = [
  'barcode',
  'nama',
  'kategori',
  'harga_jual',
  'harga_pokok',
  'stok',
  'stok_minimum',
  'satuan',
  'varians',
] as const;

export type ParsedProdukRow = {
  barcode: string;
  nama: string;
  kategori: string;
  harga_jual: number;
  harga_pokok: number;
  stok: number;
  stok_minimum: number;
  satuan: string;
  varian: ProductVariant[];
};

/* ---------------------------- escape / parse ---------------------------- */

/**
 * Parse angka ala Indonesia: "1.500" -> 1500 (titik ribuan),
 * "1.500,50" -> 1500.5, "1,5" -> 1.5, "Rp 3500" -> 3500.
 * Dibuat khusus agar sel angka yang diformat ribuan tidak salah dibaca.
 */
export function parseAngka(s: string): number {
  let t = String(s ?? '').trim();
  if (!t) return 0;
  t = t.replace(/[Rp\s]/gi, '');
  const koma = t.lastIndexOf(',');
  const titik = t.lastIndexOf('.');
  if (koma > -1 && koma > titik) {
    // koma pemisah desimal; titik adalah ribuan.
    t = t.replace(/\./g, '').replace(',', '.');
  } else if (titik > -1 && /^\d{1,3}(\.\d{3})+$/.test(t)) {
    // semua titik adalah ribuan (1.234.567 atau 1.500).
    t = t.replace(/\./g, '');
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

/** Sel CSV: kutip jika mengandung koma/kutip, ganti newline dengan spasi. */
export function cell(t: string): string {
  const s = String(t ?? '').replace(/[\r\n]+/g, ' ');
  return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Parser CSV standar (RFC4180): dukung sel berkutip & kutip ganda `""`. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let inQ = false;
  const src = String(text ?? '').replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQ) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') {
      row.push(cur);
      cur = '';
    } else if (ch === '\n') {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else if (ch !== '\r') cur += ch;
  }
  if (cur !== '' || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

/* ------------------------------- varian -------------------------------- */

const SAN = /[|;\r\n]/g;

function encodeVarian(v: ProductVariant): string {
  return [
    String(v.satuan ?? '').replace(SAN, ' '),
    String(v.harga_jual ?? 0),
    String(v.harga_beli ?? 0),
    String(v.konversi ?? 1),
    String(v.barcode ?? ''),
  ].join('|');
}

export function decodeVarian(s: string): ProductVariant[] {
  const out: ProductVariant[] = [];
  for (const part of String(s ?? '').split(';')) {
    const f = part.split('|');
    if (f.length < 4) continue;
    const satuan = f[0].trim();
    if (!satuan) continue;
    const hargaJual = parseAngka(f[1]);
    const hargaBeli = parseAngka(f[2]);
    const konversi = parseAngka(f[3]);
    if (konversi <= 0) continue;
    out.push({ satuan, harga_beli: hargaBeli, harga_jual: hargaJual, konversi, barcode: f[4]?.trim() || undefined });
  }
  return out;
}

/* ------------------------------- eksport ------------------------------- */

function produkKeBaris(p: Product): string[] {
  const vs = normalisasiVarian(p.variants);
  const variants: ProductVariant[] = vs.length
    ? vs
    : [{ satuan: p.unit || 'pcs', harga_beli: p.cost, harga_jual: p.price, konversi: 1 }];
  return [
    p.barcode ?? '',
    p.name,
    p.category,
    String(p.price),
    String(p.cost),
    String(p.stock),
    String(p.min_stock),
    p.unit || 'pcs',
    variants.map(encodeVarian).join(';'),
  ];
}

/** Seluruh produk -> teks CSV (ber-BOM agar Excel membaca UTF-8 dengan benar). */
export function exportProductsCsv(products: Product[]): string {
  const lines = [KOLOM_CSV.map((k) => cell(k)).join(',')];
  for (const p of products) lines.push(produkKeBaris(p).map(cell).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/** Unduh string sebagai berkas di browser. */
export function unduhTeks(namaFile: string, teks: string): void {
  const blob = new Blob([teks], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = namaFile;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Contoh CSV (3 baris) untuk panduan pengguna. */
export function contohCsv(): string {
  return [
    KOLOM_CSV.map((k) => cell(k)).join(','),
    ['8991002101015', 'Indomie Goreng', 'Makanan', '3500', '3000', '40', '10', 'pcs', 'pcs|3500|3000|1|'].join(','),
    [
      '',
      'Kopi Susu, Spesial (kemasan)',
      'Minuman',
      '12000',
      '9000',
      '20',
      '5',
      'pcs',
      'pcs|12000|9000|1|;dus|115000|86000|12|',
    ].join(','),
    ['8992760223014', '', '', '8000', '6500', '24', '6', 'pcs', 'pcs|8000|6500|1|'].join(','),
  ].join('\r\n');
}

/* ---------------------- impor -> input produk --------------------------- */

/** Baris CSV (yang sudah diparse) -> ProductInput, dengan aturan berikut:
 *  - varian dari kolom `varians` bila valid;
 *  - kalau tidak, pertahankan varian produk lama (bila update);
 *  - kalau produk baru, buat satu varian dari `satuan` + harga. */
export function produkInputDariBaris(b: ParsedProdukRow, existing?: Product | null): ProductInput {
  let variants = b.varian;
  if (!variants.length && existing?.variants?.length) variants = normalisasiVarian(existing.variants);
  if (!variants.length) {
    variants = [
      { satuan: b.satuan || 'pcs', harga_beli: b.harga_pokok, harga_jual: b.harga_jual, konversi: 1 },
    ];
  }
  return {
    barcode: b.barcode || null,
    name: b.nama,
    category: b.kategori,
    price: b.harga_jual,
    cost: b.harga_pokok,
    stock: b.stok,
    min_stock: b.stok_minimum,
    unit: b.satuan || 'pcs',
    variants,
  };
}

const norm = (s: string) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Parse teks CSV produk -> baris + daftar kesalahan (nama wajib). */
export function parseProdukCsv(text: string): { rows: ParsedProdukRow[]; errors: string[] } {
  const errors: string[] = [];
  const cells = parseCsv(text);
  if (!cells.length) return { rows: [], errors: ['File kosong.'] };

  const header = cells[0].map((h) => norm(h));
  const temukan = (nama: string) => header.findIndex((h) => h === nama);
  const iBarcode = temukan('barcode');
  const iNama = temukan('nama');
  const iKat = temukan('kategori');
  const iJual = temukan('harga_jual');
  const iPokok = temukan('harga_pokok');
  const iStok = temukan('stok');
  const iMin = temukan('stok_minimum');
  const iSatuan = temukan('satuan');
  const iVar = temukan('varians');
  if (iNama < 0) return { rows: [], errors: ['Header "nama" tidak ditemukan di baris pertama.'] };

  const angkaCol = (c: string[], i: number): number => (i < 0 ? 0 : parseAngka(c[i]));

  const rows: ParsedProdukRow[] = [];
  for (let r = 1; r < cells.length; r++) {
    const c = cells[r];
    if (!c.some((x) => String(x).trim() !== '')) continue;
    const nama = (iNama >= 0 ? String(c[iNama] ?? '') : '').trim();
    if (!nama) {
      errors.push(`Baris ${r + 1}: nama kosong — dilewati.`);
      continue;
    }
    rows.push({
      barcode: (iBarcode >= 0 ? String(c[iBarcode] ?? '') : '').trim(),
      nama,
      kategori: (iKat >= 0 && String(c[iKat] ?? '').trim()) || 'Umum',
      harga_jual: angkaCol(c, iJual),
      harga_pokok: angkaCol(c, iPokok),
      stok: angkaCol(c, iStok),
      stok_minimum: angkaCol(c, iMin),
      satuan: (iSatuan >= 0 && String(c[iSatuan] ?? '').trim()) || 'pcs',
      varian: decodeVarian(iVar >= 0 ? String(c[iVar] ?? '') : ''),
    });
  }
  return { rows, errors };
}