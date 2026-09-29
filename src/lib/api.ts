import { createClient } from './supabase/client';
import type {
  DailyReport,
  PaymentReport,
  Product,
  ProductInput,
  ReportSummary,
  TopProduct,
  Transaction,
  TransactionItem,
} from './types';

/**
 * Data layer KasirPro POS (web) — semua operasi lewat Supabase REST + RLS.
 * Bentuk seragam:
 *   { ok: true,  data }   -> berhasil
 *   { ok: false, error }  -> gagal (pesan siap tampil)
 */

export interface Ok<T> {
  ok: true;
  data: T;
}
export interface Err {
  ok: false;
  error: string;
}
export type Result<T> = Ok<T> | Err;

function msg(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message?: unknown }).message ?? '');
  return e instanceof Error ? e.message : 'Terjadi kesalahan.';
}

const num = (v: unknown): number => Number(v ?? 0);

function mapProduct(r: Record<string, unknown>): Product {
  return {
    ...(r as unknown as Omit<Product, 'price' | 'cost' | 'stock' | 'min_stock' | 'is_active'>),
    price: num(r.price),
    cost: num(r.cost),
    stock: num(r.stock),
    min_stock: num(r.min_stock),
    is_active: Boolean(r.is_active),
  };
}

function mapTx(r: Record<string, unknown>): Transaction {
  return {
    ...(r as unknown as Omit<Transaction, 'subtotal' | 'discount_value' | 'discount_amount' | 'total' | 'total_cost' | 'paid' | 'change_due'>),
    subtotal: num(r.subtotal),
    discount_value: num(r.discount_value),
    discount_amount: num(r.discount_amount),
    total: num(r.total),
    total_cost: num(r.total_cost),
    paid: num(r.paid),
    change_due: num(r.change_due),
  };
}

function mapItem(r: Record<string, unknown>): TransactionItem {
  return {
    ...(r as unknown as Omit<TransactionItem, 'price' | 'cost' | 'qty' | 'discount' | 'subtotal'>),
    price: num(r.price),
    cost: num(r.cost),
    qty: num(r.qty),
    discount: num(r.discount),
    subtotal: num(r.subtotal),
  };
}

/** User id dari sesi yang sedang login (harus ada — route dilindungi middleware). */
async function currentUserId(): Promise<string> {
  const { data, error } = await createClient().auth.getUser();
  if (error || !data.user) throw new Error('Sesi tidak valid. Silakan muat ulang halaman.');
  return data.user.id;
}

/* ------------------------------- produk ------------------------------- */

