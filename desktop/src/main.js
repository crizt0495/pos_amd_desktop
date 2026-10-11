'use strict';

/**
 * KasirPro POS — Electron desktop wrapper (Windows).
 *
 * Membungkus aplikasi web POS (Next.js di Vercel) menjadi aplikasi kasir
 * desktop: auto-login dari Serial Key tersimpan, fullscreen, tanpa tombol
 * logout, silent-print thermal, deteksi offline, dan auto-update.
 *
 * Alur start:
 *   loading.html  ->  [ belum ada serial ]  ->  setup.html (input 1x)
 *                 ->  [ ada serial ]        ->  login ke /api/auth/login
 *                                           ->  /kasir
 *   gagal koneksi ->  offline.html (retry tiap 5 detik)
 *   serial invalid -> setup.html + pesan error
 */

const { app, BrowserWindow, session, Menu, Tray, ipcMain, shell, dialog, nativeImage, net } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { randomUUID } = require('crypto');
const Store = require('electron-store');
const { autoUpdater } = require('electron-updater');
const { createEngine } = require('./db/engine.cjs');
const { startLocalServer } = require('./localServer.cjs');

const DEFAULT_SERVER = process.env.KASIRPRO_SERVER_URL || 'https://pos-amd-desktop.vercel.app';
const PARTITION = 'persist:kasirpro';
const PAGES_DIR = path.join(__dirname, 'pages');
const ASSETS_DIR = path.join(__dirname, '..', 'assets');
/** Ekspor statis aplikasi POS yang dibundel (lihat scripts/export-desktop.mjs). */
const LOCAL_APP_DIR = path.join(__dirname, '..', 'app');
const isDev = process.argv.includes('--dev');
const wantReset = process.argv.includes('--reset');

/** Config lokal (electron-store) — bertahan antar update & restart. */
const store = new Store({
  name: 'config',
  defaults: {
    serialKey: '',
    ownerPassword: '',
    storeName: 'Toko',
    serverUrl: DEFAULT_SERVER,
    printerName: '',
    pageSize: '80mm',
    deviceName: '',
    deviceId: '',
    localDb: false,
    localUserId: '',
    authSession: null,
  },
});

if (wantReset) {
  store.clear();
  store.set('deviceId', randomUUID());
}

/** HWID stabil per instalasi (dipakai lisensi: 1 key = 1 perangkat). */
function deviceId() {
  let id = String(store.get('deviceId') || '').trim();
  if (!id) {
    id = randomUUID();
    store.set('deviceId', id);
  }
  return id;
}

const serverUrl = () => String(store.get('serverUrl') || DEFAULT_SERVER).replace(/\/+$/, '');

// ---------------------------------------------------------------------------
// Satu instance saja
// ---------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let win = null;
let tray = null;
let ses = null;
let offlineTimer = null;
let booting = false;
let db = null;

// ---------------------------------------------------------------------------
// Database lokal (SQLite) — mode offline-first (lihat desktop/OFFLINE.md)
// ---------------------------------------------------------------------------
function dbEnabled() {
  return !!store.get('localDb');
}

function dbPath() {
  return path.join(app.getPath('userData'), 'kasirpro.db');
}

/** Buka database lokal bila mode lokal aktif. Aman dipanggil berkali-kali. */
function initDb() {
  if (db || !dbEnabled()) return;
  try {
    db = createEngine(dbPath());
    console.log('[db] database lokal siap:', dbPath());
  } catch (err) {
    db = null;
    console.error('[db] gagal membuka database lokal:', err.message);
  }
}

function closeDb() {
  if (db) {
    try { db.close(); } catch { /* abaikan */ }
    db = null;
  }
}

// ---------------------------------------------------------------------------
// Server aplikasi lokal (ekspor statis yang dibundel di installer)
// ---------------------------------------------------------------------------
let localServer = null;
let localOrigin = '';

function localAppAvailable() {
  try {
    return fs.existsSync(path.join(LOCAL_APP_DIR, 'kasir', 'index.html'));
  } catch {
    return false;
  }
}

