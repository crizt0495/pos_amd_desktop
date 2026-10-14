'use strict';

/**
 * Uji jalur sinkronisasi turun (pull): importRows, filter kolom asing,
 * penanda tarikan awal, dan exportAll. Tanpa Electron.
 *   node desktop/test/sync.test.cjs
 */

const os = require('os');
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { createEngine, APP_TABLES } = require('../src/db/engine.cjs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kpro-sync-'));
const eng = createEngine(path.join(tmp, 'sync.db'));
const uid = '22222222-2222-2222-2222-222222222222';
eng.setUserId(uid);

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

ok('APP_TABLES berisi 13 tabel', () => assert.strictEqual(APP_TABLES.size, 13));

ok('importRows memasukkan baris dari server', () => {
  const n = eng.importRows(
    'kasir_products',
    [
      { id: 'p1', user_id: uid, name: 'Kopi', price: 5000, stock: 3, is_active: true, satuan_list: ['Pcs'] },
      { id: 'p2', user_id: uid, name: 'Teh', price: 3000, stock: 7, is_active: true },
    ],
    uid,
  );
  assert.strictEqual(n, 2);
  const rows = eng.handle({ kind: 'select', table: 'kasir_products' }).data;
  assert.strictEqual(rows.length, 2);
});

ok('importRows idempoten (upsert, bukan duplikat)', () => {
  eng.importRows(
    'kasir_products',
    [{ id: 'p1', user_id: uid, name: 'Kopi Susu', price: 6000, stock: 4, is_active: true }],
    uid,
  );
  const rows = eng.handle({ kind: 'select', table: 'kasir_products' }).data;
  assert.strictEqual(rows.length, 2, 'tetap 2 baris');
  const p1 = rows.find((r) => r.id === 'p1');
  assert.strictEqual(p1.name, 'Kopi Susu');
  assert.strictEqual(Number(p1.price), 6000);
});

ok('kolom asing dari server dibuang, tidak error', () => {
  const n = eng.importRows(
    'kasir_products',
    [{ id: 'p3', user_id: uid, name: 'Gula', kolom_baru_server: 'x', price: 12000 }],
    uid,
  );
  assert.strictEqual(n, 1);
  const p3 = eng.handle({ kind: 'select', table: 'kasir_products' }).data.find((r) => r.id === 'p3');
  assert.ok(p3, 'baris tetap masuk');
  assert.strictEqual(Number(p3.price), 12000);
});

ok('importRows user_id diisi bila kosong', () => {
  eng.importRows('kasir_customers', [{ id: 'c1', name: 'Umum' }], uid);
  const c = eng.handle({ kind: 'select', table: 'kasir_customers' }).data[0];
  assert.strictEqual(c.user_id, uid);
});

ok('importRows kasir_settings pakai konflik (user_id,key)', () => {
  eng.importRows('kasir_settings', [{ user_id: uid, key: 'storeName', value: 'Toko A' }], uid);
  eng.importRows('kasir_settings', [{ user_id: uid, key: 'storeName', value: 'Toko B' }], uid);
  const rows = eng.handle({ kind: 'select', table: 'kasir_settings' }).data;
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].value, 'Toko B');
});

ok('importRows TIDAK mencatat ke _outbox', () => {
  const before = eng.stats()._outbox_pending;
  eng.importRows('kasir_products', [{ id: 'p9', user_id: uid, name: 'Sereh' }], uid);
  assert.strictEqual(eng.stats()._outbox_pending, before, 'outbox tidak bertambah');
});

ok('penulisan aplikasi tetap tercatat ke _outbox (untuk push)', () => {
  const before = eng.stats()._outbox_pending;
  eng.handle({ kind: 'insert', table: 'kasir_products', payload: { name: 'Baru', price: 1000 } });
  assert.ok(eng.stats()._outbox_pending > before, 'outbox bertambah');
});

ok('tabel tak dikenal ditolak', () => {
  assert.throws(() => eng.importRows('tabel_hantu', [{}], uid));
});

ok('markInitialPull / initialPullDone', () => {
  assert.strictEqual(eng.initialPullDone(uid), false);
  eng.markInitialPull(uid);
  assert.strictEqual(eng.initialPullDone(uid), true);
  assert.strictEqual(eng.initialPullDone('user-lain'), false);
});

ok('exportAll mengembalikan semua tabel', () => {
  const dump = eng.exportAll(uid);
  assert.deepStrictEqual(Object.keys(dump).sort(), [...APP_TABLES].sort());
  assert.ok(dump.kasir_products.length >= 4);
});

ok('outbox.mark menandai selesai', () => {
  const pending = eng.outbox.pending();
  assert.ok(pending.length > 0, 'ada yang menunggu');
  const e = pending[0];
  eng.outbox.mark(e.tbl, e.row_id, e.op);
  const after = eng.outbox.pending();
  assert.ok(!after.some((x) => x.tbl === e.tbl && x.row_id === e.row_id), 'baris ditandai selesai');
});

console.log(`\n${pass} pengujian lulus.`);
