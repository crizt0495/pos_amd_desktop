import { createClient } from './supabase/client';
import { isoHariIni, normalisasiVarian } from './format';
import { bersihkanTelepon } from './telepon';
import type {
  CashierReport,
  Customer,
  CustomerInput,
  DailyReport,
  KasirShift,
  PaymentReport,
  Product,
  ProductInput,
  ReportSummary,
  ReturnItem,
  ReturnLineInput,
  ReturnRecord,
  StockLog,
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

/**
 * Pesan error dari PostgREST yang bisa ditindaklanjuti. Bila RPC/tabel belum
 * ada di database (migrasi belum dijalankan, atau schema cache PostgREST
 * belum reload), PostgREST mengembalikan kalimat teknis — diterjemahkan jadi
 * arahan singkat supaya tidak confusing di layar kasir.
 */
function rpcMsg(error: { message: string } | null, fitur: string): string {
  const m = error?.message ?? 'Terjadi kesalahan.';
  if (/could not find the function|schema cache|does not exist/i.test(m)) {
    return `Database belum mendukung ${fitur}. Jalankan migrasi terkait di Supabase → SQL Editor, lalu muat ulang aplikasi.`;
  }
  return m;
}

const num = (v: unknown): number => Number(v ?? 0);

function mapProduct(r: Record<string, unknown>): Product {
  // Sumber varian: kolom `variants` (baru). `satuan_list` versi lama hanya
  // berisi nama satuan, jadi dipakai sebagai fallback agar produk lama yang
  // belum punya `variants` tetap bisa ditampilkan.
  const variants = normalisasiVarian(r.variants);
  const legacyUnits = Array.isArray(r.satuan_list) ? (r.satuan_list as unknown[]).map(String) : [];
  const satuanList = variants.length
    ? variants.map((v) => v.satuan)
    : legacyUnits.filter(Boolean);

  return {
    ...(r as unknown as Omit<Product, 'price' | 'cost' | 'stock' | 'min_stock' | 'is_active' | 'satuanList' | 'variants'>),
    price: num(r.price),
    cost: num(r.cost),
    stock: num(r.stock),
    min_stock: num(r.min_stock),
    is_active: Boolean(r.is_active),
    satuanList,
    variants,
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
        ...(data.variants !== undefined
          ? {
              // `variants` kolom jsonb; `satuan_list` ikut ditulis sebagai
              // daftar nama satuan supaya kolom lama tetap konsisten.
              variants: normalisasiVarian(data.variants) as unknown as Record<string, unknown>[],
              satuan_list: normalisasiVarian(data.variants).map((v) => v.satuan),
            }
          : {}),
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
      if (data.variants !== undefined) {
        const varian = normalisasiVarian(data.variants);
        patch.variants = varian;
        patch.satuan_list = varian.map((v) => v.satuan);
      }
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

  async adjustStock(id: string, delta: number, keterangan?: string): Promise<Result<Product>> {
    try {
      // RPC atomik (update + catat kartu stok) jika migrasi sudah dijalankan.
      const r = await createClient().rpc('kasir_adjust_stock', {
        p_product_id: id,
        p_delta: num(delta),
        p_keterangan: keterangan ?? null,
      });
      if (!r.error) return { ok: true, data: mapProduct(r.data as Record<string, unknown>) };
      // PGRST202 = fungsi belum ada (migrasi belum dijalankan) -> fallback lambat
      // lewat get+update agar ± stok tetap jalan tanpa update database.
      if ((r.error as { code?: string }).code !== 'PGRST202') {
        return { ok: false, error: r.error.message };
      }
      const cur = await productsApi.get(id);
      if (!cur.ok || !cur.data) return { ok: false, error: 'Produk tidak ditemukan.' };
      return productsApi.update(id, { stock: Math.max(0, num(cur.data.stock) + num(delta)) });
    } catch (e) {
      return { ok: false, error: msg(e) };
    }
  },
};

/** Kartu stok (Fitur #5): riwayat mutasi stok per produk. */
export const stockApi = {
  async logs(productId: string): Promise<Result<StockLog[]>> {
    try {
      const { data, error } = await createClient().rpc('kasir_stock_logs_list', {
        p_product_id: productId,
      });
      if (error) return { ok: false, error: rpcMsg(error, 'kartu stok') };
      const list = Array.isArray(data) ? data : [];
      return {
        ok: true,
        data: list.map((x) => ({
          ...(x as unknown as Omit<StockLog, 'qty' | 'stok_sebelum' | 'stok_sesudah'>),
          qty: num((x as Record<string, unknown>).qty),
          stok_sebelum: (x as Record<string, unknown>).stok_sebelum == null ? null : num((x as Record<string, unknown>).stok_sebelum),
          stok_sesudah: (x as Record<string, unknown>).stok_sesudah == null ? null : num((x as Record<string, unknown>).stok_sesudah),
        })),
      };
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
    if (count && count > 0) {
      // tetap pastikan satuan_list terisi untuk produk lama
    } else {
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
          satuan_list: ['Pcs', 'Dus/6', 'Pack'],
        })),
      );
    }

    const { count: cCount } = await createClient()
      .from('kasir_customers')
      .select('id', { count: 'exact', head: true });
    if (!cCount) {
      await createClient().from('kasir_customers').insert({ user_id: uid, name: 'Umum' });
    }
  } catch {
    /* abaikan — data contoh tidak wajib */
  }
}