async function ensureLocalServer() {
  if (localOrigin) return localOrigin;
  if (!localAppAvailable()) return '';
  try {
    const { server, port } = await startLocalServer(LOCAL_APP_DIR);
    localServer = server;
    localOrigin = `http://127.0.0.1:${port}`;
    console.log('[app] aplikasi lokal siap:', localOrigin);
    return localOrigin;
  } catch (err) {
    console.error('[app] gagal menjalankan server lokal:', err.message);
    return '';
  }
}

function closeLocalServer() {
  if (localServer) {
    try { localServer.close(); } catch { /* abaikan */ }
    localServer = null;
    localOrigin = '';
  }
}

/** True bila desktop memakai aplikasi + database lokal (mode offline-first). */
function offlineMode() {
  return dbEnabled() && localAppAvailable();
}

/** Nyalakan/matikan mode database lokal lalu muat ulang aplikasi. */
function toggleLocalDb(on) {
  store.set('localDb', !!on);
  if (on) {
    initDb();
  } else {
    closeDb();
  }
  const detail = on
    ? 'Data akan dibaca & ditulis ke database lokal (SQLite) dan disinkronkan ke Supabase saat online. Aplikasi dimuat ulang.'
    : 'Aplikasi kembali memakai Supabase langsung. Aplikasi dimuat ulang.';
  dialog
    .showMessageBox(win, {
      type: 'info',
      title: 'Database Lokal',
      message: on ? 'Mode database lokal diaktifkan.' : 'Mode database lokal dimatikan.',
      detail,
      buttons: ['OK'],
    })
    .finally(() => { void loadAppSafe(); });
}

// ---------------------------------------------------------------------------
// Login via window tersembunyi (cookie ditangani Chromium → tersimpan di sesi)
// ---------------------------------------------------------------------------
function login(serial) {
  return new Promise((resolve) => {
    const server = serverUrl();
    const loginUrl = `${server}/login`;
    const body = JSON.stringify({
      serial_key: serial,
      device_id: deviceId(),
      device_name: (os.hostname() || 'Perangkat Kasir').slice(0, 120),
      app_version: app.getVersion(),
      next: '/kasir',
    });

    let hidden;
    try {
      hidden = new BrowserWindow({
        show: false,
        webPreferences: {
          session: ses,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          spellcheck: false,
          backgroundThrottling: false,
        },
      });
    } catch (err) {
      resolve({ ok: false, message: `Gagal menyiapkan login: ${err.message}` });
      return;
    }

    let done = false;
    const finish = (res) => {
      if (done) return;
      done = true;
      clearTimeout(guard);
      try { hidden.destroy(); } catch { /* abaikan */ }
      resolve(res);
    };
    const guard = setTimeout(() => finish({ ok: false, offline: true, message: 'Server tidak merespons.' }), 25000);

    hidden.webContents.on('did-finish-load', async () => {
      try {
        const result = await hidden.webContents.executeJavaScript(
          `(async () => {
             try {
               const r = await fetch('/api/auth/login', {
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                 body: ${JSON.stringify(body)},
                 credentials: 'same-origin',
               });
               let j = {};
               try { j = await r.json(); } catch (e) {}
               return { status: r.status, ok: r.ok, json: j };
             } catch (e) {
               return { status: 0, ok: false, json: { message: 'NETWORK' } };
             }
           })()`,
          true,
        );
        if (result && result.ok && result.json && result.json.ok) {
          const j = result.json || {};
          try { if (j.user_id) store.set('localUserId', String(j.user_id)); } catch (e) {}
          try { if (j.session) store.set('authSession', j.session); } catch (e) {}
          try { initDb(); if (db && j.user_id) db.setUserId(String(j.user_id)); } catch (e) {}
          finish({ ok: true });
        } else if (result && result.status === 0) {
          finish({ ok: false, offline: true, message: 'Tidak bisa menghubungi server.' });
        } else {
          finish({ ok: false, message: (result && result.json && result.json.message) || `Login gagal (HTTP ${result && result.status}).` });
        }
      } catch (err) {
        finish({ ok: false, message: `Login gagal: ${err.message}` });
      }
    });

    hidden.webContents.on('did-fail-load', () => {
      finish({ ok: false, offline: true, message: 'Tidak bisa menghubungi server. Periksa koneksi internet.' });
    });

    hidden.loadURL(loginUrl).catch(() => {
      finish({ ok: false, offline: true, message: 'Tidak bisa menghubungi server.' });
    });
  });
}