export const productsApi = {
  async list(search = '', includeInactive = false): Promise<Result<Product[]>> {
    try {
      let q = createClient().from('kasir_products').select('*');
      if (!includeInactive) q = q.eq('is_active', true);
      if (search.trim()) {
        const s = search.trim().replace(/\*/g, '\\*');
        q = q.or(`name.ilike.*${s}*,barcode.ilike.*${s}*,category.ilike.*${s}*`);
      }
      const { data, error } = await q.order('name', { ascending: true });
      if (error) return { ok: false, error: error.message };
      return { ok: true, data: (data ?? []).map(mapProduct) };
    } catch (e) {
      return { ok: false, error: msg(e) };
    }
  },

  async get(id: string): Promise<Result<Product | null>> {
    try {
      const { data, error } = await createClient().from('kasir_products').select('*').eq('id', id).maybeSingle();
      if (error) return { ok: false, error: error.message };
      return { ok: true, data: data ? mapProduct(data) : null };
    } catch (e) {
      return { ok: false, error: msg(e) };
    }
  },

  async findByBarcode(barcode: string): Promise<Result<Product | null>> {
    try {
      if (!barcode) return { ok: true, data: null };
      const { data, error } = await createClient()
        .from('kasir_products')
        .select('*')
        .eq('barcode', String(barcode).trim())
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();
      if (error) return { ok: false, error: error.message };
      return { ok: true, data: data ? mapProduct(data) : null };
    } catch (e) {
      return { ok: false, error: msg(e) };
    }
  },

  async categories(): Promise<Result<string[]>> {
    try {
      const { data, error } = await createClient().from('kasir_products').select('category');
      if (error) return { ok: false, error: error.message };
      const set = new Set<string>();
      for (const r of data ?? []) {
        if (r.category) set.add(r.category as string);
      }
      return { ok: true, data: [...set].sort() };
    } catch (e) {
      return { ok: false, error: msg(e) };
    }
  },

  async lowStock(): Promise<Result<Product[]>> {
    try {
      const { data, error } = await createClient()
        .from('kasir_products')
        .select('*')
        .eq('is_active', true)
        .order('stock', { ascending: true });
      if (error) return { ok: false, error: error.message };
      const list = (data ?? []).map(mapProduct).filter((p) => p.stock <= p.min_stock);
      return { ok: true, data: list };
    } catch (e) {
      return { ok: false, error: msg(e) };
    }
  },

  async create(data: ProductInput): Promise<Result<Product>> {
    try {
      const uid = await currentUserId();
      const row = {
        user_id: uid,
        barcode: (data.barcode ?? '').trim() || null,
        name: String(data.name ?? '').trim(),
        category: String(data.category ?? 'Umum').trim() || 'Umum',
        price: num(data.price),
        cost: num(data.cost),
        stock: num(data.stock),
        min_stock: num(data.min_stock ?? 0),
        unit: String(data.unit ?? 'pcs').trim() || 'pcs',
        is_active: data.is_active === false ? false : true,
      };
      if (!row.name) return { ok: false, error: 'Nama produk wajib diisi.' };
      const { data: created, error } = await createClient().from('kasir_products').insert(row).select().single();
      if (error) return { ok: false, error: error.message };
      return { ok: true, data: mapProduct(created) };
    } catch (e) {
      return { ok: false, error: msg(e) };
    }
  },

  async update(id: string, data: Partial<ProductInput>): Promise<Result<Product>> {
    try {
      if (data.name !== undefined && !String(data.name).trim()) {
        return { ok: false, error: 'Nama produk wajib diisi.' };
      }
      const patch: Record<string, unknown> = {};
      if (data.barcode !== undefined) patch.barcode = (data.barcode ?? '').trim() || null;
      if (data.name !== undefined) patch.name = String(data.name).trim();
      if (data.category !== undefined) patch.category = String(data.category).trim() || 'Umum';
      if (data.price !== undefined) patch.price = num(data.price);
      if (data.cost !== undefined) patch.cost = num(data.cost);
      if (data.stock !== undefined) patch.stock = num(data.stock);
      if (data.min_stock !== undefined) patch.min_stock = num(data.min_stock);
      if (data.unit !== undefined) patch.unit = String(data.unit).trim() || 'pcs';
      if (data.is_active !== undefined) patch.is_active = Boolean(data.is_active);
      patch.updated_at = new Date().toISOString();

      const { data: updated, error } = await createClient()
        .from('kasir_products')
        .update(patch)
        .eq('id', id)
        .select()
        .single();
      if (error) return { ok: false, error: error.message };
      return { ok: true, data: mapProduct(updated) };
    } catch (e) {
      return { ok: false, error: msg(e) };
    }
  },

  async remove(id: string): Promise<Result<{ id: string }>> {
    try {
      const { error } = await createClient().from('kasir_products').delete().eq('id', id);
      if (error) return { ok: false, error: error.message };
      return { ok: true, data: { id } };
    } catch (e) {
      return { ok: false, error: msg(e) };
    }
  },

  async adjustStock(id: string, delta: number): Promise<Result<Product>> {
    try {
      const cur = await productsApi.get(id);
      if (!cur.ok || !cur.data) return { ok: false, error: 'Produk tidak ditemukan.' };
      return productsApi.update(id, { stock: Math.max(0, num(cur.data.stock) + num(delta)) });
    } catch (e) {
      return { ok: false, error: msg(e) };
    }
  },
};

/** Contoh produk yang dimasukkan otomatis saat daftar pertama kali kosong. */
const SAMPLES = [
  ['8991002101015', 'Indomie Goreng', 'Makanan', 3500, 3000, 40, 10, 'pcs'],
  ['8992760223014', 'Susu Ultra 250ml', 'Minuman', 8000, 6500, 24, 6, 'pcs'],
  ['8999999030001', 'Air Mineral 600ml', 'Minuman', 4000, 3000, 48, 12, 'btl'],
] as const;

