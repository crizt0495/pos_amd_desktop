# Setup & Pindah Komputer — KasirPro POS

Panduan menyalakan proyek ini di komputer baru (clone dari GitHub → siap kerja).
Dokumen ini untuk repo **`pos_amd_desktop`**; sedikit catatan untuk portal ada di
bagian [Portal terkait](#portal-terkait).

---

## 1. Repo terkait

| Repo | Isi | URL |
| --- | --- | --- |
| `pos_amd_desktop` | **Aplikasi POS** (Next.js web + pembungkus Electron Windows) | `git@github.com:crizt0495/pos_amd_desktop.git` |
| `pos_amd_portal` | Portal operator (PWA, generate Serial Key & komisi) | `git@github.com:crizt0495/pos_amd_portal.git` |
| `pos_amd_admin_portal` | Portal admin (kelola toko, kuota, key) | `git@github.com:crizt0495/pos_amd_admin_portal.git` |

Semua memakai **proyek Supabase yang sama**. Ikuti urutan di bawah untuk desktop.

---

## 2. Prasyarat

- **Git**
- **Node.js 24.20.0** — pakai [nvm](https://github.com/nvm-sh/nvm). File `.nvmrc`
  sudah disediakan, cukup `nvm use`.
- **Windows 10/11 64-bit** *hanya* kalau mau membuat installer `.exe`
  (electron-builder target NSIS). Untuk ngoding/uji web, Linux/macOS cukup.

```bash
# cek
git --version
nvm install 24.20.0
```

---

## 3. Clone & install

```bash
git clone git@github.com:crizt0495/pos_amd_desktop.git
cd pos_amd_desktop
nvm use                 # mengikuti .nvmrc -> Node 24.20.0

# 1) siapkan env (lihat bagian 4)
cp .env.example .env.local
$EDITOR .env.local      # isi nilai Supabase (tanya pemilik / lihat dashboard)

# 2) dependency aplikasi web (root)
npm ci

# 3) dependency pembungkus Electron (desktop/) — WAJIB, terpisah
cd desktop && npm ci && cd ..
```

---

## 4. Environment (`.env.local`)

`.env.example` **berisi placeholder**, bukan rahasia. `.env.local` asli **tidak
ada di git** dan harus diisi sendiri. Variabel yang dibaca (`src/lib/env.ts`):

| Variabel | Wajib | Keterangan |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | URL proyek Supabase |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | ✅ | Kunci publik (alias: `..._ANON_KEY`) |
| `SUPABASE_SECRET_KEY` | ✅ | Kunci service role, server-only (alias: `SERVICE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) |
| `NEXT_PUBLIC_SITE_URL` | ➖ | Default `http://localhost:3001` |
| `NEXT_PUBLIC_APP_NAME` | ➖ | Default `KasirPro POS` |
| `DESKTOP_EXPORT` | ➖ | Set `1` saat membuat bundel offline |

Ambil nilainya di **Supabase Dashboard → Project Settings → API Keys**.

> ⚠️ Di CI/Vercel, nilai-nilai ini datang dari **GitHub Secrets / Vercel env**,
> jadi build & rilis otomatis di GitHub **tidak** butuh `.env.local` lokal.

---

## 5. Verifikasi (pasti jalan)

```bash
nvm use
npm run typecheck              # tsc --noEmit
cd desktop && npm test         # engine + sync + secrets (44 uji) && cd ..
npm run build                  # next build
```

Semua harus hijau. Kalau `desktop` gagal karena `better-sqlite3` (ABI), jalankan
ulang `cd desktop && npm ci` dengan Node yang sama (`nvm use`).

---

## 6. Menjalankan

```bash
# Web POS (dev) — buka http://localhost:3001
npm run dev

# Bundel offline + aplikasi Electron (di dalam desktop/)
DESKTOP_EXPORT=1 npm run export:desktop   # perlu sekali / tiap ganti UI
cd desktop && npm run dev                 # buka jendela Electron
```

---

## 7. Build & rilis installer

```bash
# Installer Windows (jalankan di Windows, atau butuh Wine di Linux/macOS)
cd desktop && npm run dist        # hasil: desktop/release/KasirPro-Setup-Windows.exe

# Rilis: bump versi -> commit -> tag v* -> CI mem-build & mem-publish otomatis
#   edit desktop/package.json "version"
git commit -am "release(desktop): vX.Y.Z"
git push origin main
git tag -a vX.Y.Z -m "KasirPro POS vX.Y.Z"
git push origin vX.Y.Z            # GitHub Actions: build NSIS + publish Release
```

Auto-update klien membaca `latest.yml` dari GitHub Releases. **Jangan pernah**
menaruh versi di nama file installer (harus tetap `KasirPro-Setup-Windows.exe`).

---

## 8. ⚠️ Checklist pindah komputer (yang TIDAK ada di git)

Kode sudah 100% di GitHub (`main` + semua tag). Yang **harus disalin manual**:

- [ ] **`.env.local`** — rahasia Supabase. Pindahkan via **USB / password
      manager**, JANGAN lewat chat/email/git. (Portal: `portal/.env.local`;
      admin: `.env.local`.)
- [ ] **`node_modules/`** dan **`desktop/node_modules/`** — jangan disalin,
      cukup `npm ci` di komputer baru.
- [ ] **`desktop/app/`** (bundel offline) — hasil build, buat ulang dengan
      `DESKTOP_EXPORT=1 npm run export:desktop`.
- [ ] **Installer `.exe`** — unduh dari
      <https://github.com/crizt0495/pos_amd_desktop/releases> (tidak di git).
- [ ] Berkas audit/laporan (`KasirPro-Security-Fix-Report.md`) bila masih perlu.

Yang **sudah** di git dan aman di-clone: seluruh `src/`, `desktop/src/`,
`supabase/`, `scripts/`, `.env.example`, `.github/workflows/`, dokumen
(`README.md`, `desktop/OFFLINE.md`, `desktop/SECURITY.md`, `SETUP.md`).

---

## 9. Keamanan (ringkas)

- Kredensial klien (token sesi, Serial Key, password owner) **tidak** lagi
  disimpan plaintext: dipisah ke `secrets.json` dan dienkripsi via `safeStorage`
  (Windows DPAPI). Lihat `desktop/SECURITY.md`.
- Jangan pernah commit `.env.local`, `config.json`, atau `secrets.json`
  (semua sudah masuk `.gitignore`).

---

## 10. Portal terkait

- **`pos_amd_portal`** (app root ada di `portal/`):
  ```bash
  git clone git@github.com:crizt0495/pos_amd_portal.git && cd pos_amd_portal
  npm run setup                       # install dependency di ./portal
  cp portal/.env.example portal/.env.local   # isi Supabase
  npm run dev:portal
  ```
- **`pos_amd_admin_portal`**:
  ```bash
  git clone git@github.com:crizt0495/pos_amd_admin_portal.git && cd pos_amd_admin_portal
  npm ci
  cp .env.example .env.local          # isi Supabase + ADMIN_EMAIL
  npm run dev
  ```
  Detail (bootstrap admin, DEMO_MODE) ada di `.env.example` masing-masing.
