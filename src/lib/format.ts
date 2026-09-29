import type { CartLine, CartTotals, DiscountType } from './types';

/** Format & perhitungan lokal (salinan dari KasirPro Desktop). */

const ANGKA = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });

export const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** "Rp. 12.500" */
export function rupiah(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 'Rp. 0';
  return `Rp. ${ANGKA.format(n)}`;
}

export function angka(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '0';
  return ANGKA.format(n);
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

export function hitungTotal(
  lines: CartLine[],
  discountType: DiscountType,
  discountValue: number,
): CartTotals {
  const subtotal = round2(lines.reduce((sum, l) => sum + (l.price - (l.discount || 0)) * l.qty, 0));
  const totalCost = round2(lines.reduce((sum, l) => sum + l.cost * l.qty, 0));

  let discountAmount = 0;
  if (discountType === 'percent') {
    discountAmount = round2((subtotal * Math.min(Math.max(discountValue || 0, 0), 100)) / 100);
  } else if (discountType === 'fixed') {
    discountAmount = round2(Math.min(Math.max(discountValue || 0, 0), subtotal));
  }

  const total = round2(Math.max(0, subtotal - discountAmount));

  return {
    subtotal,
    discountAmount,
    total,
    totalCost,
    itemCount: lines.reduce((n, l) => n + l.qty, 0),
    profit: round2(total - totalCost),
  };
}

export function hitungKembali(total: number, paid: number): number {
  return round2(Math.max(0, paid - total));
}

/** Gabungkan item yang sama (produk terdaftar berdasarkan id, manual berdasarkan nama). */
export function gabungKeranjang(lines: CartLine[], incoming: CartLine): CartLine[] {
  const idx = lines.findIndex(
    (l) =>
      (incoming.product_id && l.product_id === incoming.product_id) ||
      (!incoming.product_id && l.barcode && l.barcode === incoming.barcode) ||
      (!incoming.product_id && !l.product_id && l.name === incoming.name),
  );

  if (idx < 0) return [...lines, { ...incoming }];

  const next = [...lines];
  const line = next[idx]!;
  const merged = { ...line, qty: round2(line.qty + incoming.qty) };
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