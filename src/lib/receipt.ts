import { jumlahBaris, potonganEfektif, round2, rupiah } from './format';
import { kodeSatuan, settingsApi } from './api';
import type { CartLine, ReceiptData, Transaction, TransactionItem } from './types';

/** Penyusun data struk — angka selalu konsisten dengan database. */

export interface StoreMeta {
  name: string;
  address: string;
  phone: string;
  cashier: string;
}

function linesToItems(lines: CartLine[]) {
  return lines.map((l) => ({
    name: l.name,
    price: l.price,
    qty: l.qty,
    // Nama satuan jual ("Dus") — dicetak sebagai kode singkatan ("DS").
    unit: l.unit || '',
    // Nilai efektif (dibatasi harga x qty) supaya angka yang dicetak sama
    // dengan yang dipotong di database; persennya ikut dibawa supaya struk
    // bisa menulis "Pot/Diskon 10%" saat kasir memakai mode %.
    discount: potonganEfektif(l),
    discountPct: l.potonganPct ?? null,
    // Label Diskon Paten (mis. "Diskon Toko"); null = potongan biasa.
    discountLabel: l.potonganLabel ?? null,
    subtotal: jumlahBaris(l),
  }));
}

/** Struk langsung dari keranjang (preview sebelum disimpan). */
export function buildReceiptPreview(args: {
  invoiceNo: string;
  store: StoreMeta;
  lines: CartLine[];
  subtotal: number;
  discountAmount: number;
  total: number;
  paid: number;
  changeDue: number;
  paymentMethod: string;
  note?: string | null;
}): ReceiptData {
  return {
    invoiceNo: args.invoiceNo,
    createdAt: new Date().toISOString(),
    storeName: args.store.name,
    storeAddress: args.store.address,
    storePhone: args.store.phone,
    cashierName: args.store.cashier,
    items: linesToItems(args.lines),
    subtotal: args.subtotal,
    discountAmount: args.discountAmount,
    total: args.total,
    paid: args.paid,
    changeDue: args.changeDue,
    paymentMethod: args.paymentMethod,
    note: args.note ?? null,
  };
}

/** Struk dari transaksi yang tersimpan di database. */
export function buildReceiptFromTx(
  tx: Transaction,
  items: TransactionItem[],
  store: StoreMeta,
): ReceiptData {
  // Diskon struk = potongan tiap baris + diskon level transaksi (yang masih
  // dipakai transaksi lama). Transaksi baru menyimpan diskonnya per item,
  // jadi kolom `discount_amount`-nya 0.
  const potonganItem = round2(items.reduce((sum, i) => sum + (Number(i.discount) || 0), 0));

  return {
    invoiceNo: tx.invoice_no,
    createdAt: tx.created_at,
    storeName: store.name,
    storeAddress: store.address,
    storePhone: store.phone,
    cashierName: tx.cashier_name || store.cashier,
    items: items.map((i) => ({
      name: i.product_name,
      price: i.price,
      qty: i.qty,
      // Kolom `unit` baru diisi transaksi setelah migrasi master_satuan;
      // transaksi lama bernilai '' sehingga struknya tetap tanpa kode.
      unit: i.unit || '',
      discount: i.discount,
      // Persen tidak disimpan di database (UI-only), jadi struk cetak ulang
      // menulis "Pot/Diskon" tanpa persen — lebih baik daripada menebak.
      discountPct: null,
      // Sama seperti persen, label Diskon Paten tidak disimpan di database.
      discountLabel: null,
      subtotal: i.subtotal,
    })),
    subtotal: tx.subtotal,
    discountAmount: round2((Number(tx.discount_amount) || 0) + potonganItem),
    total: tx.total,
    paid: tx.paid,
    changeDue: tx.change_due,
    paymentMethod: tx.payment_method,
    note: tx.note,
  };
}

/** Metadata toko (dipakai saat cetak struk). */
export async function loadStoreMeta(fallbackName = 'KasirPro'): Promise<StoreMeta> {
  const [name, address, phone, cashier] = await Promise.all([
    settingsApi.get<string>('storeName', fallbackName),
    settingsApi.get<string>('storeAddress', ''),
    settingsApi.get<string>('storePhone', ''),
    settingsApi.get<string>('cashierName', 'Kasir'),
  ]);
  return {
    name: name || fallbackName,
    address: address || '',
    phone: phone || '',
    cashier: cashier || 'Kasir',
  };
}

/* ------------------------------ struk 58mm ----------------------------- */

export function formatTanggalStruk(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('id-ID', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** Satu baris item struk, lengkap dengan rincian potongannya. */
export type BarisStruk = {
  name: string;
  qty: number;
  price: number;
  /** Nama satuan jual ("Dus"); '' untuk transaksi lama. */
  unit: string;
  /** Kode singkatan dari master_satuan ("DS"); '' bila tak dikenal. */
  kode: string;
  /** qty x harga sebelum potongan. */
  gross: number;
  /** Potongan baris (dibatasi ke harga x qty). */
  discount: number;
  /** Persen potongan bila diketahui (mode %), null untuk mode Rp. */
  discountPct: number | null;
  /** Label dari Diskon Paten; null = tulis "Pot/Diskon". */
  discountLabel: string | null;
  /** qty x harga - potongan. */
  net: number;
};

/** Rincian tiap item untuk dicetak: nama, qty x harga, potongan, nilai akhir. */
export function barisStruk(d: ReceiptData): BarisStruk[] {
  return d.items.map((it) => {
    const qty = Math.max(Number(it.qty) || 0, 0);
    const price = Math.max(Number(it.price) || 0, 0);
    const gross = round2(price * qty);
    const discount = round2(Math.min(Math.max(Number(it.discount) || 0, 0), gross));
    return {
      name: it.name,
      qty,
      price,
      unit: it.unit ?? '',
      kode: kodeSatuan(it.unit),
      gross,
      discount,
      discountPct: it.discountPct ?? null,
      discountLabel: it.discountLabel ?? null,
      net: round2(gross - discount),
    };
  });
}

/**
 * Judul item di struk/nota: "2 DS Indomie" (qty + kode satuan + nama).
 * Kode dan nama satuan sengaja tidak ditulis berbarengan — cukup kode.
 * Bila kode/satuan tak diketahui (transaksi sebelum master satuan), judul
 * jatuh kembali ke nama barang saja.
 */
export function judulBaris(b: Pick<BarisStruk, 'qty' | 'name' | 'unit' | 'kode'>): string {
  const singkat = b.kode || b.unit || '';
  if (!singkat) return b.name;
  return `${b.qty} ${singkat} ${b.name}`;
}

/** Ringkasan footer struk: subtotal kotor, total potongan, total akhir. */
export function ringkasanStruk(d: ReceiptData, baris: BarisStruk[]) {
  const subtotalKotor = round2(baris.reduce((s, b) => s + b.gross, 0));
  const potonganItem = round2(baris.reduce((s, b) => s + b.discount, 0));
  return {
    subtotalKotor,
    // Potongan per item + diskon level transaksi (khusus transaksi lama).
    // `max` supaya angka di footer tak pernah lebih kecil dari rincian item.
    totalPotongan: round2(Math.max(Number(d.discountAmount) || 0, potonganItem)),
    total: Number(d.total) || 0,
  };
}