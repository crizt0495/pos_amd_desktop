# Terapkan Perbaikan Performa "Pergerakan Stok" di Supabase

Perbaikan ini **wajib dijalankan sekali** di proyek Supabase yang dipakai versi
web (proyek yang sama dengan KasirPro Portal/Admin Portal). Aplikasi desktop
tidak memerlukannya karena memakai database lokal.

Tanpa migrasi ini, layar **Laporan → Pergerakan Stok** versi web tetap berjalan
(otomatis memakai RPC lama), tetapi belum memakai jalur cepat.

- **File SQL:** `supabase/migrations/20261116_pergerakan_stok_perf.sql`
- Sifat: **idempotent** — aman dijalankan berulang.
- Isi: 3 index + RPC baru `kasir_stock_movement_report(...)` + `notify pgrst`.

## Langkah (SQL Editor)

1. Buka https://supabase.com/dashboard → pilih proyek yang benar.
2. Menu kiri → **SQL Editor** → **New query**.
3. Buka file `supabase/migrations/20261116_pergerakan_stok_perf.sql`,
   **salin seluruh isinya**, lalu tempel ke editor.
4. Klik **Run** (Ctrl/Cmd + Enter). Harus muncul `Success. No rows returned`.
5. Selesai. Versi web langsung memakai RPC baru (REST schema cache di-reload
   otomatis lewat `notify pgrst, 'reload schema'`).

> Catatan: menjalankan `supabase/schema.sql` (file skema lengkap) juga
> mengandung perubahan yang sama, jadi boleh pakai salah satu saja.

## Verifikasi

Jalankan di SQL Editor:

```sql
-- 1) Pastikan index sudah ada (harus 3 baris)
select indexname
from pg_indexes
where tablename = 'kasir_stock_logs'
  and indexname in (
    'kasir_stock_logs_prod',
    'kasir_stock_logs_user',
    'kasir_stock_logs_user_date_prod'
  )
order by indexname;

-- 2) Pastikan RPC baru ada
select proname
from pg_proc
where proname = 'kasir_stock_movement_report';
```

Hasil yang diharapkan: 3 nama index, dan 1 nama fungsi.

## Cek cepat dari aplikasi web

Buka **Laporan → Pergerakan Stok**, klik **Hari Ini**. Sebelum perbaikan filter
ini bisa tertahan puluhan detik; sesudahnya harus muncul dalam hitungan detik.
