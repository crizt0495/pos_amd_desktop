-- ============================================================================
--  INDEX DAFTAR BARANG (Master Data > Daftar Barang)
-- ============================================================================
--  Masalah: menu Daftar Barang memuat SEMUA produk sekaligus (tanpa LIMIT)
--  saat juga, sehingga lambat saat buka menu, search, dan scroll.
--
--  Perbaikan frontend (paginasi 50/halaman + debounce search) butuh index di
--  sisi database supaya query
--      WHERE is_active = true
--        AND (name ILIKE '%kw%' OR barcode ILIKE '%kw%' OR category ILIKE '%kw%')
--      ORDER BY name ASC
--      LIMIT 50 OFFSET n
--  tidak melakukan full scan + sort penuh.
--
--  Aman dijalankan berulang (idempotent). Jalankan di Supabase -> SQL Editor.
-- ============================================================================

-- Filter aktif / non-aktif
create index if not exists kasir_products_user_active
  on public.kasir_products (user_id, is_active);

-- Filter kategori
create index if not exists kasir_products_user_category
  on public.kasir_products (user_id, category);

-- Komposit: filter aktif + urutan nama (ORDER BY name LIMIT/OFFSET pakai index)
create index if not exists kasir_products_active_name
  on public.kasir_products (user_id, is_active, lower(name));

-- Komposit: pencarian barcode (prefix barcode = paling sering dipakai kasir)
create index if not exists kasir_products_active_bc
  on public.kasir_products (user_id, is_active, barcode);

analyze public.kasir_products;
