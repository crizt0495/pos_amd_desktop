# KasirPro Desktop — Offline First (SQLite lokal)

Mulai versi ini aplikasi desktop **bukan lagi online-first**. Semua menu
(Kasir, Produk, Pembelian, Riwayat, Laporan, Pergerakan Stok, Pengaturan)
dibaca & ditulis ke **database lokal SQLite** di PC kasir, sehingga tetap
jalan tanpa internet. Sinkronisasi ke Supabase dilakukan di latar belakang
saat online (1 PC per toko → Supabase dipakai sebagai backup + agar portal
tetap melihat data).

## Keputusan arsitektur

| Aspek | Pilihan |
| --- | --- |
| Mode | Offline penuh (semua menu jalan tanpa internet) |
| Jumlah PC | 1 PC per toko; sinkron ke Supabase (backup + portal) |
| Database lokal | SQLite via `better-sqlite3` di proses utama Electron |
| Jembatan | IPC `desktop:db` (main) ← shim `src/lib/supabase/local.ts` (renderer) |
| Sumber kebenaran | Lokal (SQLite) saat offline; Supabase saat sinkron (last-write-wins, lokal menang) |

### Kenapa bukan mengubah `src/lib/api.ts`

`api.ts` (1.500+ baris) menyentuh Supabase lewat query builder + 19 RPC
Postgres. Agar **tidak menulis ulang seluruh layar**, dibuat **shim** yang
meniru sebagian kecil API `supabase-js` yang dipakai aplikasi
(`.from().select().eq().order().single()`, `.rpc()`, `.auth.getUser()`).
Shim meneruskan operasi ke SQLite lokal di proses utama. `api.ts` tidak
berubah — hanya `createClient()` yang memilih shim bila berjalan di desktop.

Query builder yang perlu ditiru (hasil audit `src/`):

```
from select insert update delete upsert eq or in like ilike gte lte
order limit range single maybeSingle rpc
```

RPC Postgres yang diport ke SQLite (lihat `desktop/src/db/engine.cjs`):

```
kasir_create_transaction   kasir_void_transaction    kasir_create_return
kasir_adjust_stock         kasir_opname_stock        kasir_stock_logs_list
kasir_stock_movements      kasir_report_summary      kasir_report_top
kasir_report_daily         kasir_report_by_payment   kasir_report_by_cashier
kasir_active_shift         kasir_open_shift          kasir_shift_preview
kasir_close_shift          kasir_create_purchase     kasir_update_purchase
kasir_delete_purchase
```

## Fase

- [x] **Fase 1 — Fondasi lokal.** Skema SQLite, mesin query (mini PostgREST),
      19 RPC diport ke JS, IPC `desktop:db`, shim renderer, outbox sinkron.
- [x] **Fase 2 — Sinkron Supabase.** Push outbox (upsert/delete) dari
      `src/lib/supabase/sync.ts`, dipasang oleh `DesktopSync` (berkala +
      saat `online`/`focus`). Tarik awal untuk PC baru: lihat Fase 5.
- [x] **Fase 3a — Infrastruktur bundel statis.** `scripts/export-desktop.mjs`
      + `next.config.mjs` kondisional, server HTTP lokal (`desktop/src/localServer.cjs`),
      jendela memuat app lokal (`http://127.0.0.1:PORT`) bila `localDb` aktif
      dan berkas bundel tersedia. Nepotisme? Tidak. Aplikasi web tetap terpisah;
      bundel statis bisa dihasilkan saat build installer.
- [x] **Fase 3b — Integrasi bundel ke CI.** Workflow `build-windows.yml`
      menjalankan `npm run export:desktop` (dengan env Supabase dari secrets)
      sebelum `npm ci` + build di `desktop/`, lalu memverifikasi
      `desktop/app/kasir/index.html` ada. `desktop/app/` di-gitignore
      (artefak build, dihasilkan CI).
