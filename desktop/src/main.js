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

const { app, BrowserWindow, session, Menu, Tray, ipcMain, shell, dialog, nativeImage, net, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { randomUUID } = require('crypto');
const Store = require('electron-store');
const { autoUpdater } = require('electron-updater');
const { createEngine } = require('./db/engine.cjs');
const { startLocalServer } = require('./localServer.cjs');
const { createSecrets } = require('./secrets.cjs');

const DEFAULT_SERVER = process.env.KASIRPRO_SERVER_URL || 'https://pos-amd-desktop.vercel.app';
// Sesi Chromium IN-MEMORY (tanpa awalan `persist:`). Login memakai cookie
// Supabase; partisi lama `persist:kasirpro` menuliskannya sebagai plaintext ke
// `%APPDATA%\KasirPro POS\Partitions\kasirpro\Cookies` — satu kelas dengan
// temuan F-005. Aplikasi memakai sesi login tersimpan (`authSession` di
// secrets.json) untuk mengakses Supabase dari renderer, jadi cookie tidak perlu
// bertahan di disk. Folder lama dibersihkan sekali oleh
// `purgeLegacyPersistedSession()` (lihat SECURITY_VERSION).
const PARTITION = 'kasirpro';
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
    storeName: 'Toko',
    serverUrl: DEFAULT_SERVER,
    printerName: '',
    pageSize: '80mm',
    deviceName: '',
    deviceId: '',
    localDb: true,
    // True hanya bila pemilik sengaja mengubah mode lokal lewat menu tray.
    // Dipakai supaya mode lokal (SQLite) tetap menyala secara default.
    localDbExplicit: false,
    localUserId: '',
    lastLicenseCheck: '',
    // Versi skema keamanan config (lihat migrateSecrets). Dinaikkan bila perlu
    // memaksa tindakan sekali, mis. membersihkan token lama yang terpapar.
    securityVersion: 0,
  },
});

/**
 * Store terpisah KHUSUS nilai sensitif (token sesi, serial, password owner).
 * Nilainya dienkripsi via safeStorage (lihat secrets.cjs). Dipisah dari
 * `config.json` supaya file config tidak pernah memuat materi kredensial
 * (temuan audit F-005 / rekomendasi P1: pisahkan secrets dari config).
 */
const secretStore = new Store({ name: 'secrets' });

if (wantReset) {
  store.clear();
  try { secretStore.clear(); } catch { /* abaikan */ }
  store.set('deviceId', randomUUID());
}

// Mode offline-first (SQLite) menyala otomatis begitu bundel aplikasi lokal
// ikut terpasang. Tanpa ini, data barang/transaksi tersimpan di server — atau,
// bila server tak terjangkau, hanya menumpang di penyimpanan kecil browser.
//
// CATATAN: `store.has()` TIDAK bisa dipakai di sini karena electron-store
// menulis semua nilai `defaults` ke file config saat pertama dibuat, sehingga
// `has('localDb')` selalu bernilai true. Akibatnya pengecekan lama
// (`!store.has('localDb')`) tidak pernah jalan dan mode lokal tidak pernah
// menyala — inilah penyebab data tidak tersimpan ke file SQLite.
//
// Pilihan pemilik yang sengaja mematikan mode lokal lewat tray ditandai
// `localDbExplicit=true` dan tetap dihormati.
try {
  if (localAppAvailable() && store.get('localDbExplicit') !== true) {
    store.set('localDb', true);
  }
} catch { /* abaikan */ }

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
// Penyimpanan rahasia (token sesi, serial key, password owner)
// ---------------------------------------------------------------------------
// Rahasia disimpan TERPISAH dari `config.json` (di `secrets.json`) dan
// dienkripsi at-rest memakai `safeStorage` (Windows DPAPI / macOS Keychain /
// libsecret Linux), supaya refresh_token/access_token/serial key/password
// tidak bocor sebagai plaintext (temuan audit F-001..F-005). Nilai lama yang
// masih plaintext di `config.json` dipindahkan otomatis saat start.
// Logika enkripsi ada di `./secrets.cjs` agar bisa diuji terpisah.
// Naikkan SECURITY_VERSION bila perlu memaksa tindakan sekali (mis. buang
// token lama yang mungkin sudah terpapar).
//   1 -> buang `authSession` lama (login ulang ambil token baru).
//   2 -> + hapus sesi Chromium lama yang tersimpan plaintext di disk.
const SECURITY_VERSION = 2;

