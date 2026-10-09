-- ============================================================================
--  PERGERAKAN STOK + STOK OPNAME
-- ============================================================================
--  Melengkapi modul Laporan > Pergerakan Stok dan tombol Stok Opname di
--  Master Barang. Seluruh data sudah otomatis tercatat di kasir_stock_logs
--  (kartu stok) oleh transaksi jual/beli/retur/void; migrasi ini:
--
--    1. Menambah nilai 'pembelian' pada kasir_stock_logs.ref_tipe
--       (sebelumnya RPC pembelian memakai 'retur' sebagai akal-akalan
--        agar lolos CHECK — kini ditulis dengan nilai yang benar).
--    2. RPC kasir_create_purchase / kasir_delete_purchase -> ref_tipe
--       'pembelian' + backfill data lama.
--    3. RPC kasir_stock_movements(...) -> laporan pergerakan stok gabungan
--       (jual, beli, retur, void, penyesuaian) + filter periode/barang/jenis/
--       pencarian + nomor referensi (invoice / no faktur / no retur).
--    4. RPC kasir_opname_stock(...) -> koreksi stok fisik; selisih otomatis
--       dihitung dan dicatat sebagai ADJUSTMENT di pergerakan stok.
--
--  Idempotent: aman dijalankan berulang di Supabase -> SQL Editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Izinkan ref_tipe = 'pembelian'
-- ----------------------------------------------------------------------------
alter table public.kasir_stock_logs
  drop constraint if exists kasir_stock_logs_ref_tipe_check;

alter table public.kasir_stock_logs
  add constraint kasir_stock_logs_ref_tipe_check
  check (ref_tipe in ('transaksi', 'retur', 'pembelian'));

-- Backfill: mutasi stok masuk/keluar yang menunjuk ke sebuah pembelian.
update public.kasir_stock_logs s
   set ref_tipe = 'pembelian'
 where s.ref_tipe = 'retur'
   and s.tipe in ('stok_masuk', 'stok_keluar')
   and s.ref_id is not null
   and exists (
     select 1 from public.kasir_purchases p where p.id = s.ref_id
   );

