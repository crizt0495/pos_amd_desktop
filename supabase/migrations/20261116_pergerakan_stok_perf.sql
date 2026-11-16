-- ============================================================================
--  PERBAIKAN PERFORMA: Laporan > Pergerakan Stok
-- ============================================================================
--  Gejala: filter "Hari Ini" tertahan 40-50 detik walau hanya menampilkan
--  beberapa baris, sedangkan "7 Hari"/"30 Hari" cepat.
--
--  Penyebab utama di sisi database:
--    RPC lama `kasir_stock_movements` mengembalikan SELURUH baris hasil filter
--    dalam satu jsonb. Untuk "Hari Ini", server tetap harus memproses riwayat
--    yang lebar; belum ada pagination + agregasi total di SQL. Aplikasi juga
--    menghitung total masuk/keluar dari seluruh payload di browser.
--
--  Perbaikan:
--    1. Index rentang tanggal + barang:
--         (user_id, created_at desc, product_id)  -> tanggal, kode barang
--         (user_id, product_id, created_at desc)  -> kode barang, tanggal
--    2. RPC baru `kasir_stock_movement_report(...)`:
--         - filter RENTANG: created_at >= from AND created_at < to + 1 hari
--           (tanpa DATE(created_at) = ... agar index tetap terpakai)
--         - SUM(masuk), SUM(keluar) + COUNT di SQL
--         - deret harian (daily) untuk grafik dari agregasi yang sama
--         - LIMIT/OFFSET di server (default 100 baris/halaman)
--    3. RPC lama tetap dipertahankan agar klien versi lama tidak rusak.
--
--  Idempotent: aman dijalankan berulang di Supabase -> SQL Editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Index
-- ----------------------------------------------------------------------------
create index if not exists kasir_stock_logs_prod on public.kasir_stock_logs
  (user_id, product_id, created_at desc);

create index if not exists kasir_stock_logs_user on public.kasir_stock_logs
  (user_id, created_at desc);

create index if not exists kasir_stock_logs_user_date_prod on public.kasir_stock_logs
  (user_id, created_at desc, product_id);

-- ----------------------------------------------------------------------------
-- 2. RPC laporan cepat (agregasi + pagination + data grafik)
-- ----------------------------------------------------------------------------
create or replace function public.kasir_stock_movement_report(
  p_from       text default null,
  p_to         text default null,
  p_product_id uuid default null,
  p_jenis      text default null,
  p_q          text default null,
  p_page       integer default 1,
  p_page_size  integer default 100
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with params as (
    select
      greatest(coalesce(p_page, 1), 1) as page,
      least(greatest(coalesce(p_page_size, 100), 1), 500) as page_size
  ),
  base as (
    select
      s.id, s.created_at, s.product_id, s.tipe, s.ref_tipe, s.qty,
      s.stok_sebelum, s.stok_sesudah, s.keterangan
    from public.kasir_stock_logs s
    where s.user_id = auth.uid()
      -- Rentang tanggal eksklusif: index (user_id, created_at) terpakai.
      and (p_from is null or p_from = ''
           or s.created_at >= (p_from::date at time zone 'UTC'))
      and (p_to is null or p_to = ''
           or s.created_at < ((p_to::date + interval '1 day') at time zone 'UTC'))
      and (p_product_id is null or s.product_id = p_product_id)
      and (
        p_q is null or p_q = ''
        or exists (
          select 1 from public.kasir_products p
          where p.id = s.product_id
            and (p.name ilike '%' || p_q || '%'
                 or coalesce(p.barcode, '') ilike '%' || p_q || '%')
        )
      )
  ),
  typed as (
    select b.*,
      case
        when b.tipe = 'terjual' then 'PENJUALAN'
        when b.tipe = 'retur' then 'RETUR'
        when b.tipe = 'void' then 'PEMBATALAN'
        when b.ref_tipe = 'pembelian' and b.tipe = 'stok_masuk' then 'PEMBELIAN'
        when b.ref_tipe = 'pembelian' and b.tipe = 'stok_keluar' then 'PEMBATALAN'
        when b.ref_tipe is null and b.tipe in ('stok_masuk', 'stok_keluar') then 'ADJUSTMENT'
        else 'LAINNYA'
      end as jenis
    from base b
  ),
  filtered as (
    select * from typed
    where p_jenis is null or p_jenis = '' or jenis = p_jenis
  ),
  agg as (
    select
      count(*)::int as total_rows,
      coalesce(sum(case when qty > 0 then round(qty, 2) else 0 end), 0) as total_masuk,
      coalesce(sum(case when qty < 0 then round(-qty, 2) else 0 end), 0) as total_keluar
    from filtered
  ),
  daily as (
    select
      (created_at at time zone 'UTC')::date as tanggal,
      coalesce(sum(case when qty > 0 then round(qty, 2) else 0 end), 0) as masuk,
      coalesce(sum(case when qty < 0 then round(-qty, 2) else 0 end), 0) as keluar
    from filtered
    group by 1
    order by 1
  ),
  page_rows as (
    select f.*
    from filtered f
    order by f.created_at desc, f.product_id
    limit (select page_size from params)
    offset (select (page - 1) * page_size from params)
  ),
  hasil as (
    select
      f.id, f.created_at, f.product_id,
      p.barcode, p.name as product_name, p.unit,
      f.tipe, f.ref_tipe, f.qty, f.stok_sebelum, f.stok_sesudah, f.keterangan, f.jenis,
      coalesce(t.invoice_no, pu.invoice_no, r.retur_no) as no_referensi
    from page_rows f
    left join public.kasir_products p on p.id = f.product_id
    left join public.kasir_transactions t
      on f.ref_tipe = 'transaksi' and t.id = f.ref_id
    left join public.kasir_purchases pu
      on f.ref_tipe = 'pembelian' and pu.id = f.ref_id
    left join public.kasir_returns r
      on f.ref_tipe = 'retur' and r.id = f.ref_id
    order by f.created_at desc, f.product_id
  )
  select jsonb_build_object(
    'rows', coalesce(
      (select jsonb_agg(
          jsonb_build_object(
            'id', r.id, 'created_at', r.created_at, 'product_id', r.product_id,
            'barcode', r.barcode, 'product_name', r.product_name, 'unit', r.unit,
            'jenis', r.jenis, 'no_referensi', r.no_referensi,
            'masuk', case when r.qty > 0 then r.qty else 0 end,
            'keluar', case when r.qty < 0 then -r.qty else 0 end,
            'stok_sebelum', r.stok_sebelum, 'stok_sesudah', r.stok_sesudah,
            'keterangan', r.keterangan
          ) order by r.created_at desc, r.product_id
        ) from hasil r),
      '[]'::jsonb
    ),
    'total_rows',   (select total_rows from agg),
    'total_masuk',  (select total_masuk from agg),
    'total_keluar', (select total_keluar from agg),
    'daily', coalesce(
      (select jsonb_agg(
          jsonb_build_object(
            'tanggal', d.tanggal, 'masuk', d.masuk, 'keluar', d.keluar
          ) order by d.tanggal
        ) from daily d),
      '[]'::jsonb
    ),
    'page',       (select page from params),
    'page_size',  (select page_size from params),
    'total_pages', greatest(
      1,
      ceil((select total_rows from agg)::numeric / (select page_size from params))::int
    )
  );
$$;

grant execute on function public.kasir_stock_movement_report(text, text, uuid, text, text, integer, integer)
  to authenticated, service_role;

notify pgrst, 'reload schema';
