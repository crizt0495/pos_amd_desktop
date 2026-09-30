#!/usr/bin/env node
/**
 * ============================================================================
 *  check-supabase — memastikan KasirPro POS siap dipakai
 * ============================================================================
 *  Menguji:
 *    1. Variabel env terisi
 *    2. Tabel kasir_products / kasir_transactions / kasir_settings / shift /
 *       retur / kartu stok ada
 *    3. RPC transaksi (create 9-arg dgn shift, void, retur) ada
 *    4. RPC kartu stok (adjust, logs_list) & shift aktif ada
 *    5. RPC laporan (summary, top, daily, by_payment, by_cashier) ada
 *
 *  Memakai kunci service role + PostgREST (TANPA mengubah data).
 *
 *  Jalankan:
 *      npm run check:supabase
 *  Keluar dengan kode 0 kalau semua hijau, 1 kalau ada yang belum siap.
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

function readEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return out;
}

let fail = 0;
const g = (s) => `\x1b[32m${s}\x1b[0m`;
const r = (s) => `\x1b[31m${s}\x1b[0m`;
const d = (s) => `\x1b[90m${s}\x1b[0m`;
const ok = (msg) => console.log(`  ${g('OK  ')} ${msg}`);
const bad = (msg) => {
  fail += 1;
  console.log(`  ${r('GAGAL')} ${msg}`);
};

async function main() {
  const env = readEnv(path.join(ROOT, '.env.local'));
  const url = env.NEXT_PUBLIC_SUPABASE_URL || '';
  const serviceKey = env.SUPABASE_SECRET_KEY || env.SERVICE_KEY || process.env.SUPABASE_SECRET_KEY || '';

  console.log('\n1. Variabel environment');
  if (!url || !serviceKey) {
    bad('Butuh NEXT_PUBLIC_SUPABASE_URL dan SUPABASE_SECRET_KEY di .env.local');
    process.exit(1);
  }
  ok('URL & kunci terisi');

  let sb;
  try {
    sb = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    ok('Klien service-role dibuat');
  } catch (e) {
    bad(`Klien service-role gagal: ${e.message}`);
    process.exit(1);
  }

  console.log('\n2. Tabel kasir_*');
  for (const table of ['kasir_products', 'kasir_transactions', 'kasir_transaction_items', 'kasir_settings', 'kasir_customers', 'kasir_license_accounts', 'kasir_shifts', 'kasir_returns', 'kasir_return_items', 'kasir_stock_logs']) {
    const { error } = await sb.from(table).select('*', { count: 'exact', head: true }).limit(1);
    if (error) bad(`Tabel ${table}: ${error.message} (jalankan supabase/schema.sql di SQL Editor)`);
    else ok(`Tabel ${table} ada`);
  }

  console.log('\n3. RPC transaksi');
  // create_transaction dikirim dengan nama parameter p_shift_id eksplisit:
  //   - DB versi 9-arg (shift casing, sudah migrasi)  -> shift fiktif -> error 'Shift tidak aktif.' -> fungsi ada
  //   - DB versi 8-arg (belum migrasi)                -> PostgREST "could not find the function p_shift_id" -> GAGAL
  for (const [fn, args] of [
    ['kasir_create_transaction', { p_lines: [], p_discount_type: 'none', p_discount_value: 0, p_payment_method: 'cash', p_paid: 0, p_note: null, p_cashier_name: 'x', p_customer_name: null, p_shift_id: '00000000-0000-0000-0000-000000000000' }],
    ['kasir_void_transaction', { p_tx_id: '00000000-0000-0000-0000-000000000000' }],
    ['kasir_create_return', { p_tx_id: '00000000-0000-0000-0000-000000000000', p_items: [] }],
  ]) {
    const { error } = await sb.rpc(fn, args);
    // Error karena argumen/data valid? Fungsi ADA jika error-nya "keranjang kosong"/"tidak ditemukan",
    // bukan "function tidak ditemukan".
    if (error && /function.*does not exist|could not find the function/i.test(error.message)) {
      bad(`RPC ${fn} belum ada (jalankan migrasi shift/retur di SQL Editor)`);
    } else {
      ok(`RPC ${fn} ada`);
    }
  }

  console.log('\n3b. RPC kartu stok & shift');
  for (const [fn, args] of [
    ['kasir_adjust_stock', { p_product_id: '00000000-0000-0000-0000-000000000000', p_delta: 0 }],
    ['kasir_stock_logs_list', { p_product_id: '00000000-0000-0000-0000-000000000000' }],
    ['kasir_active_shift', {}],
  ]) {
    const { error } = await sb.rpc(fn, args);
    if (error && /function.*does not exist|could not find the function/i.test(error.message)) {
      bad(`RPC ${fn} belum ada (jalankan migrasi kartu stok di SQL Editor)`);
    } else {
      ok(`RPC ${fn} ada` + (error ? ` (data kosong: ${error.message.split('\n')[0] ?? ''})` : ''));
    }
  }

  console.log('\n4. RPC laporan');
  for (const [fn, args] of [
    ['kasir_report_summary', { p_from: null, p_to: null }],
    ['kasir_report_top', { p_from: null, p_to: null, p_limit: 5 }],
    ['kasir_report_daily', { p_from: null, p_to: null }],
    ['kasir_report_by_payment', { p_from: null, p_to: null }],
    ['kasir_report_by_cashier', { p_from: null, p_to: null }],
  ]) {
    // panggil dengan argumen kosong; kalau fungsi ADA, PostgREST tidak
    // mengembalikan error "function does not exist".
    const { data, error } = await sb.rpc(fn, args);
    if (error && /function.*does not exist|could not find the function/i.test(error.message)) {
      bad(`RPC ${fn} belum ada (jalankan supabase/schema.sql)`);
    } else {
      ok(`RPC ${fn} ada` + (error ? ` (isi kosong: ${error.message.split('\n')[0] ?? ''})` : ''));
    }
  }

  console.log(fail === 0 ? '\nSemua hijau — aplikasi siap.\n' : `\n${fail} bagian belum siap.\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});