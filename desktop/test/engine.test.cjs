'use strict';

/**
 * Uji cepat mesin database lokal (tanpa Electron).
 *   node desktop/test/engine.test.cjs
 */

const os = require('os');
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { createEngine } = require('../src/db/engine.cjs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kpro-'));
const dbPath = path.join(tmp, 'test.db');
const eng = createEngine(dbPath);
const uid = '11111111-1111-1111-1111-111111111111';
eng.setUserId(uid);

const rpc = (fn, args) => eng.handle({ kind: 'rpc', fn, args }).data;

let pass = 0;
function ok(name, fn) {
  try {
    fn();
    pass++;
    console.log('  ok  ' + name);
  } catch (e) {
    console.error('FAIL  ' + name + ' :: ' + e.message);
    process.exitCode = 1;
  }
}

// ---- produk ----
const created = eng.handle({
  kind: 'insert',
  table: 'kasir_products',
  payload: { name: 'Indomie', category: 'Makanan', price: 3500, cost: 3000, stock: 10, min_stock: 2, unit: 'pcs', variants: [{ satuan: 'Dus', konversi: 6, hargaJual: 20000 }], satuan_list: ['Dus'] },
  returning: true,
});
const pid = created.data[0].id;
ok('produk dibuat + variants json', () => {
  assert.equal(created.data[0].name, 'Indomie');
  assert.equal(created.data[0].is_active, true);
  assert.equal(created.data[0].variants[0].konversi, 6);
});

// ---- transaksi ----
const tx = rpc('kasir_create_transaction', {
  p_lines: [{ product_id: pid, name: 'Indomie', price: 3500, cost: 3000, qty: 2, discount: 0, konversi: 1, unit: 'Pcs' }],
  p_discount_type: 'none',
  p_discount_value: 0,
  p_payment_method: 'cash',
  p_paid: 10000,
  p_note: null,
  p_cashier_name: 'Kasir',
});
ok('transaksi: invoice + total + stok', () => {
  assert.match(tx.transaction.invoice_no, /^INV-\d{8}-0001$/);
  assert.equal(tx.transaction.total, 7000);
  assert.equal(tx.totals.profit, 1000);
  assert.equal(tx.changeDue, 3000);
  const p = eng.handle({ kind: 'select', table: 'kasir_products', filters: [{ op: 'eq', col: 'id', val: pid }] }).data[0];
  assert.equal(p.stock, 8);
});

// ---- void ----
ok('void: stok kembali', () => {
  rpc('kasir_void_transaction', { p_tx_id: tx.transaction.id });
  const p = eng.handle({ kind: 'select', table: 'kasir_products', filters: [{ op: 'eq', col: 'id', val: pid }] }).data[0];
  assert.equal(p.stock, 10);
});

// ---- pembelian ----
const po = rpc('kasir_create_purchase', {
  p_supplier_name: 'Toko Grosir',
  p_supplier_id: null,
  p_items: [{ product_id: pid, name: 'Indomie', qty: 5, cost: 2800, unit: 'Pcs' }],
  p_note: null,
  p_status: 'lunas',
});
ok('pembelian: invoice PO + stok naik', () => {
  assert.match(po.invoice_no, /^PO-\d{6}-\d{5}$/);
  assert.equal(po.total, 14000);
  const p = eng.handle({ kind: 'select', table: 'kasir_products', filters: [{ op: 'eq', col: 'id', val: pid }] }).data[0];
  assert.equal(p.stock, 15);
});

// ---- edit pembelian ----
ok('edit pembelian: selisih stok', () => {
  rpc('kasir_update_purchase', {
    p_id: po.id,
    p_supplier_name: 'Toko Grosir',
    p_supplier_id: null,
    p_items: [{ product_id: pid, name: 'Indomie', qty: 3, cost: 2800, unit: 'Pcs' }],
    p_note: null,
    p_status: 'hutang',
  });
  const p = eng.handle({ kind: 'select', table: 'kasir_products', filters: [{ op: 'eq', col: 'id', val: pid }] }).data[0];
  assert.equal(p.stock, 13);
});