/** Cek server terjangkau (untuk halaman offline). */
function reachable() {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    let req;
    try {
      req = net.request({ method: 'GET', url: `${serverUrl()}/login`, session: ses });
    } catch {
      done(false);
      return;
    }
    const timer = setTimeout(() => { try { req.abort(); } catch { /* abaikan */ } done(false); }, 8000);
    req.on('response', (res) => {
      res.on('data', () => {});
      res.on('end', () => { clearTimeout(timer); done(res.statusCode > 0); });
      clearTimeout(timer);
      done(res.statusCode > 0);
    });
    req.on('error', () => { clearTimeout(timer); done(false); });
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Navigasi halaman lokal & aplikasi
// ---------------------------------------------------------------------------
function showPage(file, query) {
  const target = path.join(PAGES_DIR, file);
  return query ? win.loadFile(target, { query }) : win.loadFile(target);
}

function stopOfflineTimer() {
  if (offlineTimer) {
    clearInterval(offlineTimer);
    offlineTimer = null;
  }
}

async function showOffline() {
  await showPage('offline.html');
  stopOfflineTimer();
  offlineTimer = setInterval(async () => {
    if (await reachable()) {
      stopOfflineTimer();
      void boot();
    }
  }, 5000);
}

async function showSetup(opts = {}) {
  const query = {};
  if (opts.mode) query.mode = opts.mode;
  if (opts.error) query.error = opts.error;
  await showPage('setup.html', query);
}

async function loadApp() {
  const useLocal = offlineMode() && localOrigin;
  const url = useLocal ? `${localOrigin}/kasir/` : `${serverUrl()}/kasir`;
  await win.loadURL(url);
  win.show();
  win.focus();
}

async function boot() {
  if (booting) return;
  booting = true;
  try {
    stopOfflineTimer();
    const serial = String(store.get('serialKey') || '').trim();
    if (!serial) {
      await showSetup({ mode: 'first' });
      return;
    }
    await showPage('loading.html');
    const res = await login(serial);
    if (res.ok) {
      await loadApp();
      return;
    }
    if (res.offline) {
      await showOffline();
      return;
    }
    // Serial salah / hangus — buang lalu minta input ulang.
    store.set('serialKey', '');
    await showSetup({ mode: 'first', error: res.message || 'Serial Key tidak valid. Masukkan kembali.' });
  } finally {
    booting = false;
  }
}

/** Muat ulang ke aplikasi (dipakai setelah ganti serial / retry). */
async function loadAppSafe() {
  const serial = String(store.get('serialKey') || '').trim();
  if (!serial) {
    await showSetup({ mode: 'first' });
    return;
  }
  await showPage('loading.html');
  const res = await login(serial);
  if (res.ok) {
    await loadApp();
  } else if (res.offline) {
    await showOffline();
  } else {
    store.set('serialKey', '');
    await showSetup({ mode: 'first', error: res.message });
  }
}

// ---------------------------------------------------------------------------
// Ganti serial (owner)
// ---------------------------------------------------------------------------
function openOwner() {
  const has = !!String(store.get('ownerPassword') || '');
  void showPage('owner.html', { state: has ? 'verify' : 'set' });
}

// ---------------------------------------------------------------------------
// Title + sembunyikan tombol Logout (disuntik ke halaman web)
// ---------------------------------------------------------------------------
const STORE_OBSERVER = `(() => {
  try {
    const readName = () => {
      const ps = document.querySelectorAll('.ipos-titlebar p');
      const name = ps && ps.length >= 2 ? (ps[1].textContent || '').trim() : '';
      if (name && name !== window.__kproStore) {
        window.__kproStore = name;
        const b = window.kasirproDesktop;
        if (b && b.reportStoreName) b.reportStoreName(name);
      }
    };
    readName();
    if (!window.__kproObs && document.body) {
      window.__kproObs = new MutationObserver(readName);
      window.__kproObs.observe(document.body, { childList: true, subtree: true, characterData: true });
    }
  } catch (e) {}
})();`;

async function injectDesktopHelpers() {
  try {
    await win.webContents.insertCSS('[title="Keluar"]{display:none !important;}');
  } catch { /* abaikan */ }
  try {
    await win.webContents.executeJavaScript(STORE_OBSERVER, true);
  } catch { /* abaikan */ }
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    fullscreen: true,
    autoHideMenuBar: true,
    backgroundColor: '#0f3a69',
    title: 'KasirPro POS',
    icon: path.join(ASSETS_DIR, 'icon.png'),
    webPreferences: {
      session: ses,
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  win.setMenuBarVisibility(false);
  // Jangan biarkan <title> halaman web menimpa judul "KasirPro POS - [Nama Toko]".
  win.on('page-title-updated', (event) => event.preventDefault());
  win.once('ready-to-show', () => {
    win.show();
    void boot();
  });

  // Navigasi keluar aplikasi → buka di browser luar, bukan di dalam POS.
  win.webContents.setWindowOpenHandler(({ url }) => {
    const server = serverUrl();
    const isLocal = url && (url.startsWith('http://127.0.0.1:') || url.startsWith('http://localhost:'));
    if (!url || url.startsWith('about:') || url.startsWith('blob:') || url.startsWith('data:') || url.startsWith(server) || isLocal) {
      return { action: 'allow' };
    }
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    const server = serverUrl();
    if (url.startsWith(server) || url.startsWith('http://127.0.0.1:') || url.startsWith('http://localhost:') || url.startsWith('file://') || url.startsWith('about:')) return;
    event.preventDefault();
    void shell.openExternal(url);
  });

  win.webContents.on('did-finish-load', () => {
    const url = win.webContents.getURL();
    if (url.startsWith('http')) void injectDesktopHelpers();
  });

  win.webContents.on('did-fail-load', (_e, code, _desc, url, isMainFrame) => {
    if (!isMainFrame) return;
    if (code === -3) return; // ERR_ABORTED — navigasi normal
    if (!url || url.startsWith('file://')) return;
    void showOffline();
  });

  // Kunci pintasan browser: cegah reload / devtools / tutup jendela.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const ctrl = input.control || input.meta;
    const shift = input.shift;

    // Rahasia owner: Ctrl+Alt+G → Ganti Serial.
    if (ctrl && input.alt && (input.key === 'g' || input.key === 'G')) {
      event.preventDefault();
      openOwner();
      return;
    }

    const blockCombo =
      (ctrl && (input.key === 'r' || input.key === 'R')) ||
      (ctrl && shift && (input.key === 'r' || input.key === 'R')) ||
      (ctrl && (input.key === 'w' || input.key === 'W')) ||
      (ctrl && shift && (input.key === 'w' || input.key === 'W')) ||
      (ctrl && shift && ['i', 'I', 'j', 'J', 'c', 'C'].includes(input.key)) ||
      (ctrl && (input.key === 'p' || input.key === 'P')) ||
      input.key === 'F12' ||
      input.key === 'F11' ||
      input.key === 'F5';

    if (blockCombo) {
      event.preventDefault();
      // F5 dipakai kasir sebagai "Pending" — teruskan ulang ke halaman.
      if (input.key === 'F5') win.webContents.send('desktop:replay-key', 'F5');
    }
  });

  win.on('closed', () => { win = null; });
}

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------
function createTray() {
  try {
    const img = nativeImage.createFromPath(path.join(ASSETS_DIR, 'tray.png'));
    tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  } catch {
    return;
  }
  const menu = Menu.buildFromTemplate([
    { label: 'Buka KasirPro POS', click: () => { if (win) { win.show(); win.focus(); } } },
    { type: 'separator' },
    { label: 'Ganti Serial (Owner)', click: () => openOwner() },
    { label: 'Muat Ulang Aplikasi', click: () => { void loadAppSafe(); } },
    {
      label: 'Database Lokal (offline)',
      type: 'checkbox',
      checked: dbEnabled(),
      click: (item) => toggleLocalDb(item.checked),
    },
    { type: 'separator' },
    { label: 'Versi ' + app.getVersion(), enabled: false },
    { label: 'Keluar', click: () => { app.isQuiting = true; app.quit(); } },
  ]);
  tray.setToolTip('KasirPro POS');
  tray.setContextMenu(menu);
  tray.on('double-click', () => { if (win) { win.show(); win.focus(); } });
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
function registerIpc() {
  ipcMain.handle('desktop:version', () => app.getVersion());

  // ---------------------- database lokal (offline-first) ---------------------
  // Renderer memakai shim `src/lib/supabase/local.ts` → diteruskan ke sini.
  ipcMain.on('desktop:local-db', (event) => {
    event.returnValue = dbEnabled();
  });
  ipcMain.handle('desktop:auth-session', () => ({ ok: true, session: store.get('authSession') || null }));

  ipcMain.handle('desktop:db', (_e, op) => {
    initDb();
    if (!db) return { ok: false, error: 'Database lokal tidak aktif.' };
    try {
      const out = db.handle(op) || {};
      return { ok: true, data: out.data !== undefined ? out.data : null, count: out.count };
    } catch (err) {
      return { ok: false, error: (err && err.message) || 'Operasi database lokal gagal.' };
    }
  });

  ipcMain.handle('desktop:db-user', (_e, id) => {
    initDb();
    if (!db) return { ok: false, userId: null };
    if (id != null && String(id)) db.setUserId(String(id));
    return { ok: true, userId: db.getUserId() };
  });

  ipcMain.handle('desktop:db-stats', () => (db ? { ok: true, data: db.stats() } : { ok: false }));

  ipcMain.handle('desktop:db-outbox', () => (db ? { ok: true, data: db.outbox.pending() } : { ok: false, data: [] }));

  ipcMain.handle('desktop:db-outbox-done', (_e, e) => {
    if (db && e && e.tbl && e.rowId) db.outbox.mark(e.tbl, e.rowId, e.op);
    return { ok: true };
  });

  ipcMain.handle('desktop:db-sync-row', (_e, e) => {
    if (!db || !e || !e.tbl || e.rowId == null) return { ok: false, data: null };
    return { ok: true, data: db.getRowForSync(e.tbl, String(e.rowId), db.getUserId()) };
  });

  ipcMain.handle('desktop:submit-serial', async (_e, raw) => {
    const serial = String(raw || '').trim().toUpperCase();
    if (serial.length < 3) return { ok: false, message: 'Serial Key minimal 3 karakter.' };
    const res = await login(serial);
    if (res.ok) {
      store.set('serialKey', serial);
      await loadApp();
      return { ok: true };
    }
    if (res.offline) return { ok: false, offline: true, message: res.message };
    return { ok: false, message: res.message || 'Login gagal. Coba lagi.' };
  });

  ipcMain.handle('desktop:owner', async (_e, payload) => {
    const action = payload && payload.action;
    const pw = String((payload && payload.password) || '');

    if (action === 'set') {
      if (pw.length < 4) return { ok: false, message: 'Password owner minimal 4 karakter.' };
      store.set('ownerPassword', pw);
      await showSetup({ mode: 'ganti' });
      return { ok: true };
    }
    if (action === 'verify') {
      const saved = String(store.get('ownerPassword') || '');
      if (!pw || pw !== saved) return { ok: false, message: 'Password owner salah.' };
      await showSetup({ mode: 'ganti' });
      return { ok: true };
    }
    return { ok: false, message: 'Aksi tidak dikenal.' };
  });

  ipcMain.handle('desktop:retry', async () => {
    const ok = await reachable();
    if (ok) {
      stopOfflineTimer();
      void boot();
    }
    return { ok };
  });

  ipcMain.handle('desktop:print', async () => {
    const wc = win.webContents;
    let printerName = String(store.get('printerName') || '').trim();
    let size = String(store.get('pageSize') || '80mm');

    // Sinkron dengan preferensi printer di Pengaturan aplikasi web.
    try {
      const cfg = await wc.executeJavaScript(
        "(function(){try{return JSON.parse(localStorage.getItem('printer_settings')||'{}')}catch(e){return {}}})()",
        true,
      );
      if (cfg && typeof cfg === 'object') {
        if (cfg.nama && cfg.nama !== 'System Printer') printerName = String(cfg.nama);
        if (cfg.ukuran) size = String(cfg.ukuran);
      }
    } catch { /* pakai nilai tersimpan */ }

    const deviceName = printerName && printerName !== 'System Printer' ? printerName : undefined;

    let pageSize;
    try {
      const h = await wc.executeJavaScript(
        "Math.ceil((document.querySelector('.receipt')||document.body).getBoundingClientRect().height)",
        true,
      );
      const width = size === '58mm' ? 58000 : size === '80mm' ? 80000 : undefined;
      if (width) {
        const microns = Math.max(60000, Math.round((Number(h) || 200) * 264.583) + 6000);
        pageSize = { width, height: microns };
      }
    } catch { /* pakai ukuran default printer */ }

    const options = {
      silent: true,
      printBackground: true,
      deviceName,
      margins: { marginType: 'none' },
      scaleFactor: 100,
    };
    if (pageSize) options.pageSize = pageSize;

    return new Promise((resolve) => {
      wc.print(options, (success) => {
        if (success) return resolve({ ok: true });
        // Fallback: dialog print bawaan bila silent print gagal.
        wc.print({ silent: false, printBackground: true }, (ok2) => resolve({ ok: !!ok2 }));
      });
    });
  });

  // Daftar printer yang terpasang di sistem (Windows) — dipakai dialog
  // Pengaturan > Printer di aplikasi web supaya bisa memilih tanpa ketik manual.
  ipcMain.handle('desktop:list-printers', async () => {
    try {
      const rows = await win.webContents.getPrintersAsync();
      const data = (rows || []).map((p) => ({
        name: p.name,
        displayName: p.displayName || p.name,
        isDefault: !!p.isDefault,
        status: p.status,
      }));
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err), data: [] };
    }
  });

  ipcMain.on('desktop:store-name', (_e, name) => {
    const nama = String(name || '').trim();
    if (!nama) return;
    store.set('storeName', name);
    if (win) win.setTitle(`KasirPro POS - ${name}`);
  });

  ipcMain.on('desktop:offline', () => { void showOffline(); });
  ipcMain.on('desktop:online', () => { void boot(); });
  ipcMain.on('desktop:open-owner', () => openOwner());
  ipcMain.handle('desktop:quit', () => { app.isQuiting = true; app.quit(); });
}

