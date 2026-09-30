/**
 * Domain types untuk KasirPro POS (web).
 * Bentuk data ini sesuai kolom tabel supabase/schema.sql.
 */

/** Varian satuan: harga jual/pokok & konversi per satuan (mis. Pcs vs Dus/6).
 *
 *  Bentuk ini yang disimpan di `kasir_products.variants` dan `satuan_list`
 *  (jsonb). Baris pertama = satuan dasar (konversi 1) dan dipakai untuk stok.
 *  `harga_pokok` hanya dibaca sebagai alias lama (v1 memakai nama itu);
 *  data baru selalu ditulis dengan `harga_beli`.
 */
export interface ProductVariant {
  satuan: string;
  /** Harga beli/modal per satuan ini. */
  harga_beli: number;
  /** Harga jual per satuan ini. */
  harga_jual: number;
  /** Berapa satuan dasar dalam 1 varian ini (Dus/6 = 6). Baris dasar = 1. */
  konversi: number;
  /** Barcode khusus satuan ini; kosong = pakai barcode utama produk. */
  barcode?: string;
}

export interface Product {
  id: string;
  barcode: string | null;
  name: string;
  category: string;
  price: number;
  cost: number;
  stock: number;
  min_stock: number;
  unit: string;
  satuanList: string[];
  /** Varian satuan; kosong = pakai harga produk apa adanya. */
  variants: ProductVariant[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type ProductInput = {
  barcode?: string | null;
  name: string;
  category?: string;
  /** Harga jual satuan dasar. Diisi dari varian baris pertama. */
  price: number;
  /** Harga modal satuan dasar. Diisi dari varian baris pertama. */
  cost: number;
  stock: number;
  min_stock?: number;
  /** Satuan dasar. Diisi dari varian baris pertama. */
  unit?: string;
  /** Daftar varian (dari tabel satuan). */
  variants?: ProductVariant[];
  is_active?: boolean;
};

export type DiscountType = 'none' | 'percent' | 'fixed';
export type PaymentMethod = 'cash' | 'qris' | 'transfer' | 'debit' | 'credit';
export type TxStatus = 'completed' | 'void';

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
}

export type CustomerInput = {
  name: string;
  phone?: string | null;
  address?: string | null;
};

export interface CartLine {
  product_id: string | null;
  barcode: string | null;
  name: string;
  price: number;
  cost: number;
  qty: number;
  /** Potongan flat untuk satu baris (bukan per satuan): qty x price - discount. */
  discount: number;
  /**
   * Potongan bentuk persen (UI-only, TIDAK disimpan ke DB). Dipakai saat kolom
   * Potongan dalam mode "%": discount = min(pct,100)% dari harga x qty. Saat
   * "Rp", field ini null. Selalu di-strip sebelum dikirim ke API/RPC.
   */
  potonganPct?: number | null;
  unit: string;
  /** Daftar satuan yang bisa dipilih (dari produk atau default). */
  satuanList: string[];
  /** Varian satuan produk ini (dipakai saat kolom SATUAN diubah). */
  variants: ProductVariant[];
  /** Stok saat ditambahkan (untuk membatasi tombol +). */
  stock: number | null;
}

export interface Transaction {
  id: string;
  invoice_no: string;
  subtotal: number;
  discount_type: DiscountType;
  discount_value: number;
  discount_amount: number;
  total: number;
  total_cost: number;
  paid: number;
  change_due: number;
  payment_method: PaymentMethod;
  note: string | null;
  cashier_name: string | null;
  customer_name: string | null;
  status: TxStatus;
  created_at: string;
}

export interface TransactionItem {
  id: string;
  transaction_id: string;
  product_id: string | null;
  barcode: string | null;
  product_name: string;
  price: number;
  cost: number;
  qty: number;
  discount: number;
  subtotal: number;
}

export interface ReportSummary {
  jumlah_transaksi: number;
  total_omzet: number;
  total_laba: number;
  total_diskon: number;
  total_terima: number;
  total_item: number;
  rata_rata: number;
}

export interface TopProduct {
  name: string;
  product_id: string | null;
  qty: number;
  omzet: number;
}

export interface DailyReport {
  tanggal: string;
  transaksi: number;
  omzet: number;
  laba: number;
}

export interface PaymentReport {
  metode: PaymentMethod;
  n: number;
  omzet: number;
}

/** Header retur penjualan (kasir_returns). */
export interface ReturnRecord {
  id: string;
  transaction_id: string;
  invoice_no: string;
  retur_no: string;
  total: number;
  cashier_name: string | null;
  note: string | null;
  created_at: string;
}

/** Baris retur penjualan (kasir_return_items). */
export interface ReturnItem {
  id: string;
  return_id: string;
  transaction_item_id: string | null;
  product_id: string | null;
  product_name: string;
  price: number;
  cost: number;
  qty: number;
  discount: number;
  refund: number;
}

/** Satu baris input retur — dikirim ke RPC `kasir_create_return`. */
export interface ReturnLineInput {
  transaction_item_id: string;
  product_id?: string | null;
  qty: number;
}

/** Shift kasir (kasir_shifts): sesi buka/tutup + setup laci. */
export interface KasirShift {
  id: string;
  cashier_name: string;
  shift_no: string;
  opened_at: string;
  closed_at: string | null;
  opening_cash: number;
  closing_cash: number | null;
  expected_cash: number | null;
  status: 'open' | 'closed';
}

/** Baris laporan per kasir (kasir_report_by_cashier). */
export interface CashierReport {
  kasir: string;
  transaksi: number;
  omzet: number;
  laba: number;
}

/** Mutasi stok di kartu stok (kasir_stock_logs). qty BERTANDA: +masuk, -keluar. */
export interface StockLog {
  id: string;
  product_id: string;
  tipe: 'terjual' | 'retur' | 'stok_masuk' | 'stok_keluar' | 'void';
  qty: number;
  stok_sebelum: number | null;
  stok_sesudah: number | null;
  keterangan: string | null;
  ref_id: string | null;
  ref_tipe: 'transaksi' | 'retur' | null;
  created_at: string;
}

export interface CartTotals {
  subtotal: number;
  total: number;
  totalCost: number;
  itemCount: number;
  profit: number;
  /** Total seluruh potongan per baris (flat). */
  potonganBaris: number;
}

export interface ReceiptData {
  invoiceNo: string;
  createdAt: string;
  storeName: string;
  storeAddress?: string;
  storePhone?: string;
  cashierName: string;
  items: { name: string; price: number; qty: number; discount: number; subtotal: number }[];
  subtotal: number;
  discountAmount: number;
  total: number;
  paid: number;
  changeDue: number;
  paymentMethod: string;
  note?: string | null;
}

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Tunai',
  qris: 'QRIS',
  transfer: 'Transfer',
  debit: 'Kartu Debit',
  credit: 'Kartu Kredit',
};