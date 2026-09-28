'use strict';

/**
 * ===========================================================================
 *  Pendaftaran IPC — semua channel yang boleh dipanggil renderer
 * ===========================================================================
 *  Dipisah dari main.js supaya bisa diuji tanpa membuka jendela aplikasi.
 *  Nama channel di sini WAJIB sama dengan yang dipanggil electron/preload.js.
 *
 *  Semua handler dibungkus `handle()` sehingga error tidak pernah membuat
 *  renderer crash — renderer selalu menerima { ok: false, error }.
 */

const { app, ipcMain, shell } = require('electron');
const path = require('node:path');

const db = require('./db');
const license = require('./license');
const thermal = require('./thermal');
const { getHwid } = require('./hwid');
const { portalUrl, appVersion } = require('./config');

const isDev = !app.isPackaged;

/* ------------------------------------------------------------------ */
/* IPC helpers                                                         */
/* ------------------------------------------------------------------ */

/** Bungkus handler agar error tidak pernah menyebabkan renderer crash. */
function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, payload) => {
    try {
      return await fn(payload ?? {});
    } catch (err) {
      console.error(`[KasirPro] IPC ${channel} gagal:`, err);
      return { ok: false, error: err?.message ?? 'Terjadi kesalahan di aplikasi.' };
    }
  });
}

function registerIpc() {
  /* ---------------------------- sistem ---------------------------- */
  // raw (UUID motherboard mentah) TIDAK dikirim ke renderer — hanya dipakai
  // internal main process saat aktivasi (lihat license.js).
  handle('get-hwid', async () => {
    const full = await getHwid();
    if (!full || !full.ok) return full;
    const { raw, ...rest } = full;
    return rest;
  });
  handle('app-info', () => ({
    ok: true,
    version: appVersion(),
    platform: process.platform,
    portalUrl: portalUrl(),
    dbPath: path.join(app.getPath('userData'), 'kasir.db'),
    escpos: thermal.hasEscpos,
    isDev,
  }));

  /* --------------------------- lisensi --------------------------- */
  handle('activate-license', ({ serialKey }) => license.activate(serialKey));
  handle('check-license', () => license.checkLicense());
  handle('reset-license', () => license.resetLicense());

  /* --------------------------- produk ---------------------------- */
  handle('products:list', ({ search, includeInactive }) => ({
    ok: true,
    data: db.products.list({ search, includeInactive }),
  }));
  handle('products:get', ({ id }) => ({ ok: true, data: db.products.get(id) }));
  handle('products:find-barcode', ({ barcode }) => ({
    ok: true,
    data: db.products.findByBarcode(barcode),
  }));
  handle('products:categories', () => ({ ok: true, data: db.products.categories() }));
  handle('products:low-stock', () => ({ ok: true, data: db.products.lowStock() }));
  handle('products:create', (data) => ({ ok: true, data: db.products.create(data) }));
  handle('products:update', ({ id, ...data }) => ({
    ok: true,
    data: db.products.update(id, data),
  }));
  handle('products:remove', ({ id }) => db.products.remove(id));
  handle('products:adjust-stock', ({ id, delta }) => ({
    ok: true,
    data: db.products.adjustStock(id, delta),
  }));

  /* ------------------------- transaksi -------------------------- */
  handle('transactions:create', (data) => {
    const result = db.transactions.create(data);
    return { ok: true, data: result };
  });
  handle('transactions:list', ({ from, to, limit, offset, status }) => ({
    ok: true,
    data: db.transactions.list({ from, to, limit, offset, status }),
  }));
  handle('transactions:count', ({ from, to, status }) => ({
    ok: true,
    data: db.transactions.count({ from, to, status }),
  }));
  handle('transactions:get', ({ id }) => ({
    ok: true,
    data: db.transactions.get(id),
    items: db.transactions.items(id),
  }));
  handle('transactions:void', ({ id }) => ({ ok: true, data: db.transactions.void(id) }));

  /* --------------------------- laporan -------------------------- */
  handle('reports:summary', ({ from, to }) => ({ ok: true, data: db.reports.summary({ from, to }) }));
  handle('reports:top-products', ({ from, to, limit }) => ({
    ok: true,
    data: db.reports.topProducts({ from, to, limit }),
  }));
  handle('reports:daily', ({ from, to }) => ({ ok: true, data: db.reports.daily({ from, to }) }));
  handle('reports:by-payment', ({ from, to }) => ({
    ok: true,
    data: db.reports.byPayment({ from, to }),
  }));

  /* --------------------------- pengaturan ------------------------ */
  handle('settings:get', ({ key, fallback }) => ({ ok: true, data: db.settings.get(key, fallback) }));
  handle('settings:set', ({ key, value }) => ({ ok: true, data: db.settings.set(key, value) }));
  handle('settings:all', () => ({ ok: true, data: db.settings.all() }));

  /* ---------------------------- cetak --------------------------- */
  handle('print-receipt', async ({ data, port }) => {
    const target = port ?? db.settings.get('printerPort', '');
    return thermal.printReceipt(data, { port: String(target ?? '') });
  });
  handle('print-test', async ({ port } = {}) => {
    const target = port ?? db.settings.get('printerPort', '');
    return thermal.printTest({ port: String(target ?? '') });
  });

  /* ----------------------------- lain --------------------------- */
  handle('open-external', async ({ url }) => {
    if (!url || !/^https?:\/\//i.test(url)) return { ok: false, error: 'URL tidak valid.' };
    await shell.openExternal(url);
    return { ok: true };
  });
}

module.exports = { registerIpc, handle };