// ---------------------------------------------------------------------------
// Auto-update (sederhana, dari GitHub release)
// ---------------------------------------------------------------------------
function setupAutoUpdate() {
  if (isDev || !app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-downloaded', async (info) => {
    try {
      const { response } = await dialog.showMessageBox(win, {
        type: 'info',
        buttons: ['Restart sekarang', 'Nanti'],
        defaultId: 0,
        cancelId: 1,
        title: 'Pembaruan tersedia',
        message: `KasirPro POS ${info.version} siap dipasang.`,
        detail: 'Aplikasi akan dimulai ulang untuk memasang pembaruan.',
      });
      if (response === 0) {
        app.isQuiting = true;
        autoUpdater.quitAndInstall();
      }
    } catch { /* abaikan */ }
  });

  const check = () => autoUpdater.checkForUpdates().catch(() => { /* offline/di-skip */ });
  setTimeout(check, 15000);
  setInterval(check, 6 * 60 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
if (gotLock) {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    ses = session.fromPartition(PARTITION);
    Menu.setApplicationMenu(null);
    deviceId();
    initDb();
    try { if (db && store.get('localUserId')) db.setUserId(String(store.get('localUserId'))); } catch (e) {}
    createWindow();
    createTray();
    registerIpc();
    setupAutoUpdate();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('before-quit', () => { closeDb(); closeLocalServer(); });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