const secrets = createSecrets({ store: secretStore, safeStorage });
const getSecret = (key) => secrets.get(key);
const setSecret = (key, value) => secrets.set(key, value);

/**
 * Hapus sesi Chromium lama yang tersimpan plaintext di disk
 * (`%APPDATA%\KasirPro POS\Partitions\kasirpro`) dari skema partisi
 * `persist:kasirpro`. Dipanggil sekali saat migrasi keamanan; partisi sekarang
 * in-memory sehingga cookie/token tidak lagi ditulis ke disk.
 */
function purgeLegacyPersistedSession() {
  const dir = path.join(app.getPath('userData'), 'Partitions', 'kasirpro');
  try {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      console.log('[security] sesi Chromium lama (cookie plaintext) dihapus dari disk.');
    }
  } catch (err) {
    console.warn('[security] gagal menghapus sesi Chromium lama:', err && err.message);
  }
}

/**
 * Amankan kredensial: (1) pindahkan rahasia lama dari `config.json` ke
 * `secrets.json`, (2) enkripsi nilai yang masih plaintext, lalu (3) sekali per
 * skema keamanan buang token sesi lama agar login berikutnya mengambil token
 * baru (rekomendasi audit: logout + login ulang). Serial & localUserId
 * dipertahankan supaya aplikasi tetap jalan offline.
 */
