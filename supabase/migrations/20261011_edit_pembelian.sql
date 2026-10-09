-- ============================================================================
--  EDIT PEMBELIAN (PO Sederhana)
-- ============================================================================
--  Menambah RPC kasir_update_purchase untuk mengubah PO yang sudah tersimpan:
--    - Supplier, status, catatan, dan SELURUH item ikut diganti.
--    - Stok produk disesuaikan sebesar SELISIH (qty baru - qty lama), bukan
--      ditambah ulang — supaya kartu stok & Pergerakan Stok tetap rekonsiliasi.
--    - No Faktur tetap (tidak menerbitkan transaksi/faktur baru).
--
--  Idempotent: aman dijalankan berulang di Supabase -> SQL Editor.
-- ============================================================================

create or replace function public.kasir_update_purchase(
  p_id            uuid,
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
  v_user    uuid := auth.uid();
  v_owner   uuid;
  v_invoice text;
  v_total   numeric := 0;
  v_status  text;
  v_item    record;
  v_pid     uuid;
  v_qty     numeric;
  v_cost    numeric;
  v_sub     numeric;
  v_unit    text;
  v_delta   numeric;
  v_sebelum numeric;
  v_sesudah numeric;
begin
  if v_user is null then raise exception 'Harus login.'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Minimal satu item pembelian.';
  end if;

  select user_id, invoice_no into v_owner, v_invoice
    from public.kasir_purchases
   where id = p_id
   for update;
  if v_owner is null then raise exception 'Pembelian tidak ditemukan.'; end if;
  if v_owner <> v_user then raise exception 'Bukan milik pengguna ini.'; end if;

  v_status := case when p_status = 'hutang' then 'hutang' else 'lunas' end;

  -- --------------------------------------------------------------------------
  -- 1. Sesuaikan stok per produk sebesar selisih qty baru - qty lama.
  -- --------------------------------------------------------------------------
  for v_item in
    with lama as (
      select product_id, sum(qty) as qty
        from public.kasir_purchase_items
       where purchase_id = p_id
         and product_id is not null
       group by product_id
    ),
    baru as (
      select (e.value->>'product_id')::uuid as product_id,
             sum(greatest(coalesce((e.value->>'qty')::numeric, 0), 0)) as qty
        from jsonb_array_elements(p_items) e
       where nullif(coalesce(e.value->>'product_id', ''), '') is not null
       group by 1
    ),
    gab as (
      select coalesce(l.product_id, b.product_id) as product_id,
             coalesce(b.qty, 0) - coalesce(l.qty, 0) as delta
        from lama l
        full outer join baru b on l.product_id = b.product_id
    )
    select product_id, delta from gab where delta <> 0
  loop
    v_delta := v_item.delta;
    select stock into v_sebelum
      from public.kasir_products
     where id = v_item.product_id and user_id = v_user
     for update;

    if v_sebelum is not null then
      -- Jangan biarkan stok negatif; catat perubahan yang benar-benar terjadi.
      v_sesudah := greatest(v_sebelum + v_delta, 0);
      update public.kasir_products
         set stock = v_sesudah, updated_at = now()
       where id = v_item.product_id and user_id = v_user;

      if v_sesudah <> v_sebelum then
        insert into public.kasir_stock_logs
          (user_id, product_id, tipe, qty, stok_sebelum, stok_sesudah,
           keterangan, ref_id, ref_tipe)
        values
          (v_user, v_item.product_id,
           case when v_sesudah > v_sebelum then 'stok_masuk' else 'stok_keluar' end,
           v_sesudah - v_sebelum, v_sebelum, v_sesudah,
           'Edit pembelian ' || coalesce(p_supplier_name, ''),
           p_id, 'pembelian');
      end if;
    end if;
  end loop;

  -- --------------------------------------------------------------------------
  -- 2. Ganti seluruh item PO dengan item hasil edit.
  -- --------------------------------------------------------------------------
  delete from public.kasir_purchase_items where purchase_id = p_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty  := greatest(coalesce((v_item.value->>'qty')::numeric, 0), 0);
    v_cost := greatest(coalesce((v_item.value->>'cost')::numeric, 0), 0);
    v_sub  := round(v_qty * v_cost, 2);
    v_total := v_total + v_sub;
    v_pid  := nullif(coalesce((v_item.value->>'product_id')::text, ''), '')::uuid;
    v_unit := nullif(coalesce((v_item.value->>'unit')::text, ''), '');

    insert into public.kasir_purchase_items
      (purchase_id, user_id, product_id, product_name, qty, cost, subtotal, unit)
    values
      (p_id, v_user, v_pid,
       coalesce((v_item.value->>'name')::text, 'Item'),
       v_qty, v_cost, v_sub, v_unit);
  end loop;

  -- --------------------------------------------------------------------------
  -- 3. Update header PO (No Faktur tetap).
  -- --------------------------------------------------------------------------
  update public.kasir_purchases
     set supplier_id   = p_supplier_id,
         supplier_name = p_supplier_name,
         total         = v_total,
         note          = nullif(coalesce(p_note, ''), ''),
         status        = v_status
   where id = p_id;

  return jsonb_build_object(
    'id', p_id,
    'total', v_total,
    'invoice_no', v_invoice,
    'status', v_status
  );
end;
$$;

grant execute on function public.kasir_update_purchase(uuid, text, uuid, jsonb, text, text)
  to authenticated, service_role;
