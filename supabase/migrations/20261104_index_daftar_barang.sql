-- ============================================================================
--  INDEX DAFTAR BARANG (Master Data > Daftar Barang) — idempotent
-- ============================================================================
--  Masalah: menu Daftar Barang lambat saat buka/search/scroll karena query
--  mengambil seluruh tabel (tanpa LIMIT) dan render 1457 row DOM sekaligus.
--
--  Perbaikan frontend: paginasi 50/halaman + debounce search 300ms.
--  Perbaikan DB: index di bawah supaya LIMIT/OFFSET + ORDER BY + ILIKE
--  cepat bahkan untuk data besar (100k+ baris).
--
--  Cara pakai: Supabase -> SQL Editor -> tempel -> RUN. Aman diulang.
-- ============================================================================

-- 1) B-tree: filter aktif + urutan nama + filter kategori
create index if not exists kasir_products_user_active
  on public.kasir_products (user_id, is_active);
create index if not exists kasir_products_user_category
  on public.kasir_products (user_id, category);
create index if not exists kasir_products_active_name
  on public.kasir_products (user_id, is_active, lower(name));
create index if not exists kasir_products_active_bc
  on public.kasir_products (user_id, is_active, barcode);

-- 2) pg_trgm: ILIKE '%kw%' (wildcard di awal) TIDAK bisa pakai b-tree.
--    Aktifkan extension + index GIN supaya pencarian substring cepat di data besar.
create extension if not exists pg_trgm;

create index if not exists kasir_products_trgm_name
  on public.kasir_products using gin (name gin_trgm_ops);
create index if not exists kasir_products_trgm_barcode
  on public.kasir_products using gin (barcode gin_trgm_ops);
create index if not exists kasir_products_trgm_category
  on public.kasir_products using gin (category gin_trgm_ops);

-- Partial GIN: query paling umum (Daftar Barang default: is_active=true, search name)
create index if not exists kasir_products_active_trgm_name
  on public.kasir_products using gin (name gin_trgm_ops)
  where is_active = true;

analyze public.kasir_products;
