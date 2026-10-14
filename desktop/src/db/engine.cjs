'use strict';

/**
 * Mesin database lokal KasirPro POS (SQLite / better-sqlite3).
 *
 * Meniru bagian kecil API supabase-js yang dipakai `src/lib/api.ts`:
 *   - query builder: from/select/insert/update/delete/upsert + filter + order
 *   - RPC: 19 fungsi Postgres (supabase/schema.sql) diport ke JS
 *
 * Dipanggil dari proses utama Electron lewat IPC `desktop:db`. Renderer memakai
 * shim `src/lib/supabase/local.ts`. Semua tulis dicatat ke `_outbox` untuk
 * sinkronisasi ke Supabase (fase berikutnya).
 */

const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');
const Database = require('better-sqlite3');

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

/** Tabel aplikasi (semua punya user_id sebagai pengganti RLS). */
const APP_TABLES = new Set([
  'kasir_products',
  'kasir_customers',
  'kasir_suppliers',
  'master_satuan',
  'kasir_settings',
  'kasir_transactions',
  'kasir_transaction_items',
  'kasir_shifts',
  'kasir_returns',
  'kasir_return_items',
  'kasir_stock_logs',
  'kasir_purchases',
  'kasir_purchase_items',
]);

/** Kolom JSON (disimpan TEXT, dibaca objek). */
const JSON_COLS = {
  kasir_products: ['satuan_list', 'variants'],
  kasir_settings: ['value'],
};

/** Kolom boolean (disimpan 0/1, dibaca boolean). */
const BOOL_COLS = {
  kasir_products: ['is_active'],
};

/** Tabel tanpa kolom id / created_at (PK gabungan). */
const NO_ID = new Set(['kasir_settings']);
const NO_CREATED = new Set(['kasir_settings']);
const HAS_UPDATED = new Set(['kasir_products']);