/** Pratinjau no-nota harian berikutnya: INV-YYYYMMDD-0001 (angka asli dibuat RPC). */
export async function nextInvoicePreview(): Promise<string> {
  try {
    const today = isoHariIni().replace(/-/g, '');
    const { data, error } = await createClient()
      .from('kasir_transactions')
      .select('invoice_no')
      .like('invoice_no', `INV-${today}-%`)
      .order('invoice_no', { ascending: false })
      .limit(1);
    if (error || !data || data.length === 0) return `INV-${today}-0001`;
    const last = String(data[0]?.invoice_no ?? '');
    const n = Number(last.split('-').pop() ?? 0) || 0;
    return `INV-${today}-${String(n + 1).padStart(4, '0')}`;
  } catch {
    return 'INV-…';
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
    customerName?: string;
    shiftId?: string | null;
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
        p_customer_name: data.customerName ?? null,
        // Hanya dikirim bila ada shift aktif — supaya pemanggilan tetap kompatibel
        // dengan basis data versi 8-arg sebelum migrasi shift dijalankan.
        ...(data.shiftId ? { p_shift_id: data.shiftId } : {}),
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

/* ------------------------------- shift ------------------------------ */

const mapShift = (r: Record<string, unknown>): KasirShift => ({
  id: String(r.id),
  cashier_name: String(r.cashier_name ?? 'Kasir'),
  shift_no: String(r.shift_no ?? ''),
  opened_at: String(r.opened_at ?? ''),
  closed_at: r.closed_at ? String(r.closed_at) : null,
  opening_cash: num(r.opening_cash),
  closing_cash: r.closing_cash == null ? null : num(r.closing_cash),
  expected_cash: r.expected_cash == null ? null : num(r.expected_cash),
  status: String(r.status ?? 'open') as KasirShift['status'],
});

export const shiftsApi = {
  async active(): Promise<Result<KasirShift | null>> {
    try {
      const { data, error } = await createClient().rpc('kasir_active_shift');
      if (error) return { ok: false, error: rpcMsg(error, 'shift kasir') };
      return { ok: true, data: data ? mapShift(data as Record<string, unknown>) : null };
    } catch (e) {
      return { ok: false, error: msg(e) };
    }
  },

  async open(cashierName: string, openingCash = 0): Promise<Result<KasirShift>> {
    try {
      const { data, error } = await createClient().rpc('kasir_open_shift', {
        p_opening_cash: num(openingCash),
        p_cashier_name: cashierName || 'Kasir',
      });
      if (error) return { ok: false, error: rpcMsg(error, 'shift kasir') };
      return { ok: true, data: mapShift(data as Record<string, unknown>) };
    } catch (e) {
      return { ok: false, error: msg(e) };
    }
  },

  async preview(id: string): Promise<Result<{ expected: number }>> {
    try {
      const { data, error } = await createClient().rpc('kasir_shift_preview', { p_shift_id: id });
      if (error) return { ok: false, error: rpcMsg(error, 'shift kasir') };
      const r = (data ?? {}) as Record<string, unknown>;
      return { ok: true, data: { expected: num(r.expected) } };
    } catch (e) {
      return { ok: false, error: msg(e) };
    }
  },

  async close(id: string, actualCash: number): Promise<Result<{ shift: KasirShift; expected: number; selisih: number }>> {
    try {
      const { data, error } = await createClient().rpc('kasir_close_shift', {
        p_shift_id: id,
        p_actual_cash: num(actualCash),
      });
      if (error) return { ok: false, error: rpcMsg(error, 'shift kasir') };
      const r = (data ?? {}) as Record<string, unknown>;
      return {
        ok: true,
        data: {
          shift: mapShift((r.shift ?? {}) as Record<string, unknown>),
          expected: num(r.expected),
          selisih: num(r.selisih),
        },
      };
    } catch (e) {
      return { ok: false, error: msg(e) };
    }
  },

  async list(filter: { from?: string; to?: string; limit?: number } = {}): Promise<Result<KasirShift[]>> {
    try {
      const limit = Math.min(Math.max(num(filter.limit) || 50, 1), 500);
      let q = createClient().from('kasir_shifts').select('*');
      if (filter.from) q = q.gte('opened_at', `${filter.from}T00:00:00.000Z`);
      if (filter.to) q = q.lte('opened_at', `${filter.to}T23:59:59.999Z`);
      const { data, error } = await q.order('opened_at', { ascending: false }).limit(limit);
      if (error) return { ok: false, error: rpcMsg(error, 'riwayat shift') };
      return { ok: true, data: (data ?? []).map((r) => mapShift(r as Record<string, unknown>)) };
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

  async byCashier(range: { from?: string; to?: string } = {}): Promise<Result<CashierReport[]>> {
    try {
      const { data, error } = await createClient().rpc('kasir_report_by_cashier', rangePayload(range.from, range.to));
      if (error) return { ok: false, error: rpcMsg(error, 'laporan per kasir') };
      const rows = (data ?? []) as Record<string, unknown>[];
      return {
        ok: true,
        data: rows.map((r) => ({
          kasir: String(r.kasir ?? 'Kasir'),
          transaksi: num(r.transaksi),
          omzet: num(r.omzet),
          laba: num(r.laba),
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

/* ------------------------------- pelanggan ------------------------------ */

const mapCustomer = (r: Record<string, unknown>): Customer => ({
  id: String(r.id),
  name: String(r.name),
  phone: r.phone ? String(r.phone) : null,
  address: r.address ? String(r.address) : null,
});

export const customersApi = {
  async list(): Promise<Result<Customer[]>> {
    try {
      const { data, error } = await createClient()
        .from('kasir_customers')
        .select('id, name, phone, address, created_at')
        .order('name', { ascending: true });
      if (error) return { ok: false, error: error.message };
      return { ok: true, data: (data ?? []).map((r) => mapCustomer(r as Record<string, unknown>)) };
    } catch (e) {
      return { ok: false, error: msg(e) };
    }
  },

  async add(input: CustomerInput | string): Promise<Result<Customer>> {
    const raw: CustomerInput = typeof input === 'string' ? { name: input } : input;
    const clean = String(raw.name ?? '').trim();
    if (!clean) return { ok: false, error: 'Nama pelanggan wajib diisi.' };
    // Lapisan terakhir sebelum write: apa pun yang lolos dari UI (paste, autofill,
    // panggilan API lain) tetap disimpan sebagai angka murni saja.
    const phone = bersihkanTelepon(String(raw.phone ?? '')) || null;
    const address = String(raw.address ?? '').trim() || null;

    try {
      const { data: existing } = await createClient()
        .from('kasir_customers')
        .select('id, name, phone, address')
        .eq('name', clean)
        .maybeSingle();
      if (existing) {
        // lengkapi data yang belum ada tanpa menimpa isian lama
        const patch: Record<string, unknown> = {};
        if (!existing.phone && phone) patch.phone = phone;
        if (!existing.address && address) patch.address = address;
        if (Object.keys(patch).length) {
          const { data: patched, error: perr } = await createClient()
            .from('kasir_customers')
            .update(patch)
            .eq('id', String(existing.id))
            .select('id, name, phone, address')
            .single();
          if (!perr && patched) return { ok: true, data: mapCustomer(patched as Record<string, unknown>) };
        }
        return { ok: true, data: mapCustomer(existing as Record<string, unknown>) };
      }

      const { data, error } = await createClient()
        .from('kasir_customers')
        .insert({ user_id: await currentUserId(), name: clean, phone, address })
        .select('id, name, phone, address')
        .single();
      if (error) return { ok: false, error: error.message };
      return { ok: true, data: mapCustomer(data as Record<string, unknown>) };
    } catch (e) {
      return { ok: false, error: msg(e) };
    }
  },

  async remove(id: string): Promise<Result<{ id: string }>> {
    try {
      const { error } = await createClient().from('kasir_customers').delete().eq('id', id);
      if (error) return { ok: false, error: error.message };
      return { ok: true, data: { id } };
    } catch (e) {
      return { ok: false, error: msg(e) };
    }
  },
};

/* ------------------------------- retur ------------------------------ */

const mapReturn = (r: Record<string, unknown>): ReturnRecord => ({
  id: String(r.id),
  transaction_id: String(r.transaction_id),
  invoice_no: String(r.invoice_no ?? ''),
  retur_no: String(r.retur_no ?? ''),
  total: num(r.total),
  cashier_name: r.cashier_name ? String(r.cashier_name) : null,
  note: r.note ? String(r.note) : null,
  created_at: String(r.created_at ?? ''),
});

const mapReturnItem = (r: Record<string, unknown>): ReturnItem => ({
  id: String(r.id),
  return_id: String(r.return_id),
  transaction_item_id: r.transaction_item_id ? String(r.transaction_item_id) : null,
  product_id: r.product_id ? String(r.product_id) : null,
  product_name: String(r.product_name ?? ''),
  price: num(r.price),
  cost: num(r.cost),
  qty: num(r.qty),
  discount: num(r.discount),
  refund: num(r.refund),
});

export const returnsApi = {
  async list(filter: { from?: string; to?: string; limit?: number } = {}): Promise<Result<ReturnRecord[]>> {
    try {
      const limit = Math.min(Math.max(num(filter.limit) || 100, 1), 1000);
      let q = createClient().from('kasir_returns').select('*');
      if (filter.from) q = q.gte('created_at', `${filter.from}T00:00:00.000Z`);
      if (filter.to) q = q.lte('created_at', `${filter.to}T23:59:59.999Z`);
      const { data, error } = await q.order('created_at', { ascending: false }).limit(limit);
      if (error) return { ok: false, error: rpcMsg(error, 'riwayat retur') };
      return { ok: true, data: (data ?? []).map((r) => mapReturn(r as Record<string, unknown>)) };
    } catch (e) {
      return { ok: false, error: msg(e) };
    }
  },

  async items(returnId: string): Promise<Result<ReturnItem[]>> {
    try {
      const { data, error } = await createClient()
        .from('kasir_return_items')
        .select('*')
        .eq('return_id', returnId);
      if (error) return { ok: false, error: rpcMsg(error, 'rincian retur') };
      return { ok: true, data: (data ?? []).map((r) => mapReturnItem(r as Record<string, unknown>)) };
    } catch (e) {
      return { ok: false, error: msg(e) };
    }
  },

  async create(data: {
    transactionId: string;
    items: ReturnLineInput[];
    note?: string | null;
  }): Promise<Result<{ retur: ReturnRecord; total: number }>> {
    try {
      const { data: result, error } = await createClient().rpc('kasir_create_return', {
        p_tx_id: data.transactionId,
        p_items: data.items
          .filter((it) => num(it.qty) > 0)
          .map((it) => ({ transaction_item_id: it.transaction_item_id, qty: num(it.qty) })),
        p_note: data.note ?? null,
      });
      if (error) return { ok: false, error: rpcMsg(error, 'retur penjualan') };
      const body = result as { return: Record<string, unknown>; total?: number };
      return {
        ok: true,
        data: { retur: mapReturn(body.return ?? {}), total: num(body.total) },
      };
    } catch (e) {
      return { ok: false, error: msg(e) };
    }
  },
};

export type { Product, Transaction, TransactionItem };