export async function ensureSeeded(): Promise<void> {
  try {
    const uid = await currentUserId();
    const { count } = await createClient()
      .from('kasir_products')
      .select('id', { count: 'exact', head: true });
    if (count && count > 0) return;

    await createClient().from('kasir_products').insert(
      SAMPLES.map(([barcode, name, category, price, cost, stock, min_stock, unit]) => ({
        user_id: uid,
        barcode,
        name,
        category,
        price,
        cost,
        stock,
        min_stock,
        unit,
      })),
    );
  } catch {
    /* abaikan — produk contoh tidak wajib */
  }
}

/* ----------------------------- transaksi ----------------------------- */

export interface CreatedTx {
  transaction: Transaction;
  totals: { subtotal: number; discountAmount: number; total: number; totalCost: number; profit: number };
  changeDue: number;
}

export interface TxWithItems {
  transaction: Transaction | null;
  items: TransactionItem[];
}

export const transactionsApi = {
  async create(data: {
    lines: unknown[];
    discountType: string;
    discountValue: number;
    paymentMethod: string;
    paid: number;
    note?: string | null;
    cashierName: string;
  }): Promise<Result<CreatedTx>> {
    try {
      const { data: result, error } = await createClient().rpc('kasir_create_transaction', {
        p_lines: data.lines,
        p_discount_type: data.discountType,
        p_discount_value: num(data.discountValue),
        p_payment_method: data.paymentMethod,
        p_paid: num(data.paid),
        p_note: data.note ?? null,
        p_cashier_name: data.cashierName,
      });
      if (error) return { ok: false, error: error.message };
      const body = result as { transaction: Record<string, unknown>; totals?: Record<string, unknown>; changeDue?: number };
      return {
        ok: true,
        data: {
          transaction: mapTx(body.transaction),
          totals: {
            subtotal: num(body.totals?.subtotal),
            discountAmount: num(body.totals?.discountAmount),
            total: num(body.totals?.total),
            totalCost: num(body.totals?.totalCost),
            profit: num(body.totals?.profit),
          },
          changeDue: num(body.changeDue),
        },
      };
    } catch (e) {
      return { ok: false, error: msg(e) };
    }
  },

  async list(filter: { from?: string; to?: string; limit?: number; offset?: number; status?: string } = {}): Promise<
    Result<Transaction[]>
  > {
    try {
      const limit = Math.min(Math.max(num(filter.limit) || 100, 1), 1000);
      const offset = Math.max(num(filter.offset) || 0, 0);
      let q = createClient().from('kasir_transactions').select('*');
      if (filter.from) q = q.gte('created_at', `${filter.from}T00:00:00.000Z`);
      if (filter.to) q = q.lte('created_at', `${filter.to}T23:59:59.999Z`);
      if (filter.status) q = q.eq('status', filter.status);
      const { data, error } = await q
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
      if (error) return { ok: false, error: error.message };
      return { ok: true, data: (data ?? []).map(mapTx) };
    } catch (e) {
      return { ok: false, error: msg(e) };
    }
  },

  async count(filter: { from?: string; to?: string; status?: string } = {}): Promise<Result<number>> {
    try {
      let q = createClient().from('kasir_transactions').select('id', { count: 'exact', head: true });
      if (filter.from) q = q.gte('created_at', `${filter.from}T00:00:00.000Z`);
      if (filter.to) q = q.lte('created_at', `${filter.to}T23:59:59.999Z`);
      if (filter.status) q = q.eq('status', filter.status);
      const { count, error } = await q;
      if (error) return { ok: false, error: error.message };
      return { ok: true, data: count ?? 0 };
    } catch (e) {
      return { ok: false, error: msg(e) };
    }
  },

  async get(id: string): Promise<Result<TxWithItems>> {
    try {
      const { data: tx, error } = await createClient()
        .from('kasir_transactions')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error) return { ok: false, error: error.message };

      if (!tx) return { ok: true, data: { transaction: null, items: [] } };

      const { data: items, error: iErr } = await createClient()
        .from('kasir_transaction_items')
        .select('*')
        .eq('transaction_id', id);
      if (iErr) return { ok: false, error: iErr.message };

      return {
        ok: true,
        data: {
          transaction: mapTx(tx),
          items: (items ?? []).map(mapItem),
        },
      };
    } catch (e) {
      return { ok: false, error: msg(e) };
    }
  },

  async void(id: string): Promise<Result<Transaction>> {
    try {
      const { data, error } = await createClient().rpc('kasir_void_transaction', { p_tx_id: id });
      if (error) return { ok: false, error: error.message };
      return { ok: true, data: mapTx(data as Record<string, unknown>) };
    } catch (e) {
      return { ok: false, error: msg(e) };
    }
  },
};