// ---- retur ----
ok('retur penjualan', () => {
  const tx2 = rpc('kasir_create_transaction', {
    p_lines: [{ product_id: pid, name: 'Indomie', price: 3500, cost: 3000, qty: 4, discount: 0, konversi: 1, unit: 'Pcs' }],
    p_discount_type: 'none',
    p_discount_value: 0,
    p_payment_method: 'cash',
    p_paid: 20000,
    p_cashier_name: 'Kasir',
  });
  const items = eng.handle({ kind: 'select', table: 'kasir_transaction_items', filters: [{ op: 'eq', col: 'transaction_id', val: tx2.transaction.id }] }).data;
  const r = rpc('kasir_create_return', { p_tx_id: tx2.transaction.id, p_items: [{ transaction_item_id: items[0].id, qty: 1 }], p_note: null });
  assert.match(r.return.retur_no, /^RET-\d{8}-0001$/);
  assert.equal(r.total, 3500);
  const p = eng.handle({ kind: 'select', table: 'kasir_products', filters: [{ op: 'eq', col: 'id', val: pid }] }).data[0];
  assert.equal(p.stock, 10); // 13 - 4 + 1
});

// ---- laporan ----
ok('laporan ringkasan', () => {
  const s = rpc('kasir_report_summary', { p_from: null, p_to: null });
  assert.equal(s.jumlah_transaksi, 1); // tx2 tersisa (tx1 void)
  assert.equal(s.total_omzet, 14000);
});

// ---- pengaturan (upsert) ----
ok('upsert pengaturan', () => {
  eng.handle({ kind: 'upsert', table: 'kasir_settings', payload: { user_id: uid, key: 'toko', value: { nama: 'Warung A' } }, onConflict: 'user_id,key' });
  const row = eng.handle({ kind: 'select', table: 'kasir_settings', filters: [{ op: 'eq', col: 'key', val: 'toko' }] }).data[0];
  assert.deepEqual(row.value, { nama: 'Warung A' });
});

// ---- query builder: or + order + limit ----
ok('query or/order/limit', () => {
  eng.handle({ kind: 'insert', table: 'kasir_products', payload: { name: 'Kopi Kapal Api', price: 2000, cost: 1500, stock: 3 }, returning: true });
  const rows = eng.handle({
    kind: 'select',
    table: 'kasir_products',
    filters: [{ op: 'or', val: 'name.ilike.*indom*,barcode.ilike.*indom*' }],
    orders: [{ col: 'name', ascending: true }],
    limit: 5,
  }).data;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Indomie');
});

// ---- pergerakan stok ----
ok('pergerakan stok ada mutasi', () => {
  const mv = rpc('kasir_stock_movements', { p_from: null, p_to: null, p_product_id: pid, p_jenis: null, p_q: null });
  assert.ok(mv.length >= 4);
  assert.ok(mv.some((m) => m.jenis === 'PENJUALAN'));
  assert.ok(mv.some((m) => m.jenis === 'PEMBELIAN'));
});

// ---- shift ----
ok('shift buka/preview/tutup', () => {
  const s = rpc('kasir_open_shift', { p_opening_cash: 100000, p_cashier_name: 'Kasir' });
  assert.match(s.shift_no, /^SHIFT-\d{8}-\d{4}$/);
  let err = null;
  try { rpc('kasir_open_shift', { p_opening_cash: 0, p_cashier_name: 'Kasir' }); } catch (e) { err = e.message; }
  assert.ok(/masih terbuka/.test(err || ''));
  const pv = rpc('kasir_shift_preview', { p_shift_id: s.id });
  assert.equal(pv.expected, 100000);
  const c = rpc('kasir_close_shift', { p_shift_id: s.id, p_actual_cash: 100000 });
  assert.equal(c.selisih, 0);
  assert.equal(c.shift.status, 'closed');
});

// ---- laporan ringkas & outbox ----
ok('outbox mencatat perubahan', () => {
  const pending = eng.outbox.pending();
  assert.ok(pending.length > 0);
  assert.ok(pending.every((o) => o.tbl && o.row_id && o.op));
});

ok('stats tabel terisi', () => {
  const s = eng.stats();
  assert.ok(s.kasir_products >= 2);
  assert.equal(s.localUserId, uid);
});

console.log(`\n${pass} pengujian lulus.`);
eng.close();
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* abaikan */ }
