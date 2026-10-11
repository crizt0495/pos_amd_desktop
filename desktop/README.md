# KasirPro POS — Aplikasi Desktop Windows

Pembungkus **Electron** untuk aplikasi web POS KasirPro
(<https://pos-amd-desktop.vercel.app>). Tujuannya menjadikan aplikasi kasir
yang bisa langsung dipakai di meja kasir: satu kali input Serial Key, lalu
setiap kali dibuka langsung masuk ke halaman Penjualan tanpa login lagi.

## Fitur

| Permintaan | Cara diimplementasikan |
| --- | --- |
| Auto-login tanpa Serial Key tiap buka | Serial disimpan di config lokal (`electron-store`), lalu di-login ulang otomatis ke `/api/auth/login` saat start. Sesi Supabase (cookie) juga ikut tersimpan di sesi persist Electron. |
| Input Serial Key 1x saat pertama | Halaman lokal `setup.html` muncul hanya kalau belum ada serial. |
| Tidak ada tombol Logout | Tombol `title="Keluar"` disembunyikan lewat CSS yang disuntik dari main process. |
| Menu "Ganti Serial" khusus owner | Tray icon → **Ganti Serial (Owner)**, atau pintasan rahasia **Ctrl+Alt+G**. Digerbangi password owner (dibuat sekali di menu itu). |
| Fullscreen, tanpa toolbar/address bar | `BrowserWindow` fullscreen + menu aplikasi dinonaktifkan. |
| Disable Ctrl+R / F5 / Ctrl+Shift+I | Dicegat di `before-input-event`; F12, F11, Ctrl+W, Ctrl+P juga diblokir. Tombol **F5 (Pending)** tetap diteruskan ke aplikasi. |
| Judul "KasirPro POS - [Nama Toko]" | Nama toko dibaca dari title bar aplikasi web lalu dipasang ke judul jendela OS. |
| Shortcut F8/F9/F10/ESC tetap jalan | Tidak diubah; Electron hanya memblokir pintasan browser. |
| Auto-print thermal 80mm tanpa dialog | `window.print()` ditambal di main world; struk dikirim ke `webContents.print({ silent: true })` (ukuran 58/80mm, printer diambil dari Pengaturan aplikasi web). Export PDF tetap memakai dialog bawaan. |
| Loading screen | Halaman lokal `loading.html` ("KasirPro POS loading…"). |
| Popup offline + auto-reload 5 detik | Halaman lokal `offline.html`, retry tiap 5 detik sampai server terjangkau. |
| Auto-update | `electron-updater` membaca `latest.yml` dari GitHub Releases repo ini. |
| Installer 1 file `KasirPro-Setup-Windows.exe` | electron-builder target NSIS x64, `artifactName` khusus. Windows 10/11 64-bit. |
| Icon logo KasirPro | `build/icon.ico` + `build/icon.png` (diturunkan dari logo portal). |
| Bisa di-pin taskbar/desktop | Installer membuat shortcut Desktop + Start Menu; `appId` stabil. |

## Struktur

```
desktop/
├── electron-builder.yml     # konfigurasi installer
├── package.json
├── build/                   # icon build (icon.ico, icon.png)
├── assets/                  # icon runtime (window/tray)
└── src/
    ├── main.js              # proses utama (auto-login, kiosk, cetak, update, tray)
    ├── preload.js           # jembatan window.kasirproDesktop + tambalan window.print
    └── pages/               # halaman lokal: loading, offline, setup, owner
```

## Menjalankan (mode pengembangan)

```bash
cd desktop
npm install
npm run dev         # buka jendela Electron mengarah ke server produksi
npm run reset       # hapus serial tersimpan (uji alur first-run / aktivasi)
```

`--dev` menampilkan DevTools dan melewati auto-update.

## Membuat installer Windows

### Opsi A — dari Windows (paling mudah)

```powershell
cd desktop
npm install
npm run dist
# hasil: desktop\release\KasirPro-Setup-Windows.exe
```

### Opsi B — dari Linux dengan Docker (tanpa Windows/Wine di host)

Gambar `electronuserland/builder:wine` sudah berisi Wine, jadi installer bisa
dibangun dari Linux:

```bash
# dari folder repo (pos_amd_desktop)
rm -rf /tmp/kpbuild && mkdir -p /tmp/kpbuild
tar -C desktop --exclude=node_modules --exclude=release -cf - . | tar -C /tmp/kpbuild -xf -

docker run --rm -v /tmp/kpbuild:/project -w /project \
  electronuserland/builder:wine \
  bash -lc "npm ci && npm run dist"

# hasil: /tmp/kpbuild/release/KasirPro-Setup-Windows.exe
cp /tmp/kpbuild/release/KasirPro-Setup-Windows.exe desktop/release/
```

> Catatan: build Windows langsung dari Linux **tanpa** Wine akan gagal dengan
> pesan `wine is required` (electron-builder memakai Wine untuk menyematkan
> ikon/versi ke `.exe`).

### Opsi C — GitHub Actions (disarankan, tanpa perlu Windows/Wine)

Workflow `.github/workflows/build-windows.yml` membangun installer di
`windows-latest`:

- Push/`workflow_dispatch` → artifact **KasirPro-Setup-Windows**.
- Push tag versi (mis. `git tag v2.0.0 && git push origin v2.0.0`) →
  installer sekaligus diunggah ke **GitHub Releases** (dipakai auto-update).

## Alur start

```
loading.html
 ├─ belum ada serial ──▶ setup.html (input 1x) ──sukses──▶ /kasir
 ├─ ada serial ────────▶ POST /api/auth/login ──sukses──▶ /kasir
 ├─ serial invalid ────▶ setup.html + pesan error
 └─ tanpa koneksi ─────▶ offline.html (retry tiap 5 detik)
```

## Konfigurasi

Config lokal tersimpan di
`%APPDATA%\KasirPro POS\config.json` (via electron-store):

```json
{
  "serialKey": "XXXX-...",
  "ownerPassword": "...",
  "storeName": "Toko Contoh",
  "serverUrl": "https://pos-amd-desktop.vercel.app",
  "printerName": "",
  "pageSize": "80mm",
  "deviceId": "<HWID stabil>"
}
```

- `serverUrl` bisa diubah manual (mis. ke server sendiri) atau lewat env
  `KASIRPRO_SERVER_URL` saat menjalankan `npm start`.
- `deviceId` dikunci saat instalasi dan menjadi HWID lisensi (1 key = 1
  perangkat). Jangan diubah setelah aktivasi.

## Catatan

- Aplikasi **butuh koneksi internet** (data di Supabase). Mode offline hanya
  menampilkan popup lalu menyambung ulang otomatis.
- Silent print memakai printer yang dipilih di **Pengaturan → Printer** pada
  aplikasi web. Kalau silent print gagal (printer belum ada), otomatis jatuh
  ke dialog print bawaan.
- Tombol **F5** di aplikasi web berfungsi sebagai *Pending*; Electron
  memblokir muat-ulang browser tetapi tetap meneruskan F5 ke aplikasi.