/* ------------------------------- laporan ------------------------------ */

function rangePayload(from?: string, to?: string): { p_from: string | null; p_to: string | null } {
  return { p_from: from ?? null, p_to: to ?? null };
}

export const reportsApi = {
  async summary(range: { from?: string; to?: string } = {}): Promise<Result<ReportSummary>> {
    try {
      const { data, error } = await createClient().rpc('kasir_report_summary', rangePayload(range.from, range.to));
      if (error) return { ok: false, error: error.message };
      const r = (data ?? {}) as Record<string, unknown>;
      return {
        ok: true,
        data: {
          jumlah_transaksi: num(r.jumlah_transaksi),
          total_omzet: num(r.total_omzet),
          total_laba: num(r.total_laba),
          total_diskon: num(r.total_diskon),
          total_terima: num(r.total_terima),
          total_item: num(r.total_item),
          rata_rata: num(r.rata_rata),
        },
      };
    } catch (e) {
      return { ok: false, error: msg(e) };
    }
  },

  async topProducts(range: { from?: string; to?: string } = {}): Promise<Result<TopProduct[]>> {
    try {
      const { data, error } = await createClient().rpc('kasir_report_top', {
        ...rangePayload(range.from, range.to),
        p_limit: 10,
      });
      if (error) return { ok: false, error: error.message };
      const rows = (data ?? []) as Record<string, unknown>[];
      return {
        ok: true,
        data: rows.map((r) => ({
          name: String(r.name ?? ''),
          product_id: r.product_id ? String(r.product_id) : null,
          qty: num(r.qty),
          omzet: num(r.omzet),
        })),
      };
    } catch (e) {
      return { ok: false, error: msg(e) };
    }
  },

  async daily(range: { from?: string; to?: string } = {}): Promise<Result<DailyReport[]>> {
    try {
      const { data, error } = await createClient().rpc('kasir_report_daily', rangePayload(range.from, range.to));
      if (error) return { ok: false, error: error.message };
      const rows = (data ?? []) as Record<string, unknown>[];
      return {
        ok: true,
        data: rows.map((r) => ({
          tanggal: String(r.tanggal ?? ''),
          transaksi: num(r.transaksi),
          omzet: num(r.omzet),
          laba: num(r.laba),
        })),
      };
    } catch (e) {
      return { ok: false, error: msg(e) };
    }
  },

  async byPayment(range: { from?: string; to?: string } = {}): Promise<Result<PaymentReport[]>> {
    try {
      const { data, error } = await createClient().rpc('kasir_report_by_payment', rangePayload(range.from, range.to));
      if (error) return { ok: false, error: error.message };
      const rows = (data ?? []) as Record<string, unknown>[];
      return {
        ok: true,
        data: rows.map((r) => ({
          metode: String(r.metode ?? 'cash') as PaymentReport['metode'],
          n: num(r.n),
          omzet: num(r.omzet),
        })),
      };
    } catch (e) {
      return { ok: false, error: msg(e) };
    }
  },
};

/* ------------------------------- setting ------------------------------ */

export const settingsApi = {
  async get<T>(key: string, fallback: T): Promise<T> {
    try {
      const { data, error } = await createClient()
        .from('kasir_settings')
        .select('value')
        .eq('key', key)
        .maybeSingle();
      if (error || !data || data.value === null || data.value === undefined) return fallback;
      return (data.value as T) ?? fallback;
    } catch {
      return fallback;
    }
  },

  async set(key: string, value: unknown): Promise<Result<unknown>> {
    try {
      const uid = await currentUserId();
      const { error } = await createClient()
        .from('kasir_settings')
        .upsert({ user_id: uid, key, value: JSON.parse(JSON.stringify(value)) }, { onConflict: 'user_id,key' });
      if (error) return { ok: false, error: error.message };
      return { ok: true, data: value };
    } catch (e) {
      return { ok: false, error: msg(e) };
    }
  },
};

export type { Product, Transaction, TransactionItem };