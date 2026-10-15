# Keamanan Penyimpanan Kredensial (Desktop)

Menindaklanjuti audit `KasirPro-Security-Fix-Report.md` (15 Okt 2026).

## Masalah

File `config.json` (dikelola `electron-store`) berada di
`%APPDATA%\KasirPro POS\config.json` dan sebelumnya menyimpan nilai sensitif
sebagai **JSON plaintext**:

| Kunci | Isi | Tingkat |
| --- | --- | --- |
| `authSession` | `refresh_token` + `access_token` Supabase | CRITICAL (F-001/F-002) |
| `serialKey` | Serial Key lisensi | MEDIUM (F-003) |
| `ownerPassword` | Password owner | P2 (F-004) |

## Perbaikan

Nilai sensitif **dipisahkan** dari `config.json` ke file tersendiri
`%APPDATA%\KasirPro POS\secrets.json`, lalu **dienkripsi at-rest** memakai
`safeStorage` bawaan Electron:

- **Windows** → DPAPI (terikat akun Windows pengguna)
- **macOS** → Keychain
- **Linux** → libsecret/kwallet (bila tersedia)

Format tersimpan di `secrets.json`:

```json
{ "authSession": { "$enc": "<base64 ciphertext>" } }
```

`config.json` kini **tidak lagi memuat** `authSession`/`serialKey`/
`ownerPassword` sama sekali (hanya preferensi non-sensitif seperti nama toko,
server URL, ukuran halaman).

Jika enkripsi OS tidak tersedia, nilai disimpan dengan penanda
`{ "$plain": "<json>" }` dan **otomatis di-upgrade** ke `$enc` begitu keyring
tersedia. Nilai plaintext warisan (format lama di `config.json`) dipindahkan
otomatis ke `secrets.json` saat start.

Implementasi: `desktop/src/secrets.cjs` (murni, tanpa `require('electron')`,
diuji oleh `desktop/test/secrets.test.cjs`).

## Pembersihan token lama

Saat pertama kali menjalankan versi ini, `migrateSecrets()` (di `main.js`)
membuang `authSession` lama sekali (`SECURITY_VERSION = 1`) agar login
berikutnya mengambil token baru. `serialKey` dan `localUserId` dipertahankan,
sehingga **aplikasi tetap bisa jalan offline**; sinkronisasi Supabase saja yang
menunggu login online berikutnya.

## Tindakan manual yang WAJIB (di luar aplikasi)

Enkripsi melindungi file di disk, tetapi **token yang sudah terpapar tetap
valid di server** sampai di-revoke:

1. **Revoke sesi** user terkait di Supabase Dashboard → Auth → Users
   (Revoke Sessions / Sign out all devices).
2. **Rotasi Serial Key** bila dianggap bocor (reissue).
3. Pastikan `%APPDATA%\KasirPro POS` (khususnya `secrets.json`) **tidak** ikut
   tersinkron ke OneDrive/Dropbox/Google Drive.
4. Aktifkan **Refresh Token Rotation** di Supabase Auth (Settings → Auth) dan
   pertimbangkan MFA pada akun sensitif.

## Yang belum dicakup (butuh perubahan di sisi server)

- Refresh-token rotation/reuse detection (setelan Supabase Auth).
- `deviceId`/`fingerprint` binding per sesi.
- Zeroization di memori (keterbatasan runtime JS/Electron).
