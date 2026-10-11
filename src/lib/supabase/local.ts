'use client';

/**
 * Shim supabase-js untuk aplikasi desktop OFFLINE-FIRST.
 *
 * Meniru bagian kecil API supabase-js yang dipakai `src/lib/api.ts`
 * (`.from().select().eq()...`, `.rpc()`, `.auth.getUser()`) lalu meneruskan
 * operasi ke database SQLite lokal di proses utama Electron lewat jembatan
 * `window.kasirproDesktop.db`. Dengan begitu seluruh layar & `api.ts` tidak
 * perlu diubah saat aplikasi berjalan offline.
 *
 * Hanya dipakai bila jembatan desktop tersedia DAN `localDb` aktif
 * (lihat `client.ts`). Di browser biasa, `createClient()` tetap memakai
 * Supabase.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

type LocalOp = Record<string, unknown>;
interface BridgeReply {
  ok: boolean;
  data?: unknown;
  count?: number;
  error?: string;
}
interface DesktopDbBridge {
  db?: (op: LocalOp) => Promise<BridgeReply>;
  dbUser?: (id?: string) => Promise<{ ok: boolean; userId?: string }>;
}

interface LocalClientOptions {
  /** Ambil id user (GoTrue) saat online, untuk mengisi `user_id` lokal. */
  getUid?: () => Promise<string | null>;
}

type Filter = { op: string; col?: string; val?: unknown };

let cachedUid: string | null = null;

function bridge(): DesktopDbBridge {
  if (typeof window === 'undefined') return {};
  return (window as unknown as { kasirproDesktop?: DesktopDbBridge }).kasirproDesktop || {};
}

async function persistUid(id: string): Promise<void> {
  try {
    await bridge().dbUser?.(id);
  } catch {
    /* abaikan */
  }
}

async function resolveUid(opts: LocalClientOptions): Promise<string | null> {
  if (cachedUid) return cachedUid;
  // 1) Coba dari sesi Supabase (bila masih online).
  try {
    const u = await opts.getUid?.();
    if (u) {
      cachedUid = u;
      void persistUid(u);
      return u;
    }
  } catch {
    /* offline */
  }
  // 2) Baca dari database lokal (hasil aktivasi sebelumnya).
  try {
    const r = await bridge().dbUser?.();
    if (r?.userId) cachedUid = r.userId;
  } catch {
    /* abaikan */
  }
  return cachedUid;
}

/* ------------------------------------------------------------------ */
/* Query builder mini (subset supabase-js)                            */
/* ------------------------------------------------------------------ */
class LocalQuery implements PromiseLike<{ data: unknown; error: unknown; count?: number }> {
  private table: string;
  private kind: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select';
  private payload: unknown = null;
  private onConflict: string | null = null;
  private columns: string | null = null;
  private wantCount = false;
  private wantHead = false;
  private returning = false;
  private singleMode: 'many' | 'single' | 'maybe' = 'many';
  private filters: Filter[] = [];
  private orders: Array<{ col: string; ascending: boolean }> = [];
  private limitN: number | null = null;
  private rangeN: { from: number; to: number } | null = null;

  constructor(
    private send: (op: LocalOp) => Promise<BridgeReply>,
    table: string,
  ) {
    this.table = table;
  }

  select(cols?: string, opts?: { count?: string; head?: boolean }): this {
    if (this.kind === 'insert' || this.kind === 'update' || this.kind === 'upsert') {
      this.returning = true;
      if (cols) this.columns = cols;
    } else {
      this.kind = 'select';
      if (cols) this.columns = cols;
    }
    if (opts?.count === 'exact') this.wantCount = true;
    if (opts?.head) this.wantHead = true;
    return this;
  }

  insert(rows: unknown): this {
    this.kind = 'insert';
    this.payload = rows;
    return this;
  }

  update(patch: unknown): this {
    this.kind = 'update';
    this.payload = patch;
    return this;
  }

  delete(): this {
    this.kind = 'delete';
    return this;
  }

  upsert(rows: unknown, opts?: { onConflict?: string }): this {
    this.kind = 'upsert';
    this.payload = rows;
    this.onConflict = opts?.onConflict ?? 'id';
    return this;
  }

