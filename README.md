# KasirPro POS — Web (layout desktop)

Aplikasi kasir **web** (bukan Electron) dengan layout desktop: transaksi kasir,
manajemen produk, laporan & pembatalan (void). Di-host di **Vercel**, data di
**Supabase** (proyek yang sama dengan KasirPro Portal).

> Proyek ini adalah pengganti "aplikasi desktop Electron" — tanpa instalasi,
> cukup buka dari browser di layar lebar.

## Fitur

| Layar   | Kemampuan                                                                 |
| ------- | ------------------------------------------------------------------------- |
| Kasir   | Scan barcode / cari produk, keranjang, diskon % / Rp, tunai & QRIS, struk 58mm (cetak web) |
| Produk  | Tambah / ubah / hapus, stok ±, status non-aktif, peringatan stok menipis   |
| Laporan | Omzet & laba, grafik harian, produk terlaris, metode bayar, riwayat + void (stok kembali) |

## Stack

- Next.js 14 (App Router) + React 18 + Tailwind CSS
- Supabase (`@supabase/ssr`) — auth via username/email (sama dengan portal)
- RLS per akun (`user_id = auth.uid()`); transaksi/laporan lewat RPC PostgreSQL (atomik)

## Struktur

```
src/
  middleware.ts            proteksi rute + refresh sesi
  lib/
    env.ts                 env accessor
    supabase/              klien browser/server/service-role
    api.ts                 data layer (produk, transaksi, laporan, setting)
    format.ts              rupiah, tanggal, hitung keranjang
    receipt.ts             penyusun struk
    types.ts               domain types
  app/
    login/                 halaman masuk (username/password + akun demo)
    (app)/kasir            layar kasir
    (app)/produk           layar produk
    (app)/laporan          layar laporan
supabase/schema.sql        skema + RLS + RPC (wajib dijalankan sekali)
scripts/check-supabase.mjs verifikasi skema
```

## Menjalankan lokal

```bash
npm install
cp .env.example .env.local   # lalu isi nilai Supabase (sama dengan portal)
npm run dev                  # http://localhost:3001
```

## Menyiapkan Supabase (sekali saja)

1. Buka <https://supabase.com/dashboard> → proyek KasirPro.
2. **SQL Editor** → *New query* → tempel seluruh isi `supabase/schema.sql` → **RUN**.
3. Verifikasi:

```bash
npm run check:supabase
```

Akun `demo` (portal) langsung bisa dipakai — data kasir otomatis per akun.
Saat daftar produk masih kosong, aplikasi memasukkan 3 produk contoh.

## Deploy ke Vercel

1. Import repo `crizt0495/pos_amd_desktop` ke Vercel (framework **Next.js**).
2. Tambahkan environment variables **production**:

| Variabel                           | Keterangan                    |
| ---------------------------------- | ----------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`         | URL proyek Supabase           |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Kunci publik (publishable) |
| `SUPABASE_SECRET_KEY`              | Kunci service role (server)   |
| `NEXT_PUBLIC_SITE_URL`             | URL domain produksi           |
| `NEXT_PUBLIC_APP_NAME`             | `KasirPro POS`                |

3. Deploy → `vercel deploy --prod --yes` (atau auto-deploy via GitHub Actions).