// ---------------------------------------------------------------------------
// Util
// ---------------------------------------------------------------------------
const pad = (n, w) => String(n).padStart(w, '0');
const num = (x) => {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (x) => {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
};
const nowIso = () => new Date().toISOString();

/** YYYYMMDD menurut zona Asia/Jakarta (UTC+7, tanpa DST). */
function jakartaYMD(d = new Date()) {
  const x = new Date(new Date(d).getTime() + 7 * 3600 * 1000);
  return `${x.getUTCFullYear()}${pad(x.getUTCMonth() + 1, 2)}${pad(x.getUTCDate(), 2)}`;
}

/** Tanggal UTC YYYY-MM-DD (untuk laporan harian, meniru created_at::date). */
function utcDate(iso) {
  return String(iso || '').slice(0, 10);
}

function likePattern(v) {
  return String(v == null ? '' : v).replace(/\*/g, '%');
}

function isEmpty(v) {
  return v === undefined || v === null || v === '';
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------
function createEngine(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = OFF');
  db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));

  const q1 = (sql, ...a) => db.prepare(sql).get(...a);
  const qa = (sql, ...a) => db.prepare(sql).all(...a);
  const run = (sql, ...a) => db.prepare(sql).run(...a);

  // ------------------------- meta -------------------------
  function meta(key) {
    const r = q1('select value from _meta where key = ?', key);
    return r ? r.value : null;
  }
  function setMeta(key, value) {
    run(
      'insert into _meta (key, value) values (?, ?) on conflict(key) do update set value = excluded.value',
      key,
      value == null ? null : String(value),
    );
  }

  // ----------------------- normalisasi -----------------------
  /** Kolom yang benar-benar ada di tabel lokal (cache). */
  const localCols = new Map();
  function localColumns(table) {
    if (!localCols.has(table)) {
      const rows = qa(`pragma table_info("${table}")`);
      localCols.set(table, new Set(rows.map((r) => r.name)));
    }
    return localCols.get(table);
  }

  function normalize(table, obj) {
    const out = {};
    const cols = localColumns(table);
    for (const k of Object.keys(obj)) {
      // Buang kolom yang tidak dikenal skema lokal (mis. migrasi server baru)
      // supaya penulisan tidak gagal dengan "no such column".
      if (cols.size && !cols.has(k)) continue;
      let v = obj[k];
      if (v === undefined) v = null;
      const jsonCols = JSON_COLS[table] || [];
      const boolCols = BOOL_COLS[table] || [];
      if (jsonCols.includes(k)) {
        if (v === null) v = null;
        else if (typeof v === 'string') v = v;
        else v = JSON.stringify(v);
      } else if (boolCols.includes(k) || typeof v === 'boolean') {
        v = v ? 1 : 0;
      }
      out[k] = v;
    }
    return out;
  }

  function rowsToObj(table, r) {
    if (!r) return r;
    const o = Object.assign({}, r);
    for (const c of JSON_COLS[table] || []) {
      if (o[c] != null) {
        try {
          o[c] = JSON.parse(o[c]);
        } catch {
          /* biarkan sebagai string */
        }
      }
    }
    for (const c of BOOL_COLS[table] || []) {
      if (c in o) o[c] = !!o[c];
    }
    return o;
  }

  // ------------------------- tulis dasar -------------------------
  function touch(tbl, rowId, op) {
    if (rowId == null) return;
    run(
      `insert into _outbox (tbl, row_id, op, ts, done) values (?, ?, ?, ?, 0)
       on conflict(tbl, row_id) do update set op = excluded.op, ts = excluded.ts, done = 0`,
      tbl,
      String(rowId),
      op,
      nowIso(),
    );
  }

  function insertRow(table, obj) {
    const o = normalize(table, obj);
    const cols = Object.keys(o);
    if (!cols.length) return;
    run(
      `insert into "${table}" (${cols.map((c) => `"${c}"`).join(',')}) values (${cols
        .map(() => '?')
        .join(',')})`,
      ...cols.map((c) => o[c]),
    );
  }

  function upsertRow(table, obj, conflictCols) {
    const o = normalize(table, obj);
    const cols = Object.keys(o);
    if (!cols.length) return;
    const upd = cols.filter((c) => !conflictCols.includes(c));
    let sql = `insert into "${table}" (${cols.map((c) => `"${c}"`).join(',')}) values (${cols
      .map(() => '?')
      .join(',')})`;
    if (upd.length) {
      sql += ` on conflict(${conflictCols.map((c) => `"${c}"`).join(',')}) do update set ${upd
        .map((c) => `"${c}" = excluded."${c}"`)
        .join(', ')}`;
    } else {
      sql += ` on conflict(${conflictCols.map((c) => `"${c}"`).join(',')}) do nothing`;
    }
    run(sql, ...cols.map((c) => o[c]));
  }

  function rowKey(table, row) {
    return NO_ID.has(table) ? row.key : row.id;
  }

  function getById(table, id, uid) {
    if (NO_ID.has(table)) return q1(`select * from "${table}" where key = ? and user_id = ?`, id, uid);
    return q1(`select * from "${table}" where id = ? and user_id = ?`, id, uid);
  }

  function insertLog(uid, o) {
    const row = {
      id: randomUUID(),
      user_id: uid,
      product_id: o.product_id,
      tipe: o.tipe,
      qty: num(o.qty),
      stok_sebelum: o.stok_sebelum == null ? null : o.stok_sebelum,
      stok_sesudah: o.stok_sesudah == null ? null : o.stok_sesudah,
      keterangan: o.keterangan == null ? null : o.keterangan,
      ref_id: o.ref_id == null ? null : o.ref_id,
      ref_tipe: o.ref_tipe == null ? null : o.ref_tipe,
      created_at: nowIso(),
    };
    insertRow('kasir_stock_logs', row);
    touch('kasir_stock_logs', row.id, 'upsert');
  }

  function setStock(uid, pid, newStock) {
    run(
      'update kasir_products set stock = ?, updated_at = ? where id = ? and user_id = ?',
      round2(newStock),
      nowIso(),
      pid,
      uid,
    );
    touch('kasir_products', pid, 'upsert');
  }

  function getProduct(uid, id) {
    return q1('select * from kasir_products where id = ? and user_id = ?', id, uid);
  }

  // ------------------------- query builder -------------------------
  function assertTable(t) {
    if (!APP_TABLES.has(t)) throw new Error(`Tabel tidak dikenal: ${t}`);
    return t;
  }

  function normalizeFilterValue(table, col, val) {
    if (val === null || val === undefined) return null;
    if (typeof val === 'boolean') return val ? 1 : 0;
    if ((BOOL_COLS[table] || []).includes(col)) return val ? 1 : 0;
    if (typeof val === 'object') return JSON.stringify(val);
    return val;
  }

  function orCondition(table, cond) {
    const m = String(cond)
      .trim()
      .match(/^([A-Za-z0-9_]+)\.(eq|neq|gt|gte|lt|lte|like|ilike|is)\.(.*)$/);
    if (!m) return { sql: '1', params: [] };
    const [, col, op, raw] = m;
    return simpleCondition(table, op, col, raw, table, col);
  }

  function simpleCondition(table, op, col, rawVal) {
    const val = normalizeFilterValue(table, col, rawVal);
    switch (op) {
      case 'eq':
        return { sql: `"${col}" = ?`, params: [val] };
      case 'neq':
        return { sql: `"${col}" != ?`, params: [val] };
      case 'gt':
        return { sql: `"${col}" > ?`, params: [val] };
      case 'gte':
        return { sql: `"${col}" >= ?`, params: [val] };
      case 'lt':
        return { sql: `"${col}" < ?`, params: [val] };
      case 'lte':
        return { sql: `"${col}" <= ?`, params: [val] };
      case 'like':
      case 'ilike':
        return { sql: `"${col}" LIKE ? ESCAPE '\\'`, params: [likePattern(rawVal)] };
      case 'is':
        if (rawVal === null || rawVal === 'null') return { sql: `"${col}" IS NULL`, params: [] };
        return { sql: `"${col}" IS ?`, params: [val] };
      default:
        return { sql: '1', params: [] };
    }
  }

  function buildWhere(table, uid, filters, includeUid = true) {
    const clauses = [];
    const params = [];
    if (includeUid) {
      clauses.push('user_id = ?');
      params.push(uid);
    }
    for (const f of filters || []) {
      if (!f) continue;
      if (f.op === 'or') {
        const parts = String(f.val || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .map((c) => orCondition(table, c));
        clauses.push('(' + parts.map((p) => p.sql).join(' OR ') + ')');
        for (const p of parts) params.push(...p.params);
        continue;
      }
      if (f.op === 'in') {
        const arr = Array.isArray(f.val) ? f.val : [];
        if (!arr.length) {
          clauses.push('0');
        } else {
          clauses.push(`"${f.col}" IN (${arr.map(() => '?').join(',')})`);
          params.push(...arr.map((v) => normalizeFilterValue(table, f.col, v)));
        }
        continue;
      }
      if (f.op === 'contains') {
        clauses.push(`"${f.col}" LIKE ? ESCAPE '\\'`);
        params.push('%' + String(f.val == null ? '' : f.val) + '%');
        continue;
      }
      const c = simpleCondition(table, f.op, f.col, f.val);
      clauses.push(c.sql);
      params.push(...c.params);
    }
    return { sql: clauses.length ? ' WHERE ' + clauses.join(' AND ') : '', params };
  }

  function columnsSql(cols) {
    if (!cols || cols === '*' || String(cols).includes('*')) return '*';
    const list = String(cols)
      .split(',')
      .map((c) => c.trim().replace(/[^A-Za-z0-9_]/g, ''))
      .filter(Boolean);
    if (!list.length) return '*';
    return list.map((c) => `"${c}"`).join(', ');
  }

  function doSelect(op, uid) {
    const table = assertTable(op.table);
    const where = buildWhere(table, uid, op.filters);
    const cols = columnsSql(op.columns);
    if (op.head) {
      const c = q1(`select count(*) as c from "${table}"${where.sql}`, ...where.params);
      return { data: null, count: c ? c.c : 0 };
    }
    let sql = `select ${cols} from "${table}"${where.sql}`;
    if (Array.isArray(op.orders) && op.orders.length) {
      sql += ' order by ' + op.orders.map((o) => `"${o.col}" ${o.ascending === false ? 'desc' : 'asc'}`).join(', ');
    }
    if (op.range) {
      const lim = Math.max(0, num(op.range.to) - num(op.range.from) + 1);
      sql += ` limit ${Math.floor(lim)} offset ${Math.max(0, Math.floor(num(op.range.from)))}`;
    } else if (op.limit != null) {
      sql += ` limit ${Math.max(0, Math.floor(num(op.limit)))}`;
    }
    const rows = qa(sql, ...where.params).map((r) => rowsToObj(table, r));
    const out = { data: rows };
    if (op.count === 'exact') {
      const c = q1(`select count(*) as c from "${table}"${where.sql}`, ...where.params);
      out.count = c ? c.c : 0;
    }
    return out;
  }

  function doInsert(op, uid) {
    const table = assertTable(op.table);
    const list = Array.isArray(op.payload) ? op.payload : [op.payload];
    const keys = [];
    db.transaction(() => {
      for (const item of list) {
        const row = Object.assign({}, item);
        row.user_id = uid;
        if (!NO_ID.has(table) && !row.id) row.id = randomUUID();
        if (!NO_CREATED.has(table) && !row.created_at) row.created_at = nowIso();
        if (HAS_UPDATED.has(table) && !row.updated_at) row.updated_at = nowIso();
        insertRow(table, row);
        const k = rowKey(table, row);
        keys.push(k);
        touch(table, k, 'upsert');
      }
    })();
    let data = null;
    if (op.returning) {
      data = keys.map((k) => getById(table, k, uid)).filter(Boolean).map((r) => rowsToObj(table, r));
    }
    return { data };
  }

  function doUpdate(op, uid) {
    const table = assertTable(op.table);
    const patch = Object.assign({}, op.payload || {});
    delete patch.id;
    delete patch.user_id;
    if (HAS_UPDATED.has(table) && patch.updated_at === undefined) patch.updated_at = nowIso();
    const where = buildWhere(table, uid, op.filters);
    const keyCol = NO_ID.has(table) ? 'key' : 'id';
    const targets = qa(`select "${keyCol}" as k from "${table}"${where.sql}`, ...where.params).map((r) => r.k);
    const o = normalize(table, patch);
    const cols = Object.keys(o);
    db.transaction(() => {
      if (cols.length) {
        run(
          `update "${table}" set ${cols.map((c) => `"${c}" = ?`).join(', ')}${where.sql}`,
          ...cols.map((c) => o[c]),
          ...where.params,
        );
      }
      for (const k of targets) touch(table, k, 'upsert');
    })();
    let data = null;
    if (op.returning) {
      data = targets.map((k) => getById(table, k, uid)).filter(Boolean).map((r) => rowsToObj(table, r));
    }
    return { data };
  }

  function doDelete(op, uid) {
    const table = assertTable(op.table);
    const where = buildWhere(table, uid, op.filters);
    const keyCol = NO_ID.has(table) ? 'key' : 'id';
    const targets = qa(`select "${keyCol}" as k from "${table}"${where.sql}`, ...where.params).map((r) => r.k);
    db.transaction(() => {
      run(`delete from "${table}"${where.sql}`, ...where.params);
      for (const k of targets) touch(table, k, 'delete');
    })();
    return { data: null };
  }

  function doUpsert(op, uid) {
    const table = assertTable(op.table);
    const conflict = String(op.onConflict || 'id')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const list = Array.isArray(op.payload) ? op.payload : [op.payload];
    db.transaction(() => {
      for (const item of list) {
        const row = Object.assign({}, item);
        row.user_id = uid;
        if (!NO_ID.has(table) && !row.id) row.id = randomUUID();
        if (!NO_CREATED.has(table) && !row.created_at) row.created_at = nowIso();
        if (HAS_UPDATED.has(table) && !row.updated_at) row.updated_at = nowIso();
        upsertRow(table, row, conflict);
        touch(table, rowKey(table, row), 'upsert');
      }
    })();
    return { data: null };
  }

  // =========================================================================
  // RPC (port dari supabase/schema.sql)
  // =========================================================================
  function nextNumber(uid, table, col, prefix, width) {
    const rows = qa(`select "${col}" as v from "${table}" where user_id = ? and "${col}" like ?`, uid, prefix + '%');
    let max = 0;
    for (const r of rows) {
      const n = parseInt(String(r.v || '').slice(prefix.length), 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
    return prefix + pad(max + 1, width);
  }

  function kasirAdjustStock(uid, a) {
    const pid = a.p_product_id;
    const delta = round2(num(a.p_delta));
    if (!pid || !delta) throw new Error('Jumlah stok tidak valid.');
    const p = getProduct(uid, pid);
    if (!p) throw new Error('Produk tidak ditemukan.');
    const before = round2(num(p.stock));
    const after = round2(before + delta);
    if (after < 0) throw new Error('Stok tidak boleh negatif.');
    db.transaction(() => {
      run('update kasir_products set stock = ?, updated_at = ? where id = ? and user_id = ?', after, nowIso(), pid, uid);
      touch('kasir_products', pid, 'upsert');
      insertLog(uid, {
        product_id: pid,
        tipe: delta > 0 ? 'stok_masuk' : 'stok_keluar',
        qty: delta,
        stok_sebelum: before,
        stok_sesudah: after,
        keterangan: isEmpty(a.p_keterangan) ? null : String(a.p_keterangan),
      });
    })();
    return rowsToObj('kasir_products', getProduct(uid, pid));
  }

  function kasirOpnameStock(uid, a) {
    const pid = a.p_product_id;
    const fisik = round2(num(a.p_stok_fisik));
    if (!pid || fisik < 0) throw new Error('Stok fisik tidak valid.');
    const p = getProduct(uid, pid);
    if (!p) throw new Error('Produk tidak ditemukan.');
    const before = round2(num(p.stock));
    const delta = round2(fisik - before);
    if (delta === 0) {
      return { product_id: pid, stok_sebelum: before, stok_sesudah: before, delta: 0, tipe: null };
    }
    db.transaction(() => {
      run('update kasir_products set stock = ?, updated_at = ? where id = ? and user_id = ?', fisik, nowIso(), pid, uid);
      touch('kasir_products', pid, 'upsert');
      insertLog(uid, {
        product_id: pid,
        tipe: delta > 0 ? 'stok_masuk' : 'stok_keluar',
        qty: delta,
        stok_sebelum: before,
        stok_sesudah: fisik,
        keterangan: isEmpty(a.p_keterangan) ? 'Stok opname' : String(a.p_keterangan),
      });
    })();
    return { product_id: pid, stok_sebelum: before, stok_sesudah: fisik, delta, tipe: delta > 0 ? 'stok_masuk' : 'stok_keluar' };
  }

  function kasirStockLogsList(uid, a) {
    return qa(
      'select * from kasir_stock_logs where product_id = ? and user_id = ? order by created_at desc, id',
      a.p_product_id,
      uid,
    );
  }

  function kasirStockMovements(uid, a) {
    const from = isEmpty(a.p_from) ? null : String(a.p_from);
    const to = isEmpty(a.p_to) ? null : String(a.p_to);
    const pid = isEmpty(a.p_product_id) ? null : a.p_product_id;
    const jenis = isEmpty(a.p_jenis) ? null : String(a.p_jenis);
    const q = isEmpty(a.p_q) ? null : String(a.p_q).trim().toLowerCase();

    const prod = new Map();
    for (const p of qa('select id, barcode, name, unit from kasir_products where user_id = ?', uid)) prod.set(p.id, p);
    const txNo = new Map();
    for (const t of qa('select id, invoice_no from kasir_transactions where user_id = ?', uid)) txNo.set(t.id, t.invoice_no);
    const puNo = new Map();
    for (const t of qa('select id, invoice_no from kasir_purchases where user_id = ?', uid)) puNo.set(t.id, t.invoice_no);
    const rtNo = new Map();
    for (const t of qa('select id, retur_no from kasir_returns where user_id = ?', uid)) rtNo.set(t.id, t.retur_no);

    let logs = qa('select * from kasir_stock_logs where user_id = ?', uid);
    const out = [];
    for (const s of logs) {
      if (from && String(s.created_at) < from) continue;
      if (to && !(String(s.created_at).slice(0, 10) <= to)) continue;
      if (pid && s.product_id !== pid) continue;
      const p = prod.get(s.product_id) || {};
      if (q) {
        const hay = `${p.name || ''} ${p.barcode || ''}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      let jenisRow;
      if (s.tipe === 'terjual') jenisRow = 'PENJUALAN';
      else if (s.tipe === 'retur') jenisRow = 'RETUR';
      else if (s.tipe === 'void') jenisRow = 'PEMBATALAN';
      else if (s.ref_tipe === 'pembelian' && s.tipe === 'stok_masuk') jenisRow = 'PEMBELIAN';
      else if (s.ref_tipe === 'pembelian' && s.tipe === 'stok_keluar') jenisRow = 'PEMBATALAN';
      else if (s.ref_tipe == null && (s.tipe === 'stok_masuk' || s.tipe === 'stok_keluar')) jenisRow = 'ADJUSTMENT';
      else jenisRow = 'LAINNYA';
      if (jenis && jenisRow !== jenis) continue;
      let noRef = null;
      if (s.ref_tipe === 'transaksi') noRef = txNo.get(s.ref_id) || null;
      else if (s.ref_tipe === 'pembelian') noRef = puNo.get(s.ref_id) || null;
      else if (s.ref_tipe === 'retur') noRef = rtNo.get(s.ref_id) || null;
      out.push({
        id: s.id,
        created_at: s.created_at,
        product_id: s.product_id,
        barcode: p.barcode || null,
        product_name: p.name || '',
        unit: p.unit || null,
        jenis: jenisRow,
        no_referensi: noRef,
        masuk: num(s.qty) > 0 ? round2(num(s.qty)) : 0,
        keluar: num(s.qty) < 0 ? round2(-num(s.qty)) : 0,
        stok_sebelum: s.stok_sebelum == null ? null : num(s.stok_sebelum),
        stok_sesudah: s.stok_sesudah == null ? null : num(s.stok_sesudah),
        keterangan: s.keterangan,
      });
    }
    out.sort((x, y) => (x.created_at < y.created_at ? 1 : x.created_at > y.created_at ? -1 : String(x.product_name).localeCompare(String(y.product_name))));
    return out;
  }

  function rangeClause(a) {
    const clauses = ["t.status = 'completed'"];
    const params = [];
    if (!isEmpty(a.p_from)) {
      clauses.push('t.created_at >= ?');
      params.push(String(a.p_from));
    }
    if (!isEmpty(a.p_to)) {
      clauses.push('t.created_at <= ?');
      params.push(String(a.p_to));
    }
    return { sql: clauses.join(' and '), params };
  }

  function kasirReportSummary(uid, a) {
    const r = rangeClause(a);
    const row = q1(
      `select count(*) as jumlah, coalesce(sum(t.total),0) as omzet,
              coalesce(sum(t.total - t.total_cost),0) as laba,
              coalesce(sum(t.discount_amount),0) as diskon_tx,
              coalesce(sum(t.paid),0) as terima
         from kasir_transactions t where t.user_id = ? and ${r.sql}`,
      uid,
      ...r.params,
    );
    const it = q1(
      `select coalesce(sum(i.qty),0) as qty, coalesce(sum(i.discount),0) as diskon
         from kasir_transaction_items i join kasir_transactions t on t.id = i.transaction_id
        where t.user_id = ? and ${r.sql}`,
      uid,
      ...r.params,
    );
    const jumlah = num(row.jumlah);
    const omzet = num(row.omzet);
    return {
      jumlah_transaksi: jumlah,
      total_omzet: round2(omzet),
      total_laba: round2(num(row.laba)),
      total_diskon: round2(num(row.diskon_tx) + num(it.diskon)),
      total_terima: round2(num(row.terima)),
      total_item: round2(num(it.qty)),
      rata_rata: jumlah > 0 ? round2(omzet / jumlah) : 0,
    };
  }

  function kasirReportTop(uid, a) {
    const r = rangeClause(a);
    const limit = Math.min(Math.max(num(a.p_limit) || 10, 1), 100);
    const rows = qa(
      `select i.product_name as name, i.product_id as product_id,
              round(sum(i.qty),2) as qty, round(sum(i.subtotal),2) as omzet
         from kasir_transaction_items i join kasir_transactions t on t.id = i.transaction_id
        where t.user_id = ? and ${r.sql}
        group by i.product_name, i.product_id
        order by qty desc limit ${limit}`,
      uid,
      ...r.params,
    );
    return rows.map((x) => ({ name: x.name, product_id: x.product_id, qty: num(x.qty), omzet: num(x.omzet) }));
  }

  function kasirReportDaily(uid, a) {
    const r = rangeClause(a);
    const rows = qa(
      `select t.created_at, t.total, t.total_cost from kasir_transactions t
        where t.user_id = ? and ${r.sql}`,
      uid,
      ...r.params,
    );
    const map = new Map();
    for (const x of rows) {
      const d = utcDate(x.created_at);
      const cur = map.get(d) || { tanggal: d, transaksi: 0, omzet: 0, laba: 0 };
      cur.transaksi += 1;
      cur.omzet += num(x.total);
      cur.laba += num(x.total) - num(x.total_cost);
      map.set(d, cur);
    }
    return [...map.values()]
      .sort((x, y) => (x.tanggal < y.tanggal ? -1 : 1))
      .map((x) => ({ tanggal: x.tanggal, transaksi: x.transaksi, omzet: round2(x.omzet), laba: round2(x.laba) }));
  }

  function kasirReportByPayment(uid, a) {
    const r = rangeClause(a);
    const rows = qa(
      `select t.payment_method as metode, count(*) as n, round(sum(t.total),2) as omzet
         from kasir_transactions t where t.user_id = ? and ${r.sql}
        group by t.payment_method order by omzet desc`,
      uid,
      ...r.params,
    );
    return rows.map((x) => ({ metode: x.metode || 'cash', n: num(x.n), omzet: num(x.omzet) }));
  }

  function kasirReportByCashier(uid, a) {
    const r = rangeClause(a);
    const rows = qa(
      `select coalesce(nullif(t.cashier_name,''),'Kasir') as kasir, count(*) as transaksi,
              round(sum(t.total),2) as omzet, round(sum(t.total - t.total_cost),2) as laba
         from kasir_transactions t where t.user_id = ? and ${r.sql}
        group by t.cashier_name order by omzet desc`,
      uid,
      ...r.params,
    );
    return rows.map((x) => ({ kasir: x.kasir, transaksi: num(x.transaksi), omzet: num(x.omzet), laba: num(x.laba) }));
  }

  // ------------------------- shift -------------------------
  function kasirActiveShift(uid) {
    const s = q1("select * from kasir_shifts where user_id = ? and status = 'open' order by opened_at desc limit 1", uid);
    return s || null;
  }

  function kasirOpenShift(uid, a) {
    const active = kasirActiveShift(uid);
    if (active) throw new Error(`Shift ${active.shift_no} masih terbuka. Tutup dulu sebelum buka yang baru.`);
    const prefix = `SHIFT-${jakartaYMD()}-`;
    const no = nextNumber(uid, 'kasir_shifts', 'shift_no', prefix, 4);
    const row = {
      id: randomUUID(),
      user_id: uid,
      cashier_name: isEmpty(a.p_cashier_name) ? 'Kasir' : String(a.p_cashier_name),
      shift_no: no,
      opened_at: nowIso(),
      closed_at: null,
      opening_cash: Math.max(0, num(a.p_opening_cash)),
      closing_cash: null,
      expected_cash: null,
      status: 'open',
    };
    insertRow('kasir_shifts', row);
    touch('kasir_shifts', row.id, 'upsert');
    return row;
  }

  function shiftCash(uid, shiftId) {
    const masuk = q1(
      "select coalesce(sum(paid - change_due),0) as v from kasir_transactions where user_id = ? and shift_id = ? and status = 'completed' and payment_method = 'cash'",
      uid,
      shiftId,
    );
    const retur = q1(
      `select coalesce(sum(r.total),0) as v from kasir_returns r
         join kasir_transactions t on t.id = r.transaction_id
        where t.user_id = ? and t.shift_id = ? and t.payment_method = 'cash'`,
      uid,
      shiftId,
    );
    return { masuk: num(masuk.v), retur: num(retur.v) };
  }

  function kasirShiftPreview(uid, a) {
    const s = q1('select * from kasir_shifts where id = ? and user_id = ?', a.p_shift_id, uid);
    if (!s) throw new Error('Shift tidak ditemukan.');
    const c = shiftCash(uid, a.p_shift_id);
    return { expected: round2(num(s.opening_cash) + c.masuk - c.retur) };
  }

  function kasirCloseShift(uid, a) {
    const s = q1('select * from kasir_shifts where id = ? and user_id = ?', a.p_shift_id, uid);
    if (!s) throw new Error('Shift tidak ditemukan.');
    if (s.status === 'closed') throw new Error('Shift sudah ditutup.');
    const c = shiftCash(uid, a.p_shift_id);
    const expected = round2(num(s.opening_cash) + c.masuk - c.retur);
    const actual = a.p_actual_cash == null ? expected : round2(num(a.p_actual_cash));
    run('update kasir_shifts set closed_at = ?, closing_cash = ?, expected_cash = ?, status = ? where id = ?', nowIso(), actual, expected, 'closed', a.p_shift_id);
    touch('kasir_shifts', a.p_shift_id, 'upsert');
    const shift = q1('select * from kasir_shifts where id = ?', a.p_shift_id);
    return { shift, expected, selisih: round2(actual - expected) };
  }

  // ------------------------- transaksi -------------------------
  function kasirCreateTransaction(uid, a) {
    const lines = a.p_lines;
    if (!Array.isArray(lines) || !lines.length) throw new Error('Keranjang masih kosong.');
    if (!isEmpty(a.p_shift_id)) {
      const sh = q1("select 1 as x from kasir_shifts where id = ? and user_id = ? and status = 'open'", a.p_shift_id, uid);
      if (!sh) throw new Error('Shift tidak aktif.');
    }

    let subtotal = 0;
    let totalCost = 0;
    for (const it of lines) {
      const price = num(it.price);
      const qty = Math.max(num(it.qty), 0);
      const disc = num(it.discount);
      subtotal += Math.max(round2(price * qty) - disc, 0);
      totalCost += num(it.cost) * qty;
    }
    subtotal = round2(subtotal);
    totalCost = round2(totalCost);

    let discount = 0;
    const dtype = isEmpty(a.p_discount_type) ? 'none' : String(a.p_discount_type);
    if (dtype === 'percent') {
      discount = round2((subtotal * Math.min(Math.max(num(a.p_discount_value), 0), 100)) / 100);
    } else if (dtype === 'fixed') {
      discount = Math.min(Math.max(num(a.p_discount_value), 0), subtotal);
    }
    const total = Math.max(0, round2(subtotal - discount));
    const paid = a.p_paid == null ? total : round2(num(a.p_paid));
    if (paid < total) throw new Error('Nominal bayar kurang dari total belanja.');
    const change = Math.max(0, round2(paid - total));

    const invoice = nextNumber(uid, 'kasir_transactions', 'invoice_no', `INV-${jakartaYMD()}-`, 4);
    const txId = randomUUID();
    const txRow = {
      id: txId,
      user_id: uid,
      invoice_no: invoice,
      subtotal,
      discount_type: dtype,
      discount_value: num(a.p_discount_value),
      discount_amount: discount,
      total,
      total_cost: totalCost,
      paid,
      change_due: change,
      payment_method: isEmpty(a.p_payment_method) ? 'cash' : String(a.p_payment_method),
      note: isEmpty(a.p_note) ? null : String(a.p_note),
      cashier_name: isEmpty(a.p_cashier_name) ? 'Kasir' : String(a.p_cashier_name),
      customer_name: isEmpty(a.p_customer_name) ? null : String(a.p_customer_name),
      status: 'completed',
      shift_id: isEmpty(a.p_shift_id) ? null : a.p_shift_id,
      created_at: nowIso(),
    };

    db.transaction(() => {
      insertRow('kasir_transactions', txRow);
      touch('kasir_transactions', txId, 'upsert');
      for (const it of lines) {
        const price = num(it.price);
        const cost = num(it.cost);
        const qty = Math.max(num(it.qty), 0);
        const disc = num(it.discount);
        const lineSub = Math.max(round2(price * qty) - disc, 0);
        const pid = isEmpty(it.product_id) ? null : String(it.product_id);
        const itemId = randomUUID();
        insertRow('kasir_transaction_items', {
          id: itemId,
          user_id: uid,
          transaction_id: txId,
          product_id: pid,
          barcode: isEmpty(it.barcode) ? null : String(it.barcode),
          product_name: isEmpty(it.name) ? 'Item' : String(it.name),
          price,
          cost,
          qty,
          discount: disc,
          subtotal: lineSub,
          konversi: it.konversi == null ? 1 : num(it.konversi),
          unit: isEmpty(it.unit) ? '' : String(it.unit),
        });
        touch('kasir_transaction_items', itemId, 'upsert');

        if (pid) {
          const p = getProduct(uid, pid);
          if (p) {
            const qtyK = Math.max(num(it.qty), 1) * (it.konversi == null ? 1 : num(it.konversi));
            const before = round2(num(p.stock));
            const after = Math.max(0, round2(before - qtyK));
            run('update kasir_products set stock = ?, updated_at = ? where id = ? and user_id = ?', after, nowIso(), pid, uid);
            touch('kasir_products', pid, 'upsert');
            insertLog(uid, {
              product_id: pid,
              tipe: 'terjual',
              qty: -qtyK,
              stok_sebelum: before,
              stok_sesudah: after,
              keterangan: `Penjualan ${invoice}`,
              ref_id: txId,
              ref_tipe: 'transaksi',
            });
          }
        }
      }
    })();

    const transaction = q1('select * from kasir_transactions where id = ?', txId);
    return {
      transaction,
      totals: { subtotal, discountAmount: discount, total, totalCost, profit: round2(total - totalCost) },
      changeDue: change,
    };
  }

  function kasirVoidTransaction(uid, a) {
    const tx = q1('select * from kasir_transactions where id = ? and user_id = ?', a.p_tx_id, uid);
    if (!tx) throw new Error('Transaksi tidak ditemukan.');
    if (tx.status === 'void') return tx;
    const items = qa('select * from kasir_transaction_items where transaction_id = ? and user_id = ?', a.p_tx_id, uid);
    db.transaction(() => {
      for (const it of items) {
        if (!it.product_id) continue;
        const p = getProduct(uid, it.product_id);
        if (!p) continue;
        const qtyK = num(it.qty) * (num(it.konversi) || 1);
        const before = round2(num(p.stock));
        const after = round2(before + qtyK);
        run('update kasir_products set stock = ?, updated_at = ? where id = ? and user_id = ?', after, nowIso(), it.product_id, uid);
        touch('kasir_products', it.product_id, 'upsert');
        insertLog(uid, {
          product_id: it.product_id,
          tipe: 'void',
          qty: qtyK,
          stok_sebelum: before,
          stok_sesudah: after,
          keterangan: `Batal ${tx.invoice_no}`,
          ref_id: a.p_tx_id,
          ref_tipe: 'transaksi',
        });
      }
      run("update kasir_transactions set status = 'void' where id = ?", a.p_tx_id);
      touch('kasir_transactions', a.p_tx_id, 'upsert');
    })();
    return q1('select * from kasir_transactions where id = ?', a.p_tx_id);
  }

  function kasirCreateReturn(uid, a) {
    const tx = q1('select * from kasir_transactions where id = ? and user_id = ?', a.p_tx_id, uid);
    if (!tx) throw new Error('Transaksi tidak ditemukan.');
    if (tx.status === 'void') throw new Error('Transaksi sudah dibatalkan, tidak bisa diretur.');
    const items = Array.isArray(a.p_items) ? a.p_items : [];
    if (!items.length) throw new Error('Tidak ada item yang diretur.');

    const returNo = nextNumber(uid, 'kasir_returns', 'retur_no', `RET-${jakartaYMD()}-`, 4);
    const returId = randomUUID();
    let total = 0;

    db.transaction(() => {
      insertRow('kasir_returns', {
        id: returId,
        user_id: uid,
        transaction_id: a.p_tx_id,
        invoice_no: tx.invoice_no,
        retur_no: returNo,
        total: 0,
        cashier_name: isEmpty(tx.cashier_name) ? 'Kasir' : tx.cashier_name,
        note: isEmpty(a.p_note) ? null : String(a.p_note),
        created_at: nowIso(),
      });
      touch('kasir_returns', returId, 'upsert');

      for (const line of a.p_items) {
        const itId = line.transaction_item_id;
        const it = q1('select * from kasir_transaction_items where id = ? and transaction_id = ? and user_id = ?', itId, a.p_tx_id, uid);
        if (!it) throw new Error('Item transaksi tidak ditemukan.');
        const qty = round2(num(line.qty));
        if (qty <= 0) continue;
        const prev = q1('select coalesce(sum(qty),0) as v from kasir_return_items where transaction_item_id = ? and user_id = ?', itId, uid);
        if (num(prev.v) + qty > num(it.qty) + 0.01) throw new Error('Qty retur melebihi sisa terjual.');
        const disc = round2((num(it.discount) * qty) / Math.max(num(it.qty), 1));
        const refund = round2(num(it.price) * qty - disc);
        const riId = randomUUID();
        insertRow('kasir_return_items', {
          id: riId,
          user_id: uid,
          return_id: returId,
          transaction_item_id: it.id,
          product_id: it.product_id,
          product_name: it.product_name,
          price: num(it.price),
          cost: num(it.cost),
          qty,
          discount: disc,
          refund,
        });
        touch('kasir_return_items', riId, 'upsert');
        total += refund;

        if (it.product_id) {
          const p = getProduct(uid, it.product_id);
          if (p) {
            const qtyK = qty * (num(it.konversi) || 1);
            const before = round2(num(p.stock));
            const after = round2(before + qtyK);
            run('update kasir_products set stock = ?, updated_at = ? where id = ? and user_id = ?', after, nowIso(), it.product_id, uid);
            touch('kasir_products', it.product_id, 'upsert');
            insertLog(uid, {
              product_id: it.product_id,
              tipe: 'retur',
              qty: qtyK,
              stok_sebelum: before,
              stok_sesudah: after,
              keterangan: `Retur ${returNo}`,
              ref_id: returId,
              ref_tipe: 'retur',
            });
          }
        }
      }
      if (total === 0) throw new Error('Tidak ada item yang diretur.');
      run('update kasir_returns set total = ? where id = ?', round2(total), returId);
    })();

    const ret = q1('select * from kasir_returns where retur_no = ? and user_id = ?', returNo, uid);
    return { return: ret, total: round2(total) };
  }

  // ------------------------- pembelian -------------------------
  function kasirCreatePurchase(uid, a) {
    if (!Array.isArray(a.p_items) || !a.p_items.length) throw new Error('Minimal satu item pembelian.');
    const status = a.p_status === 'hutang' ? 'hutang' : 'lunas';
    const invoice = `PO-${jakartaYMD().slice(2)}-${pad(((parseInt(meta('purchase_seq') || '0', 10) || 0) + 1), 5)}`;
    setMeta('purchase_seq', String((parseInt(meta('purchase_seq') || '0', 10) || 0) + 1));
    const purchaseId = randomUUID();
    let total = 0;
    db.transaction(() => {
      insertRow('kasir_purchases', {
        id: purchaseId,
        user_id: uid,
        supplier_id: isEmpty(a.p_supplier_id) ? null : a.p_supplier_id,
        supplier_name: a.p_supplier_name == null ? null : String(a.p_supplier_name),
        total: 0,
        note: isEmpty(a.p_note) ? null : String(a.p_note),
        invoice_no: invoice,
        status,
        created_at: nowIso(),
      });
      touch('kasir_purchases', purchaseId, 'upsert');
      for (const it of a.p_items) {
        const qty = Math.max(num(it.qty), 0);
        const cost = Math.max(num(it.cost), 0);
        const sub = round2(qty * cost);
        total += sub;
        const pid = isEmpty(it.product_id) ? null : String(it.product_id);
        const piId = randomUUID();
        insertRow('kasir_purchase_items', {
          id: piId,
          purchase_id: purchaseId,
          user_id: uid,
          product_id: pid,
          product_name: isEmpty(it.name) ? 'Item' : String(it.name),
          qty,
          cost,
          subtotal: sub,
          unit: isEmpty(it.unit) ? null : String(it.unit),
        });
        touch('kasir_purchase_items', piId, 'upsert');
        if (pid) {
          const p = getProduct(uid, pid);
          if (p) {
            const before = round2(num(p.stock));
            const after = round2(before + qty);
            run('update kasir_products set stock = ?, updated_at = ? where id = ? and user_id = ?', after, nowIso(), pid, uid);
            touch('kasir_products', pid, 'upsert');
            insertLog(uid, {
              product_id: pid,
              tipe: 'stok_masuk',
              qty,
              stok_sebelum: before,
              stok_sesudah: after,
              keterangan: `Pembelian ${a.p_supplier_name || ''}`.trim(),
              ref_id: purchaseId,
              ref_tipe: 'pembelian',
            });
          }
        }
      }
      run('update kasir_purchases set total = ? where id = ?', round2(total), purchaseId);
      touch('kasir_purchases', purchaseId, 'upsert');
    })();
    return { id: purchaseId, total: round2(total), invoice_no: invoice, status };
  }

  function kasirUpdatePurchase(uid, a) {
    if (!Array.isArray(a.p_items) || !a.p_items.length) throw new Error('Minimal satu item pembelian.');
    const po = q1('select * from kasir_purchases where id = ?', a.p_id);
    if (!po) throw new Error('Pembelian tidak ditemukan.');
    if (po.user_id !== uid) throw new Error('Bukan milik pengguna ini.');
    const status = a.p_status === 'hutang' ? 'hutang' : 'lunas';

    const lama = new Map();
    for (const it of qa('select product_id, qty from kasir_purchase_items where purchase_id = ? and product_id is not null', a.p_id)) {
      lama.set(it.product_id, (lama.get(it.product_id) || 0) + num(it.qty));
    }
    const baru = new Map();
    for (const e of a.p_items) {
      if (isEmpty(e.product_id)) continue;
      baru.set(String(e.product_id), (baru.get(String(e.product_id)) || 0) + Math.max(num(e.qty), 0));
    }
    const keys = new Set([...lama.keys(), ...baru.keys()]);

    let total = 0;
    db.transaction(() => {
      for (const pid of keys) {
        const delta = (baru.get(pid) || 0) - (lama.get(pid) || 0);
        if (delta === 0) continue;
        const p = getProduct(uid, pid);
        if (!p) continue;
        const before = round2(num(p.stock));
        const after = round2(before + delta);
        run('update kasir_products set stock = ?, updated_at = ? where id = ? and user_id = ?', after, nowIso(), pid, uid);
        touch('kasir_products', pid, 'upsert');
        insertLog(uid, {
          product_id: pid,
          tipe: delta > 0 ? 'stok_masuk' : 'stok_keluar',
          qty: round2(after - before),
          stok_sebelum: before,
          stok_sesudah: after,
          keterangan: `Edit pembelian ${a.p_supplier_name || ''}`.trim(),
          ref_id: a.p_id,
          ref_tipe: 'pembelian',
        });
      }
      run('delete from kasir_purchase_items where purchase_id = ?', a.p_id);
      for (const it of a.p_items) {
        const qty = Math.max(num(it.qty), 0);
        const cost = Math.max(num(it.cost), 0);
        const sub = round2(qty * cost);
        total += sub;
        const piId = randomUUID();
        insertRow('kasir_purchase_items', {
          id: piId,
          purchase_id: a.p_id,
          user_id: uid,
          product_id: isEmpty(it.product_id) ? null : String(it.product_id),
          product_name: isEmpty(it.name) ? 'Item' : String(it.name),
          qty,
          cost,
          subtotal: sub,
          unit: isEmpty(it.unit) ? null : String(it.unit),
        });
        touch('kasir_purchase_items', piId, 'upsert');
      }
      run('update kasir_purchases set supplier_id = ?, supplier_name = ?, total = ?, note = ?, status = ? where id = ?', isEmpty(a.p_supplier_id) ? null : a.p_supplier_id, a.p_supplier_name == null ? null : String(a.p_supplier_name), round2(total), isEmpty(a.p_note) ? null : String(a.p_note), status, a.p_id);
      touch('kasir_purchases', a.p_id, 'upsert');
    })();
    return { id: a.p_id, total: round2(total), invoice_no: po.invoice_no, status };
  }

  function kasirDeletePurchase(uid, a) {
    const po = q1('select * from kasir_purchases where id = ?', a.p_id);
    if (!po) throw new Error('Pembelian tidak ditemukan.');
    if (po.user_id !== uid) throw new Error('Bukan milik pengguna ini.');
    db.transaction(() => {
      for (const it of qa('select product_id, qty from kasir_purchase_items where purchase_id = ?', a.p_id)) {
        const qty = num(it.qty);
        if (!it.product_id || qty === 0) continue;
        const p = getProduct(uid, it.product_id);
        if (!p) continue;
        const before = round2(num(p.stock));
        const after = Math.max(0, round2(before - qty));
        run('update kasir_products set stock = ?, updated_at = ? where id = ? and user_id = ?', after, nowIso(), it.product_id, uid);
        touch('kasir_products', it.product_id, 'upsert');
        insertLog(uid, {
          product_id: it.product_id,
          tipe: 'stok_keluar',
          qty: -qty,
          stok_sebelum: before,
          stok_sesudah: after,
          keterangan: 'Hapus pembelian',
          ref_id: a.p_id,
          ref_tipe: 'pembelian',
        });
      }
      run('delete from kasir_purchase_items where purchase_id = ?', a.p_id);
      run('delete from kasir_purchases where id = ?', a.p_id);
      touch('kasir_purchases', a.p_id, 'delete');
    })();
    return { id: a.p_id };
  }

  // ------------------------- dispatch RPC -------------------------
  const RPC = {
    kasir_adjust_stock: kasirAdjustStock,
    kasir_opname_stock: kasirOpnameStock,
    kasir_stock_logs_list: kasirStockLogsList,
    kasir_stock_movements: kasirStockMovements,
    kasir_report_summary: kasirReportSummary,
    kasir_report_top: kasirReportTop,
    kasir_report_daily: kasirReportDaily,
    kasir_report_by_payment: kasirReportByPayment,
    kasir_report_by_cashier: kasirReportByCashier,
    kasir_active_shift: (uid) => kasirActiveShift(uid),
    kasir_open_shift: kasirOpenShift,
    kasir_shift_preview: kasirShiftPreview,
    kasir_close_shift: kasirCloseShift,
    kasir_create_transaction: kasirCreateTransaction,
    kasir_void_transaction: kasirVoidTransaction,
    kasir_create_return: kasirCreateReturn,
    kasir_create_purchase: kasirCreatePurchase,
    kasir_update_purchase: kasirUpdatePurchase,
    kasir_delete_purchase: kasirDeletePurchase,
  };

  function doRpc(fn, args, uid) {
    const f = RPC[fn];
    if (!f) throw new Error(`Fungsi lokal belum didukung: ${fn}`);
    return f(uid, args || {});
  }

  // ------------------------- API publik -------------------------
  function handle(op) {
    if (!op || typeof op !== 'object') throw new Error('Operasi lokal tidak valid.');
    const uid = String(op.uid || meta('localUserId') || '');
    if (op.kind !== 'rpc' && !uid) throw new Error('Sesi lokal belum diinisialisasi.');
    switch (op.kind) {
      case 'select':
        return doSelect(op, uid);
      case 'insert':
        return doInsert(op, uid);
      case 'update':
        return doUpdate(op, uid);
      case 'delete':
        return doDelete(op, uid);
      case 'upsert':
        return doUpsert(op, uid);
      case 'rpc':
        return { data: doRpc(op.fn, op.args || {}, uid) };
      default:
        throw new Error(`Operasi tidak dikenal: ${op.kind}`);
    }
  }

  function setUserId(id) {
    setMeta('localUserId', String(id || ''));
  }
  function userId() {
    return meta('localUserId') || '';
  }

  function getRowForSync(tbl, rowId, uid) {
    if (!APP_TABLES.has(tbl)) return null;
    const row = NO_ID.has(tbl)
      ? q1(`select * from "${tbl}" where key = ? and user_id = ?`, rowId, uid)
      : q1(`select * from "${tbl}" where id = ? and user_id = ?`, rowId, uid);
    return row ? rowsToObj(tbl, row) : null;
  }

  /**
   * Impor baris hasil tarikan dari Supabase (restore / sinkronisasi turun).
   *
   * Berbeda dari `doUpsert`: penulisan di sini TIDAK dicatat ke `_outbox`,
   * supaya data yang baru diambil dari server tidak dikirim balik ke server.
   * Idempoten — aman dijalankan berkali-kali.
   */
  function importRows(tbl, list, uid) {
    const table = assertTable(tbl);
    const rows = Array.isArray(list) ? list : [list];
    const conflict = NO_ID.has(table) ? ['user_id', 'key'] : ['id'];
    let n = 0;
    db.transaction(() => {
      for (const item of rows) {
        if (!item || typeof item !== 'object') continue;
        const row = Object.assign({}, item);
        if (!row.user_id) row.user_id = uid || meta('localUserId') || '';
        if (!NO_ID.has(table) && !row.id) row.id = randomUUID();
        if (!NO_CREATED.has(table) && !row.created_at) row.created_at = nowIso();
        if (HAS_UPDATED.has(table) && !row.updated_at) row.updated_at = nowIso();
        upsertRow(table, row, conflict);
        n++;
      }
    })();
    return n;
  }

  /** Tandai bahwa tarikan awal dari server sudah selesai (per user). */
  function markInitialPull(uid) {
    setMeta(`initialPull:${uid || meta('localUserId') || ''}`, nowIso());
  }

  function initialPullDone(uid) {
    return !!meta(`initialPull:${uid || meta('localUserId') || ''}`);
  }

  /** Kumpulkan baris lokal untuk semua tabel (dipakai untuk verifikasi/backup). */
  function exportAll(uid) {
    const out = {};
    for (const t of APP_TABLES) {
      const keyCol = NO_ID.has(t) ? 'key' : 'id';
      out[t] = qa(`select * from "${t}" where user_id = ?`, uid).map((r) => rowsToObj(t, r));
      void keyCol;
    }
    return out;
  }

  function stats() {
    const out = {};
    for (const t of APP_TABLES) out[t] = num(q1(`select count(*) as c from "${t}"`).c);
    out._outbox_pending = num(q1('select count(*) as c from _outbox where done = 0').c);
    out.localUserId = meta('localUserId');
    return out;
  }

  function close() {
    try {
      db.close();
    } catch {
      /* abaikan */
    }
  }

  return {
    handle,
    doRpc,
    getUserId: () => meta('localUserId'),
    setUserId,
    stats,
    getRowForSync,
    importRows,
    markInitialPull,
    initialPullDone,
    exportAll,
    outbox: {
      pending: () => qa('select tbl, row_id as row_id, op, ts from _outbox where done = 0 order by ts'),
      done: (tbl, rowId, op) =>
        run('update _outbox set done = 1 where tbl = ? and row_id = ? and op = ?', tbl, String(rowId), op),
      // Alias: main.js memanggil `outbox.mark(tbl, rowId, op)`.
      mark: (tbl, rowId, op) =>
        run('update _outbox set done = 1 where tbl = ? and row_id = ? and op = ?', tbl, String(rowId), op),
    },
    close,
    _db: db,
  };
}

module.exports = { createEngine, APP_TABLES };