function migrateSecrets() {
  const moved = secrets.relocateFrom(store);
  const upgraded = secrets.upgradeLegacy();

  try {
    const cur = Number(store.get('securityVersion') || 0);
    if (cur < SECURITY_VERSION) {
      setSecret('authSession', null);
      purgeLegacyPersistedSession();
      store.set('securityVersion', SECURITY_VERSION);
      console.log('[security] token sesi lama dibersihkan — login ulang mengambil token baru.');
    }
  } catch { /* abaikan */ }

  if (moved > 0) {
    console.log(`[security] ${moved} kredensial dipindahkan dari config.json ke secrets.json (terenkripsi).`);
  }
  if (upgraded > 0) console.log(`[security] ${upgraded} nilai sensitif dienkripsi (at-rest).`);
  if (!secrets.encryptionAvailable()) {
    console.warn('[security] enkripsi OS (safeStorage) tidak tersedia — rahasia disimpan tanpa enkripsi.');
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
// Matikan akselerasi perangkat keras. Pada sebagian PC Windows (driver GPU
// lama, Remote Desktop, VM) proses GPU gagal inisialisasi sehingga jendela
// bisa tampil kosong/blank. Aplikasi POS tidak butuh GPU — mode software
// (SwiftShader) jauh lebih andal.
app.disableHardwareAcceleration();

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
let loadingApp = false;
let db = null;
/** Penghitung percobaan boot yang gagal — supaya aplikasi tidak macet/loop. */
let bootAttempts = 0;

// ---------------------------------------------------------------------------
// Database lokal (SQLite) — mode offline-first (lihat desktop/OFFLINE.md)
// ---------------------------------------------------------------------------
function dbEnabled() {
  return !!store.get('localDb');
}

/**
 * Lokasi file database SQLite lokal.
 *
 * Fungsi ini satu-satunya sumber kebenaran lokasi file DB. Dipanggil dari
 * `logDatabasePath()` saat start sehingga pemilik bisa memverifikasi keberadaan
 * file `kasir.db` di komputernya.
 */
function getDatabasePath() {
  return path.join(app.getPath('userData'), 'kasir.db');
}

/** `dbPath` lama (nama file sebelum migrasi) — dipakai sekali untuk memindahkan data. */
function legacyDatabasePath() {
  return path.join(app.getPath('userData'), 'kasirpro.db');
}

/**
 * Pindahkan database lama `kasirpro.db` ke `kasir.db` bila file baru belum ada.
 * Data toko yang sudah tersimpan tidak hilang saat aplikasi diperbarui.
 */
function migrateLegacyDatabase() {
  try {
    const baru = getDatabasePath();
    const lama = legacyDatabasePath();
    if (!fs.existsSync(baru) && fs.existsSync(lama)) {
      fs.copyFileSync(lama, baru);
      console.log('[db] memindahkan database lama ke:', baru);
    }
  } catch (err) {
    console.error('[db] gagal memindahkan database lama:', err.message);
  }
}

/** Catat lokasi file database ke log supaya bisa diverifikasi user. */
function logDatabasePath() {
  const p = getDatabasePath();
  const ada = fs.existsSync(p);
  console.log(
    '[db] lokasi file database:',
    p,
    ada ? '(file ada)' : '(belum dibuat — akan dibuat saat mode lokal aktif)',
  );
}

/** Buka database lokal bila mode lokal aktif. Aman dipanggil berkali-kali. */
function initDb() {
  if (db || !dbEnabled()) return;
  try {
    migrateLegacyDatabase();
    db = createEngine(getDatabasePath());
    console.log('[db] database lokal siap:', getDatabasePath());
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

/** Masa tenggang lisensi saat offline (hari) sejak verifikasi online terakhir. */
const OFFLINE_GRACE_DAYS = 45;

/**
 * Boleh mulai tanpa internet? Perlu: mode lokal aktif, sudah pernah aktivasi
 * (ada user tersimpan), dan masih dalam masa tenggang sejak verifikasi terakhir.
 */
function offlineStartAllowed() {
  if (!offlineMode()) return false;
  if (!String(store.get('localUserId') || '').trim()) return false;
  const last = String(store.get('lastLicenseCheck') || '').trim();
  if (!last) return true; // instalasi lama: belum ada cap waktu — izinkan.
  const t = Date.parse(last);
  if (!Number.isFinite(t)) return true;
  return Date.now() - t <= OFFLINE_GRACE_DAYS * 24 * 60 * 60 * 1000;
}

/** Sisa hari masa tenggang offline (untuk pesan ke kasir). */
function offlineGraceDaysLeft() {
  const last = String(store.get('lastLicenseCheck') || '').trim();
  const t = Date.parse(last);
  if (!last || !Number.isFinite(t)) return OFFLINE_GRACE_DAYS;
  const left = OFFLINE_GRACE_DAYS - Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000));
  return Math.max(0, left);
}

/** Alasan halaman offline ditampilkan: 'grace' (masa verifikasi habis) atau 'noconn'. */
function offlinePageReason() {
  const hasUser = !!String(store.get('localUserId') || '').trim();
  if (hasUser && offlineMode() && !offlineStartAllowed()) return 'grace';
  return 'noconn';
}

/** Nyalakan/matikan mode database lokal lalu muat ulang aplikasi. */
function toggleLocalDb(on) {
  store.set('localDb', !!on);
  // Tandai bahwa pemilik sengaja memilih → hormati pilihan ini saat start.
  store.set('localDbExplicit', true);
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
// Login: verifikasi serial + ambil token sesi.
// Jalur cepat  : POST /api/auth/login langsung dari proses utama (TIDAK memuat
//                halaman /login sama sekali → jauh lebih cepat).
// Jalur cadangan: cara lama (muat halaman /login di jendela tersembunyi) bila
//                jawaban jalur cepat tidak bisa dipastikan, mis. server
//                menuntut cookie yang hanya dibuat oleh halaman /login.
// ---------------------------------------------------------------------------

/** Terapkan efek samping login sukses: cap waktu, user, token, dan DB. */
function applyLoginSuccess(j) {
  try { store.set('lastLicenseCheck', new Date().toISOString()); } catch { /* abaikan */ }
  try { if (j && j.user_id) store.set('localUserId', String(j.user_id)); } catch { /* abaikan */ }
  try { if (j && j.session) setSecret('authSession', j.session); } catch { /* abaikan */ }
  try { initDb(); if (db && j && j.user_id) db.setUserId(String(j.user_id)); } catch { /* abaikan */ }
}

/**
 * Jalur cepat: POST /api/auth/login dari proses utama. Cookie dari respons
 * tetap disimpan Chromium ke sesi in-memory (lewat opsi `session`).
 * Hasil: { ok:true, json } | { ok:false, message } | { ok:false, offline:true }
 *        | { ambiguous:true } → jawaban bukan JSON, pakai jalur cadangan.
 */
function loginDirect(server, body, guardMs) {
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const done = (res) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(res);
    };
    let req;
    try {
      req = net.request({ method: 'POST', url: `${server}/api/auth/login`, session: ses });
    } catch {
      done({ ok: false, offline: true, message: 'Tidak bisa menghubungi server.' });
      return;
    }
    timer = setTimeout(() => {
      try { req.abort(); } catch { /* abaikan */ }
      done({ ok: false, offline: true, message: 'Server tidak merespons.' });
    }, guardMs);
    try {
      req.setHeader('Content-Type', 'application/json');
      req.setHeader('Accept', 'application/json');
      req.setHeader('X-KasirPro-Desktop', '1');
    } catch { /* abaikan */ }
    req.on('response', (res) => {
      const chunks = [];
      res.on('data', (c) => { chunks.push(Buffer.from(c)); });
      res.on('end', () => {
        let j = null;
        try { j = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* bukan JSON */ }
        if (!j || typeof j !== 'object') { done({ ambiguous: true, status: res.statusCode }); return; }
        if (res.statusCode >= 200 && res.statusCode < 300 && j.ok) { done({ ok: true, json: j }); return; }
        done({ ok: false, status: res.statusCode, message: j.message || `Login gagal (HTTP ${res.statusCode}).` });
      });
      res.on('error', () => done({ ok: false, offline: true, message: 'Tidak bisa menghubungi server.' }));
    });
    req.on('error', () => done({ ok: false, offline: true, message: 'Tidak bisa menghubungi server.' }));
    req.write(body);
    req.end();
  });
}