- [x] **Fase 4 — Login offline.** Aktivasi pertama online menyimpan
      `localUserId` + `authSession` + `lastLicenseCheck`. Start berikutnya
      tanpa internet langsung memakai aplikasi + data lokal (masa tenggang
      verifikasi 45 hari). Saat masa tenggang habis, halaman offline meminta
      internet sekali lagi.
- [x] **Fase 5 — Restore / sinkronisasi turun.** `pullFromRemote()` menarik
      semua tabel dari Supabase lalu `engine.importRows()` menuliskannya ke
      SQLite **tanpa** mencatat ke `_outbox`. Tarikan awal otomatis sekali per
      user (ditandai `_meta.initialPull:<uid>`), plus menu tray
      **Ambil Data dari Server** untuk restore manual. Baris yang masih punya
      perubahan lokal tertunda tidak ditimpa.

## Sinkronisasi

- Tiap tulis (CRUD + efek RPC) mencatat baris di `_outbox`.
- `pushLocalChanges()` membaca outbox, lalu meng-`upsert`/menghapus baris ke
  Supabase memakai sesi login yang sama. Baris yang sukses ditandai `done`
  (`outbox.mark`).
- `pullFromRemote()` arah sebaliknya (restore): ambil dari Supabase →
  `importRows` → SQLite. Idempoten; kolom yang tidak ada di skema lokal dibuang.
- Dipasang otomatis oleh komponen `DesktopSync` (di root layout): tarikan awal
  ~1,5 dtk setelah aplikasi tampil, lalu push tiap 60 dtk, saat event `online`,
  dan saat jendela `focus`. Menu tray: **Sinkronkan Sekarang** /
  **Ambil Data dari Server**, plus status "N data menunggu".
- `kasir_settings` memakai kunci `user_id,key`; tabel lain memakai `id`.

## Aktifkan/matikan mode lokal

Mode lokal dikendalikan `localDb` di `electron-store` (config.json).
Sejak bundel offline ikut terpasang, `localDb` **menyala otomatis** pada
instalasi baru/upgrade (bila bundel `app/kasir/index.html` ada dan user belum
pernah mengubah setelan ini). Bisa dimatikan dari menu
**Tray › Database Lokal (offline)** (aplikasi dimuat ulang otomatis), atau:

```bash
# di app:
node -e "const S=require('electron-store');new S({name:'config'}).set('localDb',true)"
```

Saat `localDb` mati, `desktop:db` tidak dipakai dan `createClient()` memakai
Supabase seperti biasa.

## Keamanan saat layar blank

Bila aplikasi lokal gagal menampilkan konten (mis. bundel tidak lengkap),
`loadApp()` mendeteksinya (`loadAndVerify`) lalu **otomatis jatuh ke versi
server** — tidak lagi menampilkan layar kosong. Server lokal juga mengembalikan
404 untuk aset `_next/*` yang hilang (bukan HTML), supaya modul JS tidak salah
di-parse.

## Skema & penyimpangan kecil dari Postgres

- `numeric` → `REAL` (dibulatkan 2 desimal di JS, sama seperti aplikasi).
- `boolean` → `0/1`, dikembalikan sebagai boolean pada kolom yang diketahui.
- `jsonb` → `TEXT` (JSON) untuk `kasir_products.satuan_list`, `.variants`,
  `kasir_settings.value`.
- `timestamptz` → `TEXT` ISO-8601 UTC.
- Nomor `INV/RET/SHIFT` memakai tanggal **Asia/Jakarta** (sama seperti RPC
  asli); nomor `PO` juga Jakarta (aslinya UTC — hanya kosmetik).
- Semua tabel punya `user_id` → shim menambahkan filter `user_id = uid`
  otomatis (pengganti RLS). `uid` = id user GoTrue lisensi, disimpan lokal.

## Outbox

Setiap tulis (INSERT/UPDATE/DELETE/UPSERT, termasuk efek samping RPC)
mencatat baris ke tabel `_outbox (tbl, row_id, op, ts)`. Fase 2 memakainya
untuk push ke Supabase; satu baris per `(tbl,row_id)` (yang terakhir menang).
