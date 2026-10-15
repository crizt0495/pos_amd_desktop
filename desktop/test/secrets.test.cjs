'use strict';

/**
 * Uji penyimpanan rahasia (secrets.cjs): enkripsi at-rest, fallback tanpa
 * enkripsi OS, decode format lama (plaintext), dan migrasi otomatis.
 * Tanpa Electron — memakai `safeStorage` tiruan.
 *   node desktop/test/secrets.test.cjs
 */

const assert = require('assert');
const { createSecrets, SENSITIVE_KEYS } = require('../src/secrets.cjs');

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

/** electron-store tiruan sederhana (in-memory). */
function makeStore(initial = {}) {
  const data = { ...initial };
  return {
    get: (k) => data[k],
    set: (k, v) => { data[k] = v; },
    delete: (k) => { delete data[k]; },
    has: (k) => Object.prototype.hasOwnProperty.call(data, k),
    _data: data,
  };
}

/** safeStorage tiruan: "enkripsi" = base64 dengan prefix, dekripsi kebalikannya. */
function fakeSafeStorage(available = true) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (s) => Buffer.from('ENC:' + s, 'utf8'),
    decryptString: (buf) => {
      const s = Buffer.from(buf).toString('utf8');
      if (!s.startsWith('ENC:')) throw new Error('ciphertext rusak');
      return s.slice(4);
    },
  };
}

// ---------------------------------------------------------------------------
// 1) Enkripsi tersedia
// ---------------------------------------------------------------------------
{
  const store = makeStore();
  const sec = createSecrets({ store, safeStorage: fakeSafeStorage(true) });

  ok('set+get round-trip objek (authSession)', () => {
    const sess = { access_token: 'aaa.bbb.ccc', refresh_token: 'rt-contoh-0001' };
    sec.set('authSession', sess);
    assert.deepStrictEqual(sec.get('authSession'), sess);
  });

  ok('nilai tersimpan TIDAK plaintext di config', () => {
    const raw = store.get('authSession');
    assert.ok(raw && typeof raw === 'object' && typeof raw.$enc === 'string', 'harus dibungkus $enc');
    const teks = JSON.stringify(store._data);
    assert.ok(!teks.includes('rt-contoh-0001'), 'refresh_token tidak boleh terlihat plaintext');
    assert.ok(!teks.includes('aaa.bbb.ccc'), 'access_token tidak boleh terlihat plaintext');
  });

  ok('set+get string (serialKey)', () => {
    sec.set('serialKey', 'KPRO-TEST-0000-0000');
    assert.strictEqual(sec.get('serialKey'), 'KPRO-TEST-0000-0000');
    assert.ok(!JSON.stringify(store._data).includes('KPRO-TEST'), 'serial tidak boleh plaintext');
  });

  ok('nilai kosong disimpan apa adanya (tanpa $enc)', () => {
    sec.set('ownerPassword', '');
    assert.strictEqual(sec.get('ownerPassword'), '');
    assert.strictEqual(store.get('ownerPassword'), '');
    sec.set('authSession', null);
    assert.strictEqual(sec.get('authSession'), null);
    assert.strictEqual(store.get('authSession'), null);
  });

  ok('upgradeLegacy: plaintext lama -> terenkripsi', () => {
    const s2 = makeStore({ serialKey: 'KPRO-OLD-1234', authSession: { access_token: 'x', refresh_token: 'y' } });
    const sec2 = createSecrets({ store: s2, safeStorage: fakeSafeStorage(true) });
    const n = sec2.upgradeLegacy();
    assert.strictEqual(n, 2);
    assert.strictEqual(sec2.get('serialKey'), 'KPRO-OLD-1234');
    assert.strictEqual(sec2.get('authSession').access_token, 'x');
    const raw = s2.get('serialKey');
    assert.ok(raw && typeof raw.$enc === 'string');
    assert.ok(!JSON.stringify(s2._data).includes('KPRO-OLD-1234'));
    // idempoten: tidak ada lagi yang di-upgrade
    assert.strictEqual(sec2.upgradeLegacy(), 0);
  });

  ok('upgradeLegacy tidak menyentuh nilai kosong', () => {
    const s3 = makeStore({ serialKey: '', authSession: null, ownerPassword: '' });
    const sec3 = createSecrets({ store: s3, safeStorage: fakeSafeStorage(true) });
    assert.strictEqual(sec3.upgradeLegacy(), 0);
    assert.strictEqual(s3.get('serialKey'), '');
    assert.strictEqual(s3.get('authSession'), null);
  });
}