/** Jalur cadangan: muat /login di jendela tersembunyi lalu panggil API dari sana. */
function loginViaPage(server, body, guardMs) {
  return new Promise((resolve) => {
    const loginUrl = `${server}/login`;
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
    const guard = setTimeout(() => finish({ ok: false, offline: true, message: 'Server tidak merespons.' }), guardMs);

    hidden.webContents.on('did-finish-load', async () => {
      try {
        const result = await hidden.webContents.executeJavaScript(
          `(async () => {
             try {
               const r = await fetch('/api/auth/login', {
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-KasirPro-Desktop': '1' },
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
          finish({ ok: true, json: result.json || {} });
        } else if (result && result.status === 0) {
          finish({ ok: false, offline: true, message: 'Tidak bisa menghubungi server.' });
        } else {
          finish({ ok: false, status: (result && result.status) || 0, message: (result && result.json && result.json.message) || `Login gagal (HTTP ${result && result.status}).` });
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

/** Verifikasi serial: coba jalur cepat, jatuh ke jalur cadangan bila perlu. */
async function login(serial, opts = {}) {
  const server = serverUrl();
  const guardMs = Number(opts.timeout) > 0 ? Number(opts.timeout) : 25000;
  const body = JSON.stringify({
    serial_key: serial,
    device_id: deviceId(),
    device_name: (os.hostname() || 'Perangkat Kasir').slice(0, 120),
    app_version: app.getVersion(),
    next: '/kasir',
  });

  let res = await loginDirect(server, body, guardMs);
  if (res && res.ambiguous) {
    console.warn('[app] login cepat tidak dapat dipastikan — memakai halaman /login.');
    res = await loginViaPage(server, body, guardMs);
  }
  if (res && res.ok) {
    applyLoginSuccess(res.json);
    return { ok: true };
  }
  return res || { ok: false, message: 'Login gagal.' };
}

/**
 * True bila server MENOLAK serial secara pasti (serial salah/hangus/dipindah ke
 * perangkat lain). Bedakan dari masalah sementara (jaringan mati, HTTP 5xx, 429)
 * supaya serial yang masih sah tidak ikut dibuang hanya karena server sibuk.
 */
function licenseRejected(res) {
  return !!res && !res.ok && !res.offline && (res.status === 401 || res.status === 403);
}

/**
 * Buka aplikasi LANGSUNG memakai status login yang tersimpan, lalu verifikasi
 * lisensi ke server di LATAR BELAKANG (tidak memblokir tampilnya aplikasi).
 *
 * Ini yang membuat "masukkan serial sekali, buka lagi tidak perlu login" jadi
 * nyata: kasir tidak menunggu pemeriksaan lisensi online saat membuka aplikasi.
 * Verifikasi tetap berjalan — bila server menolak serial, barulah minta input
 * ulang; bila hanya offline, aplikasi tetap jalan dalam masa tenggang.
 */
let verifyInFlight = false;
function startCachedThenVerify(serial) {
  if (!verifyInFlight) {
    verifyInFlight = true;
    login(serial, { timeout: 8000 })
      .then((res) => {
        if (res && res.ok) {
          console.log('[app] lisensi terverifikasi (latar belakang).');
          // Sesi baru sudah tersimpan — dorong sinkronisasi yang tertunda.
          sendCommand('sync-now');
          return;
        }
        if (licenseRejected(res)) {
          console.warn('[app] lisensi ditolak server:', res && res.message);
          setSecret('serialKey', '');
          return showSetup({ mode: 'first', error: (res && res.message) || 'Serial Key tidak valid. Masukkan kembali.' });
        }
        console.log('[app] verifikasi lisensi tertunda (offline/server sibuk) — memakai masa tenggang.');
      })
      .catch(() => { /* abaikan: verifikasi latar belakang tidak boleh mengganggu */ })
      .finally(() => { verifyInFlight = false; });
  }
  return loadApp();
}

/**
 * Panaskan tumpukan jaringan Electron (mulai Chromium network service +
 * negosiasi DNS/TLS) SEBELUM kasir menekan tombol login.
 *
 * Tanpa ini, permintaan jaringan PERTAMA aplikasi — yaitu verifikasi lisensi —
 * memikul seluruh biaya inisialisasi (biasanya 1-3 detik), sehingga layar
 * "Memeriksa lisensi…" terasa sangat lama. Setelah hangat, login hanya
 * ~150-250 ms. Murni optimasi: kegagalannya diabaikan.
 */
let warmedServer = '';
function warmUpNetwork() {
  const server = serverUrl();
  if (warmedServer === server) return;
  warmedServer = server;
  try {
    const req = net.request({ method: 'GET', url: `${server}/login`, session: ses });
    req.on('response', (res) => { res.on('data', () => {}); res.on('end', () => {}); res.on('error', () => {}); });
    req.on('error', () => { /* abaikan — hanya pemanasan */ });
    req.end();
  } catch { /* abaikan — hanya pemanasan */ }
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

async function showOffline(reason) {
  const query = {};
  if (reason === 'grace') query.reason = 'grace';
  else if (reason === 'noconn') query.reason = 'noconn';
  if (reason) query.days = String(offlineGraceDaysLeft());
  await showPage('offline.html', Object.keys(query).length ? query : undefined);
  stopOfflineTimer();
  offlineTimer = setInterval(async () => {
    if (await reachable()) {
      stopOfflineTimer();
      void boot();
    }
  }, 5000);
}

async function showSetup(opts = {}) {
  // Panaskan jaringan selagi kasir membaca/mengetik serial, supaya tombol
  // "Aktifkan & Masuk" tidak menunggu inisialisasi jaringan.
  warmUpNetwork();
  const query = {};
  if (opts.mode) query.mode = opts.mode;
  if (opts.error) query.error = opts.error;
  await showPage('setup.html', query);
}

// Skrip pemeriksa: apakah halaman benar-benar menampilkan konten?
// Dipakai untuk mendeteksi "layar blank" (halaman termuat HTTP 200 tapi kosong)
// lalu otomatis jatuh ke server remote — bug yang dulu membuat mode offline
// ditinggalkan.
const RENDER_CHECK = `(() => {
  try {
    const root = document.getElementById('__next');
    const text = ((document.body && document.body.innerText) || '').trim();
    const nodes = root ? root.childElementCount : (document.body ? document.body.childElementCount : 0);
    return nodes > 0 && (text.length > 20 || !!document.querySelector('canvas, svg, img, input, button'));
  } catch (e) { return false; }
})()`;

async function pageRendered() {
  try {
    return !!(await win.webContents.executeJavaScript(RENDER_CHECK, true));
  } catch {
    return false;
  }
}

/** Muat URL lalu pastikan halaman menampilkan konten. `false` = kosong/gagal. */
async function loadAndVerify(url) {
  const started = Date.now();
  try {
    await win.loadURL(url);
  } catch {
    return false;
  }
  const base = url.replace(/\/+$/, '');
  let rendered = false;
  // Periksa beberapa kali pada waktu tertentu (ms sejak load). Keberhasilan
  // diterima mulai 800 ms (cukup untuk hidrasi awal) supaya aplikasi tampil
  // lebih cepat, namun halaman yang gagal/hidrasi rusak tetap jatuh ke server.
  for (const at of [400, 800, 1500, 3000, 5000, 8000]) {
    const wait = at - (Date.now() - started);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (!win || win.isDestroyed()) return false;
    const now = String(win.webContents.getURL() || '');
    // Dialihkan ke halaman lain (mis. /login) berarti aplikasi hidup.
    if (now && !now.startsWith(base) && !now.startsWith('http://127.0.0.1:')) return true;
    rendered = await pageRendered();
    if (rendered && at >= 800) return true;
  }
  return rendered;
}

async function loadApp() {
  loadingApp = true;
  try {
    win.show();
    win.focus();

    // 1) Coba aplikasi lokal (bundel offline di dalam installer).
    if (offlineMode()) {
      const origin = await ensureLocalServer();
      if (origin) {
        const ok = await loadAndVerify(`${origin}/kasir/`);
        if (ok) {
          console.log('[app] memakai aplikasi lokal (offline-first).');
          sendCommand('sync-now');
          return;
        }
        console.warn('[app] aplikasi lokal tidak menampilkan konten — beralih ke server.');
      }
    }

    // 2) Aplikasi dari server (butuh internet).
    try {
      await win.loadURL(`${serverUrl()}/kasir`);
    } catch (err) {
      console.error('[app] gagal memuat URL:', err && err.message);
      try {
        await win.loadURL(`${serverUrl()}/kasir`);
      } catch { /* biarkan did-fail-load menangani */ }
    }
  } finally {
    loadingApp = false;
  }
}

async function boot() {
  if (booting) return;
  booting = true;
  try {
    stopOfflineTimer();
    const serial = String(getSecret('serialKey') || '').trim();
    if (!serial) {
      await showSetup({ mode: 'first' });
      return;
    }

    // Sudah pernah aktivasi & data lokal tersedia → tampilkan aplikasi SEKARANG,
    // tanpa menunggu pemeriksaan lisensi online (verifikasi jalan di latar
    // belakang). Inilah yang membuat buka-ulang tidak perlu login lagi.
    const cached = offlineStartAllowed();
    if (cached) {
      await startCachedThenVerify(serial);
      bootAttempts = 0;
      return;
    }

    // Belum pernah aktivasi (atau masa tenggang habis) → verifikasi dulu.
    // createWindow() sudah memuat loading.html untuk memicu `ready-to-show`.
    // Memuatnya ulang di sini kadang memicu ERR_ABORTED (-3) karena navigasi
    // sebelumnya belum selesai; tanpa `.catch` reaksi itu batal dan aplikasi
    // macet di layar "Memuat aplikasi kasir…". Abaikan — layar sudah termuat.
    await showPage('loading.html').catch(() => {});
    // Hangatkan server aplikasi lokal BERSAMAAN dengan cek login, bukan
    // sesudahnya, supaya aplikasi tampil lebih cepat. `loadApp()` nanti memakai
    // origin yang sudah siap ini (ensureLocalServer meng-cache hasilnya).
    const warm = Promise.resolve()
      .then(() => (offlineMode() ? ensureLocalServer() : ''))
      .catch(() => '');
    const res = await login(serial, { timeout: 25000 });
    await warm;

    if (res.ok) {
      await loadApp();
      bootAttempts = 0;
      return;
    }
    if (res.offline) {
      if (offlineStartAllowed()) {
        console.log('[app] offline: memakai aplikasi + data lokal.');
        await loadApp();
        bootAttempts = 0;
        return;
      }
      await showOffline(offlinePageReason());
      bootAttempts = 0;
      return;
    }
    // Serial salah / hangus — buang lalu minta input ulang. Masalah sementara
    // (5xx/jaringan) tidak membuang serial supaya tidak perlu input ulang.
    if (licenseRejected(res)) setSecret('serialKey', '');
    await showSetup({ mode: 'first', error: res.message || 'Serial Key tidak valid. Masukkan kembali.' });
    bootAttempts = 0;
  } catch (err) {
    // Jangan pernah biarkan aplikasi macet di layar pemuatan (tanpa akun, tanpa
    // pesan). Catat lalu coba lagi beberapa kali; bila tetap gagal, tunjukkan
    // halaman offline yang punya tombol coba-lagi sendiri.
    console.error('[app] boot gagal:', err && err.message);
    bootAttempts += 1;
    if (bootAttempts <= 3) {
      setTimeout(() => { void boot(); }, 2000);
    } else {
      await showOffline(offlinePageReason()).catch(() => {});
    }
  } finally {
    booting = false;
  }
}

/** Muat ulang ke aplikasi (dipakai setelah ganti serial / retry). */
async function loadAppSafe() {
  const serial = String(getSecret('serialKey') || '').trim();
  if (!serial) {
    await showSetup({ mode: 'first' });
    return;
  }
  const cached = offlineStartAllowed();
  if (cached) {
    await startCachedThenVerify(serial);
    return;
  }
  await showPage('loading.html');
  const res = await login(serial, { timeout: 25000 });
  if (res.ok) {
    await loadApp();
  } else if (res.offline && offlineStartAllowed()) {
    await loadApp();
  } else if (res.offline) {
    await showOffline(offlinePageReason());
  } else {
    if (licenseRejected(res)) setSecret('serialKey', '');
    await showSetup({ mode: 'first', error: res.message });
  }
}

// ---------------------------------------------------------------------------
// Ganti serial (owner)
// ---------------------------------------------------------------------------
function openOwner() {
  const has = !!String(getSecret('ownerPassword') || '');
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

  // PENTING: muat halaman awal SEBELUM mengandalkan `ready-to-show`. Bila tidak
  // ada halaman yang dimuat, `ready-to-show` tidak pernah terpicu saat GPU
  // gagal inisialisasi → jendela tidak tampil dan boot() tidak jalan (gejala
  // "layar blank"). Memuat loading.html memaksa render pertama.
  void win.loadFile(path.join(PAGES_DIR, 'loading.html')).catch(() => { /* jaring pengaman di bawah */ });

  let shownByReady = false;
  win.once('ready-to-show', () => {
    shownByReady = true;
    if (!win || win.isDestroyed()) return;
    win.show();
    void boot();
  });

  // Jaring pengaman: tetap tampilkan & jalankan aplikasi walau `ready-to-show`
  // tidak pernah muncul (mis. GPU bermasalah). boot() punya guard anti-ganda.
  setTimeout(() => {
    if (shownByReady || !win || win.isDestroyed()) return;
    console.warn('[window] ready-to-show tidak muncul — menampilkan paksa.');
    win.show();
    void boot();
  }, 4000);

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
    if (loadingApp) return; // loadApp() sedang menangani fallback-nya sendiri
    void showOffline(offlinePageReason());
  });

  // Pemulihan bila proses render bermasalah (crash/hang) → muat ulang halaman.
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer] proses berhenti:', details && details.reason);
    if (win && !win.isDestroyed()) {
      try { win.webContents.reload(); } catch { /* abaikan */ }
    }
  });
  win.on('unresponsive', () => {
    console.warn('[window] tidak merespons — memuat ulang.');
    if (win && !win.isDestroyed()) {
      try { win.webContents.reload(); } catch { /* abaikan */ }
    }
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
/** Status sinkron terakhir yang dilaporkan renderer (dipakai di menu tray). */
let lastSyncStatus = null;

function sendCommand(cmd) {
  try {
    if (win && !win.isDestroyed()) win.webContents.send('desktop:command', String(cmd));
  } catch { /* abaikan */ }
}

function currentIsLocalApp() {
  try {
    const url = String((win && win.webContents.getURL()) || '');
    return !!localOrigin && url.startsWith(localOrigin);
  } catch {
    return false;
  }
}

function syncStatusLabel() {
  const s = lastSyncStatus || {};
  const pending = Number(s.pending);
  if (Number.isFinite(pending)) {
    if (pending <= 0) return 'Sinkron: semua terkirim';
    return `Sinkron: ${pending} data menunggu`;
  }
  return 'Sinkron: menunggu data…';
}

function trayTemplate() {
  return [
    { label: 'Buka KasirPro POS', click: () => { if (win) { win.show(); win.focus(); } } },
    { type: 'separator' },
    { label: 'Sinkronkan Sekarang', click: () => sendCommand('sync-now') },
    { label: 'Ambil Data dari Server', click: () => sendCommand('pull-remote') },
    { label: syncStatusLabel(), enabled: false },
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
  ];
}

function refreshTray() {
  try {
    if (tray && !tray.isDestroyed()) tray.setContextMenu(Menu.buildFromTemplate(trayTemplate()));
  } catch { /* abaikan */ }
}

function createTray() {
  try {
    const img = nativeImage.createFromPath(path.join(ASSETS_DIR, 'tray.png'));
    tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  } catch {
    return;
  }
  const menu = Menu.buildFromTemplate(trayTemplate());
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
  ipcMain.handle('desktop:auth-session', () => ({ ok: true, session: getSecret('authSession') || null }));

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

  // ---------------------- sinkronisasi turun (tarik data) --------------------
  ipcMain.handle('desktop:db-import', (_e, payload) => {
    initDb();
    if (!db) return { ok: false, error: 'Database lokal tidak aktif.' };
    try {
      const tbl = payload && payload.tbl;
      const rows = (payload && payload.rows) || [];
      const n = db.importRows(tbl, rows, db.getUserId());
      return { ok: true, data: { imported: n } };
    } catch (err) {
      return { ok: false, error: (err && err.message) || 'Impor gagal.' };
    }
  });

  ipcMain.handle('desktop:db-mark-pull', () => {
    if (db) db.markInitialPull(db.getUserId());
    return { ok: true };
  });

  ipcMain.handle('desktop:db-pull-done', () => ({
    ok: true,
    done: db ? db.initialPullDone(db.getUserId()) : false,
  }));

  // --------------- penyimpanan draft lokal (keranjang & pending) -------------
  // Ditulis ke tabel `local_kv` di file SQLite yang sama (kasir.db), BUKAN
  // localStorage. Tersedia walau sesi user belum diinisialisasi.
  ipcMain.handle('desktop:kv-get', (_e, key) => {
    initDb();
    if (!db) return null;
    try {
      return db.kvGet(String(key || ''));
    } catch {
      return null;
    }
  });

  ipcMain.handle('desktop:kv-set', (_e, key, value) => {
    initDb();
    if (!db) return false;
    try {
      db.kvSet(String(key || ''), value == null ? null : String(value));
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('desktop:kv-del', (_e, key) => {
    initDb();
    if (!db) return false;
    try {
      db.kvDelete(String(key || ''));
      return true;
    } catch {
      return false;
    }
  });

  // ------------------------ kontrol jendela (title bar) ----------------------
  ipcMain.on('desktop:window-minimize', () => {
    if (win && !win.isDestroyed()) win.minimize();
  });

  ipcMain.on('desktop:window-maximize', () => {
    if (!win || win.isDestroyed()) return;
    // Jendela kasir berjalan fullscreen; tombol "Perbesar" mengalihkan
    // fullscreen <-> jendela (perilaku seperti maximize / restore).
    if (win.isFullScreen()) {
      win.setFullScreen(false);
      win.maximize();
    } else if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  });

  ipcMain.on('desktop:window-close', () => {
    if (win && !win.isDestroyed()) win.close();
  });

  ipcMain.on('desktop:sync-status', (_e, status) => {
    lastSyncStatus = status && typeof status === 'object' ? status : null;
    refreshTray();
  });

  ipcMain.handle('desktop:submit-serial', async (_e, raw) => {
    const serial = String(raw || '').trim().toUpperCase();
    if (serial.length < 3) return { ok: false, message: 'Serial Key minimal 3 karakter.' };
    const res = await login(serial);
    if (res.ok) {
      setSecret('serialKey', serial);
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
      setSecret('ownerPassword', pw);
      await showSetup({ mode: 'ganti' });
      return { ok: true };
    }
    if (action === 'verify') {
      const saved = String(getSecret('ownerPassword') || '');
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

  ipcMain.on('desktop:offline', () => {
    // Kalau aplikasi lokal sedang dipakai, internet mati bukan masalah —
    // biarkan kasir terus bekerja, jangan ganti ke halaman offline.
    if (offlineMode() && currentIsLocalApp()) {
      sendCommand('sync-now');
      return;
    }
    void showOffline(offlinePageReason());
  });
  ipcMain.on('desktop:online', () => {
    if (currentIsLocalApp()) {
      sendCommand('sync-now');
      return;
    }
    void boot();
  });
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
    // Panaskan jaringan lebih awal supaya login pertama tidak menunggu
    // inisialisasi jaringan (lihat warmUpNetwork).
    warmUpNetwork();
    // Amankan rahasia (token sesi, serial, password): pindah ke secrets.json +
    // enkripsi at-rest via safeStorage. Harus setelah app ready karena
    // safeStorage bergantung pada keyring/DPAPI OS.
    migrateSecrets();
    // Catat lokasi file database lebih dulu supaya pemilik bisa memverifikasi
    // keberadaan `kasir.db` di log aplikasi.
    logDatabasePath();
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
