import { jumlahBaris, rupiah } from './format';
import { settingsApi } from './api';
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
    discount: l.discount,
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
      discount: i.discount,
      subtotal: i.subtotal,
    })),
    subtotal: tx.subtotal,
    discountAmount: tx.discount_amount,
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

/** Row item struk yang aman di baris 58mm (nama dipotong + harga/baris). */
export function lineItems(d: ReceiptData): { name: string; sub: string }[] {
  return d.items.map((it) => {
    const name = `${it.qty > 1 ? `${it.qty}x ` : ''}${it.name}`;
    return { name, sub: rupiah(it.subtotal) };
  });
}