  private add(op: string, col: string, val: unknown): this {
    this.filters.push({ op, col, val });
    return this;
  }
  eq(col: string, val: unknown): this {
    return this.add('eq', col, val);
  }
  neq(col: string, val: unknown): this {
    return this.add('neq', col, val);
  }
  gt(col: string, val: unknown): this {
    return this.add('gt', col, val);
  }
  gte(col: string, val: unknown): this {
    return this.add('gte', col, val);
  }
  lt(col: string, val: unknown): this {
    return this.add('lt', col, val);
  }
  lte(col: string, val: unknown): this {
    return this.add('lte', col, val);
  }
  like(col: string, val: unknown): this {
    return this.add('like', col, val);
  }
  ilike(col: string, val: unknown): this {
    return this.add('ilike', col, val);
  }
  is(col: string, val: unknown): this {
    return this.add('is', col, val);
  }
  in(col: string, val: unknown[]): this {
    return this.add('in', col, val);
  }
  contains(col: string, val: unknown): this {
    return this.add('contains', col, val);
  }
  or(expr: string): this {
    this.filters.push({ op: 'or', val: expr });
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }): this {
    this.orders.push({ col, ascending: opts?.ascending !== false });
    return this;
  }
  limit(n: number): this {
    this.limitN = n;
    return this;
  }
  range(from: number, to: number): this {
    this.rangeN = { from, to };
    return this;
  }
  single(): this {
    this.singleMode = 'single';
    return this;
  }
  maybeSingle(): this {
    this.singleMode = 'maybe';
    return this;
  }

  private buildOp(): LocalOp {
    const op: LocalOp = { kind: this.kind, table: this.table, filters: this.filters };
    if (this.columns) op.columns = this.columns;
    if (this.orders.length) op.orders = this.orders;
    if (this.limitN != null) op.limit = this.limitN;
    if (this.rangeN) op.range = this.rangeN;
    if (this.wantCount) op.count = 'exact';
    if (this.wantHead) op.head = true;
    if (this.payload != null) op.payload = this.payload;
    if (this.onConflict) op.onConflict = this.onConflict;
    if (this.returning) op.returning = true;
    return op;
  }

  private async exec(): Promise<{ data: unknown; error: unknown; count?: number }> {
    try {
      const res = await this.send(this.buildOp());
      if (!res || !res.ok) {
        return { data: null, error: { message: (res && res.error) || 'Operasi database lokal gagal.' } };
      }
      const out: { data: unknown; error: unknown; count?: number } = { data: res.data ?? null, error: null };
      if (typeof res.count === 'number') out.count = res.count;

      if (this.singleMode !== 'many') {
        if (this.wantHead) {
          out.data = null;
          return out;
        }
        const arr = Array.isArray(res.data) ? res.data : res.data == null ? [] : [res.data];
        if (arr.length === 1) {
          out.data = arr[0];
        } else if (arr.length === 0) {
          if (this.singleMode === 'single') {
            out.data = null;
            out.error = { message: 'Baris tidak ditemukan.' };
          } else {
            out.data = null;
          }
        } else {
          out.data = arr[0];
          if (this.singleMode === 'single') {
            out.error = { message: 'Lebih dari satu baris ditemukan.' };
          }
        }
      }
      return out;
    } catch (e) {
      return { data: null, error: { message: e instanceof Error ? e.message : 'Operasi database lokal gagal.' } };
    }
  }

  then<TResult1 = { data: unknown; error: unknown; count?: number }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown; count?: number }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.exec().then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

/* ------------------------------------------------------------------ */
/* Klien lokal                                                        */
/* ------------------------------------------------------------------ */
export function createLocalClient(opts: LocalClientOptions = {}): SupabaseClient {
  const send = (op: LocalOp): Promise<BridgeReply> => {
    const b = bridge();
    if (!b.db) return Promise.resolve({ ok: false, error: 'Jembatan database lokal tidak tersedia.' });
    return resolveUid(opts)
      .then((uid) => b.db!({ ...op, uid: uid || undefined }))
      .catch((e) => ({ ok: false, error: e instanceof Error ? e.message : 'Gagal mengakses database lokal.' }));
  };

  const auth = {
    getUser: async () => {
      const uid = await resolveUid(opts);
      return { data: { user: uid ? { id: uid } : null }, error: null };
    },
    getSession: async () => {
      const uid = await resolveUid(opts);
      return { data: { session: uid ? { user: { id: uid } } : null }, error: null };
    },
  };

  const rpc = (fn: string, args?: Record<string, unknown>) => ({
    then: (onfulfilled?: (v: unknown) => unknown, onrejected?: (e: unknown) => unknown) =>
      send({ kind: 'rpc', fn, args: args || {} })
        .then((res) => {
          if (!res || !res.ok) return { data: null, error: { message: (res && res.error) || 'RPC lokal gagal.' } };
          return { data: res.data ?? null, error: null };
        })
        .then(onfulfilled, onrejected),
  });

  const client = {
    from: (table: string) => new LocalQuery(send, table),
    rpc,
    auth,
  };

  return client as unknown as SupabaseClient;
}