// ---------------------------------------------------------------------------
// 2) Enkripsi TIDAK tersedia (mis. Linux tanpa keyring)
// ---------------------------------------------------------------------------
{
  const store = makeStore();
  const sec = createSecrets({ store, safeStorage: fakeSafeStorage(false) });

  ok('fallback: ditandai $plain (bukan $enc)', () => {
    assert.strictEqual(sec.encryptionAvailable(), false);
    sec.set('serialKey', 'KPRO-PLAIN-9999');
    const raw = store.get('serialKey');
    assert.ok(raw && typeof raw.$plain === 'string');
    assert.strictEqual(sec.get('serialKey'), 'KPRO-PLAIN-9999');
  });

  ok('$plain di-upgrade saat enkripsi tersedia', () => {
    const hybrid = {
      isEncryptionAvailable: () => hybrid._on,
      encryptString: (s) => Buffer.from('ENC:' + s, 'utf8'),
      decryptString: (buf) => Buffer.from(buf).toString('utf8').slice(4),
    };
    hybrid._on = false;
    const s = makeStore();
    const a = createSecrets({ store: s, safeStorage: hybrid });
    a.set('serialKey', 'KPRO-UP-1'); // awalnya tanpa enkripsi
    assert.ok(s.get('serialKey').$plain);
    hybrid._on = true; // keyring muncul
    assert.strictEqual(a.upgradeLegacy(), 1);
    assert.ok(s.get('serialKey').$enc);
    assert.strictEqual(a.get('serialKey'), 'KPRO-UP-1');
  });

  ok('tanpa safeStorage (null) tetap aman/tidak error', () => {
    const sec2 = createSecrets({ store: makeStore(), safeStorage: null });
    assert.strictEqual(sec2.encryptionAvailable(), false);
    sec2.set('serialKey', 'X');
    assert.strictEqual(sec2.get('serialKey'), 'X');
  });
}

// ---------------------------------------------------------------------------
// 3) Ketahanan
// ---------------------------------------------------------------------------
{
  const store = makeStore();
  const sec = createSecrets({ store, safeStorage: fakeSafeStorage(true) });

  ok('ciphertext rusak -> null, tidak crash', () => {
    store.set('serialKey', { $enc: 'bukan-base64-valid!!' });
    assert.strictEqual(sec.get('serialKey'), null);
  });

  ok('SENSITIVE_KEYS default mencakup 3 kunci', () => {
    assert.deepStrictEqual(SENSITIVE_KEYS, ['authSession', 'serialKey', 'ownerPassword']);
    assert.deepStrictEqual(createSecrets({ store, safeStorage: fakeSafeStorage(true) }).sensitiveKeys, SENSITIVE_KEYS);
  });
}

// ---------------------------------------------------------------------------
// 4) Relokasi dari config.json lama -> secrets.json
// ---------------------------------------------------------------------------
{
  const ok_ss = fakeSafeStorage(true);

  ok('relocateFrom memindahkan & menghapus dari config', () => {
    const config = makeStore({
      serialKey: 'KPRO-RELOC-1',
      authSession: { access_token: 'at', refresh_token: 'rt' },
      ownerPassword: 'rahasia',
      storeName: 'Toko A', // non-sensitif: tidak boleh tersentuh
    });
    const sec = createSecrets({ store: makeStore(), safeStorage: ok_ss });
    const moved = sec.relocateFrom(config);
    assert.strictEqual(moved, 3);
    // sudah pindah ke store rahasia (terenkripsi)
    assert.strictEqual(sec.get('serialKey'), 'KPRO-RELOC-1');
    assert.strictEqual(sec.get('authSession').refresh_token, 'rt');
    assert.strictEqual(sec.get('ownerPassword'), 'rahasia');
    // config sudah bersih
    assert.ok(!config.has('serialKey'));
    assert.ok(!config.has('authSession'));
    assert.ok(!config.has('ownerPassword'));
    assert.strictEqual(config.get('storeName'), 'Toko A');
  });

  ok('relocateFrom tidak menyentuh nilai kosong & idempoten', () => {
    const config = makeStore({ serialKey: '', authSession: null, ownerPassword: '' });
    const sec = createSecrets({ store: makeStore(), safeStorage: ok_ss });
    assert.strictEqual(sec.relocateFrom(config), 0);
    assert.strictEqual(sec.relocateFrom(config), 0);
  });

  ok('relocateFrom aman saat sourceStore null', () => {
    const sec = createSecrets({ store: makeStore(), safeStorage: ok_ss });
    assert.strictEqual(sec.relocateFrom(null), 0);
  });
}

console.log('\n' + pass + ' pengujian lulus.');
