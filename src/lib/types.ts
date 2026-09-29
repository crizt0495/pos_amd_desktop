/**
 * Domain types untuk KasirPro POS (web).
 * Bentuk data ini sesuai kolom tabel supabase/schema.sql.
 */

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
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type ProductInput = {
  barcode?: string | null;
  name: string;
  category?: string;
  price: number;
  cost: number;
  stock: number;
  min_stock?: number;
  unit?: string;
  satuanList?: string[];
  is_active?: boolean;
};

export type DiscountType = 'none' | 'percent' | 'fixed';
export type PaymentMethod = 'cash' | 'qris' | 'transfer' | 'debit' | 'credit';
export type TxStatus = 'completed' | 'void';

export interface Customer {
  id: string;
  name: string;
}

export interface CartLine {
  product_id: string | null;
  barcode: string | null;
  name: string;
  price: number;
  cost: number;
  qty: number;
  discount: number;
  unit: string;
  /** Daftar satuan yang bisa dipilih (dari produk atau default). */
  satuanList: string[];
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

export interface CartTotals {
  subtotal: number;
  discountAmount: number;
  total: number;
  totalCost: number;
  itemCount: number;
  profit: number;
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