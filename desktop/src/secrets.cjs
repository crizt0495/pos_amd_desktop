'use strict';

/**
 * Penyimpanan nilai sensitif (token sesi, serial key, password owner) dengan
 * enkripsi at-rest memakai `safeStorage` (Windows DPAPI / macOS Keychain /
 * libsecret). Nilai lama yang masih plaintext di-upgrade otomatis.
 *
 * Modul ini sengaja TIDAK `require('electron')` supaya bisa diuji dengan
 * adapter `safeStorage` tiruan (lihat test/secrets.test.cjs).
 *
 * Format tersimpan (di dalam `secrets.json` / store rahasia):
 *   { "$enc": "<base64 ciphertext>" }   -> terenkripsi (aman)
 *   { "$plain": "<json>" }              -> plaintext karena enkripsi OS tak ada
 *   nilai langsung (format lama)        -> plaintext warisan, akan di-upgrade
 */

const SENSITIVE_KEYS = ['authSession', 'serialKey', 'ownerPassword'];

function createSecrets({ store, safeStorage, keys = SENSITIVE_KEYS } = {}) {
  if (!store) throw new Error('createSecrets: butuh `store`.');

  const sensitive = Array.isArray(keys) ? keys.slice() : SENSITIVE_KEYS.slice();

  function encryptionAvailable() {
    try {
      return !!safeStorage && safeStorage.isEncryptionAvailable() === true;
    } catch {
      return false;
    }
  }

  /** Bungkus nilai sensitif jadi payload siap simpan (terenkripsi bila bisa). */
  function pack(value) {
    let json;
    try {
      json = JSON.stringify(value ?? null);
    } catch {
      json = 'null';
    }
    if (encryptionAvailable()) {
      try {
        return { $enc: safeStorage.encryptString(json).toString('base64') };
      } catch {
        /* jatuh ke penanda plaintext di bawah */
      }
    }
    return { $plain: json };
  }

  /** Kembalikan nilai asli dari payload simpan (mendukung format lama). */
  function unpack(raw) {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      if (typeof raw.$enc === 'string') {
        try {
          return JSON.parse(safeStorage.decryptString(Buffer.from(raw.$enc, 'base64')));
        } catch {
          // Gagal dekripsi (mis. profil OS berubah) — anggap kosong, jangan crash.
          return null;
        }
      }
      if (typeof raw.$plain === 'string') {
        try {
          return JSON.parse(raw.$plain);
        } catch {
          return null;
        }
      }
    }
    // Format lama: nilai disimpan plaintext langsung.
    return raw === undefined ? null : raw;
  }

  function isPacked(raw) {
    return !!raw && typeof raw === 'object' && !Array.isArray(raw) &&
      (typeof raw.$enc === 'string' || typeof raw.$plain === 'string');
  }

  function get(key) {
    try {
      return unpack(store.get(key));
    } catch {
      return null;
    }
  }

  function set(key, value) {
    const emptyObject = !!value && typeof value === 'object' && !Array.isArray(value) &&
      Object.keys(value).length === 0;
    const empty = value == null || value === '' || emptyObject;
    try {
      if (empty) {
        store.set(key, typeof value === 'string' ? '' : null);
        return;
      }
      store.set(key, pack(value));
    } catch {
      /* abaikan */
    }
  }

  /**
   * Ubah nilai lama (plaintext langsung, atau `$plain` saat keyring belum ada)
   * menjadi terenkripsi. Mengembalikan jumlah nilai yang di-upgrade.
   */
  function upgradeLegacy() {
    let upgraded = 0;
    for (const key of sensitive) {
      let raw;
      try {
        raw = store.get(key);
      } catch {
        continue;
      }
      const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
      const packed = isPacked(raw);
      const isolatedEmpty = !!obj && !packed && Object.keys(obj).length === 0;
      const legacyNonEmpty = raw != null && raw !== '' && !packed && !isolatedEmpty;
      if (legacyNonEmpty) {
        set(key, unpack(raw));
        upgraded += 1;
      } else if (packed && typeof raw.$plain === 'string' && encryptionAvailable()) {
        // Sebelumnya plaintext karena keyring belum ada → coba upgrade.
        set(key, unpack(raw));
        upgraded += 1;
      }
    }
    return upgraded;
  }

  /**
   * Pindahkan nilai sensitif dari store lain (mis. `config.json` versi lama)
   * ke store ini, lalu hapus dari sumbernya. Mengembalikan jumlah nilai pindah.
   */
  function relocateFrom(sourceStore) {
    if (!sourceStore || typeof sourceStore.get !== 'function') return 0;
    let moved = 0;
    for (const key of sensitive) {
      let raw;
      try {
        raw = sourceStore.get(key);
      } catch {
        continue;
      }
      const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
      const empty = raw == null || raw === '' || (!!obj && Object.keys(obj).length === 0);
      if (!empty) {
        set(key, unpack(raw));
        moved += 1;
      }
      try {
        if (typeof sourceStore.delete === 'function') sourceStore.delete(key);
      } catch {
        /* abaikan */
      }
    }
    return moved;
  }

  return {
    get, set, pack, unpack, isPacked,
    encryptionAvailable, upgradeLegacy, relocateFrom,
    sensitiveKeys: sensitive,
  };
}

module.exports = { createSecrets, SENSITIVE_KEYS };