-- ----------------------------------------------------------------------------
-- 2. RPC pembelian: ref_tipe 'pembelian'
-- ----------------------------------------------------------------------------
create or replace function public.kasir_create_purchase(
  p_supplier_name text,
  p_supplier_id   uuid,
  p_items         jsonb,
  p_note          text default null,
  p_status        text default 'lunas'
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user        uuid := auth.uid();
  v_total       numeric := 0;
  v_purchase_id uuid;
  v_invoice     text;
  v_status      text;
  v_item        record;
  v_pid         uuid;
  v_qty         numeric;
  v_cost        numeric;
  v_sub         numeric;
  v_unit        text;
  v_sebelum     numeric;
  v_sesudah     numeric;
begin
  if v_user is null then
    raise exception 'Harus login.';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Minimal satu item pembelian.';
  end if;

  v_status  := case when p_status = 'hutang' then 'hutang' else 'lunas' end;
  v_invoice := 'PO-' || to_char(now(), 'YYMMDD') || '-' ||
               lpad(nextval('public.kasir_purchase_invoice_seq')::text, 5, '0');

  insert into public.kasir_purchases
    (user_id, supplier_id, supplier_name, total, note, invoice_no, status)
  values
    (v_user, p_supplier_id, p_supplier_name, 0,
     nullif(coalesce(p_note, ''), ''), v_invoice, v_status)
  returning id into v_purchase_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty   := greatest(coalesce((v_item.value->>'qty')::numeric, 0), 0);
    v_cost  := greatest(coalesce((v_item.value->>'cost')::numeric, 0), 0);
    v_sub   := round(v_qty * v_cost, 2);
    v_total := v_total + v_sub;
    v_pid   := nullif(coalesce((v_item.value->>'product_id')::text, ''), '')::uuid;
    v_unit  := nullif(coalesce((v_item.value->>'unit')::text, ''), '');

    insert into public.kasir_purchase_items
      (purchase_id, user_id, product_id, product_name, qty, cost, subtotal, unit)
    values
      (v_purchase_id, v_user, v_pid,
       coalesce((v_item.value->>'name')::text, 'Item'),
       v_qty, v_cost, v_sub, v_unit);

    if v_pid is not null then
      select stock into v_sebelum
        from public.kasir_products
       where id = v_pid and user_id = v_user
       for update;
      if v_sebelum is not null then
        update public.kasir_products
           set stock = stock + v_qty, updated_at = now()
         where id = v_pid and user_id = v_user
        returning stock into v_sesudah;

        insert into public.kasir_stock_logs
          (user_id, product_id, tipe, qty, stok_sebelum, stok_sesudah, keterangan, ref_id, ref_tipe)
        values
          (v_user, v_pid, 'stok_masuk', v_qty, v_sebelum, v_sesudah,
           'Pembelian ' || coalesce(p_supplier_name, ''), v_purchase_id, 'pembelian');
      end if;
    end if;
  end loop;

  update public.kasir_purchases set total = v_total where id = v_purchase_id;
  return jsonb_build_object(
    'id', v_purchase_id,
    'total', v_total,
    'invoice_no', v_invoice,
    'status', v_status
  );
end;
$$;

grant execute on function public.kasir_create_purchase(text, uuid, jsonb, text, text)
  to authenticated, service_role;

create or replace function public.kasir_delete_purchase(p_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user    uuid := auth.uid();
  v_owner   uuid;
  v_item    record;
  v_sebelum numeric;
  v_sesudah numeric;
  v_qty     numeric;
begin
  if v_user is null then
    raise exception 'Harus login.';
  end if;

  select user_id into v_owner
    from public.kasir_purchases
   where id = p_id
   for update;
  if v_owner is null then
    raise exception 'Pembelian tidak ditemukan.';
  end if;
  if v_owner <> v_user then
    raise exception 'Bukan milik pengguna ini.';
  end if;

  for v_item in
    select product_id, qty
      from public.kasir_purchase_items
     where purchase_id = p_id
  loop
    v_qty := coalesce(v_item.qty, 0);
    if v_item.product_id is not null and v_qty <> 0 then
      select stock into v_sebelum
        from public.kasir_products
       where id = v_item.product_id and user_id = v_user
       for update;
      if v_sebelum is not null then
        update public.kasir_products
           set stock = greatest(stock - v_qty, 0), updated_at = now()
         where id = v_item.product_id and user_id = v_user
        returning stock into v_sesudah;

        insert into public.kasir_stock_logs
          (user_id, product_id, tipe, qty, stok_sebelum, stok_sesudah, keterangan, ref_id, ref_tipe)
        values
          (v_user, v_item.product_id, 'stok_keluar', -v_qty, v_sebelum, v_sesudah,
           'Hapus pembelian', p_id, 'pembelian');
      end if;
    end if;
  end loop;

  delete from public.kasir_purchases where id = p_id;
  return jsonb_build_object('id', p_id);
end;
$$;

grant execute on function public.kasir_delete_purchase(uuid)
  to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. RPC opname stok: input stok fisik, hitung selisih, catat ADJUSTMENT
-- ----------------------------------------------------------------------------
create or replace function public.kasir_opname_stock(
  p_product_id uuid,
  p_stok_fisik numeric,
  p_keterangan text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user    uuid := auth.uid();
  v_sebelum numeric;
  v_sesudah numeric;
  v_delta   numeric;
  v_tipe    text;
begin
  if v_user is null then
    raise exception 'Sesi tidak valid.';
  end if;
  if p_product_id is null or p_stok_fisik is null or p_stok_fisik < 0 then
    raise exception 'Stok fisik tidak valid.';
  end if;

  select stock into v_sebelum
    from public.kasir_products
   where id = p_product_id and user_id = v_user
   for update;
  if v_sebelum is null then
    raise exception 'Produk tidak ditemukan.';
  end if;

  v_delta := round(p_stok_fisik - v_sebelum, 2);

  -- Tidak ada selisih: tidak perlu mencatat mutasi apa pun.
  if v_delta = 0 then
    return jsonb_build_object(
      'product_id', p_product_id,
      'stok_sebelum', v_sebelum,
      'stok_sesudah', v_sebelum,
      'delta', 0,
      'tipe', null
    );
  end if;

  v_tipe := case when v_delta > 0 then 'stok_masuk' else 'stok_keluar' end;

  update public.kasir_products
     set stock = p_stok_fisik, updated_at = now()
   where id = p_product_id and user_id = v_user
  returning stock into v_sesudah;

  insert into public.kasir_stock_logs
    (user_id, product_id, tipe, qty, stok_sebelum, stok_sesudah, keterangan, ref_id, ref_tipe)
  values
    (v_user, p_product_id, v_tipe, v_delta, v_sebelum, v_sesudah,
     coalesce(nullif(p_keterangan, ''), 'Stok opname'), null, null);

  return jsonb_build_object(
    'product_id', p_product_id,
    'stok_sebelum', v_sebelum,
    'stok_sesudah', v_sesudah,
    'delta', v_delta,
    'tipe', v_tipe
  );
end;
$$;

grant execute on function public.kasir_opname_stock(uuid, numeric, text)
  to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. RPC laporan pergerakan stok
-- ----------------------------------------------------------------------------
--  p_from / p_to : tanggal 'YYYY-MM-DD' (inklusif). p_to mencakup seharian.
--  p_product_id  : filter satu barang (opsional).
--  p_jenis       : PENJUALAN | PEMBELIAN | ADJUSTMENT | RETUR | PEMBATALAN.
--  p_q           : cari nama / kode barang.
create or replace function public.kasir_stock_movements(
  p_from       text default null,
  p_to         text default null,
  p_product_id uuid default null,
  p_jenis      text default null,
  p_q          text default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with dasar as (
    select
      s.id,
      s.created_at,
      s.product_id,
      p.barcode,
      p.name as product_name,
      p.unit,
      s.tipe,
      s.ref_tipe,
      s.qty,
      s.stok_sebelum,
      s.stok_sesudah,
      s.keterangan,
      case
        when s.tipe = 'terjual' then 'PENJUALAN'
        when s.tipe = 'retur' then 'RETUR'
        when s.tipe = 'void' then 'PEMBATALAN'
        when s.ref_tipe = 'pembelian' and s.tipe = 'stok_masuk' then 'PEMBELIAN'
        when s.ref_tipe = 'pembelian' and s.tipe = 'stok_keluar' then 'PEMBATALAN'
        when s.ref_tipe is null and s.tipe = 'stok_masuk' then 'ADJUSTMENT'
        when s.ref_tipe is null and s.tipe = 'stok_keluar' then 'ADJUSTMENT'
        else 'LAINNYA'
      end as jenis,
      coalesce(t.invoice_no, pu.invoice_no, r.retur_no) as no_referensi
    from public.kasir_stock_logs s
    join public.kasir_products p on p.id = s.product_id
    left join public.kasir_transactions t
      on s.ref_tipe = 'transaksi' and t.id = s.ref_id
    left join public.kasir_purchases pu
      on s.ref_tipe = 'pembelian' and pu.id = s.ref_id
    left join public.kasir_returns r
      on s.ref_tipe = 'retur' and r.id = s.ref_id
    where s.user_id = auth.uid()
      and (p_from is null or p_from = '' or s.created_at >= p_from::timestamptz)
      and (p_to   is null or p_to   = '' or s.created_at < (p_to::date + interval '1 day'))
      and (p_product_id is null or s.product_id = p_product_id)
      and (
        p_q is null or p_q = ''
        or p.name ilike '%' || p_q || '%'
        or coalesce(p.barcode, '') ilike '%' || p_q || '%'
      )
  ),
  filtered as (
    select *
    from dasar
    where p_jenis is null or p_jenis = '' or jenis = p_jenis
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', f.id,
        'created_at', f.created_at,
        'product_id', f.product_id,
        'barcode', f.barcode,
        'product_name', f.product_name,
        'unit', f.unit,
        'jenis', f.jenis,
        'no_referensi', f.no_referensi,
        'masuk', case when f.qty > 0 then f.qty else 0 end,
        'keluar', case when f.qty < 0 then -f.qty else 0 end,
        'stok_sebelum', f.stok_sebelum,
        'stok_sesudah', f.stok_sesudah,
        'keterangan', f.keterangan
      )
      order by f.created_at desc, f.product_name
    ),
    '[]'::jsonb
  )
  from filtered f;
$$;

grant execute on function public.kasir_stock_movements(text, text, uuid, text, text)
  to authenticated, service_role;
