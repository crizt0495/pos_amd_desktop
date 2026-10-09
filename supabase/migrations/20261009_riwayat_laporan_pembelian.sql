-- ============================================================================
--  RIWAYAT & LAPORAN PEMBELIAN
-- ============================================================================
--  Menyiapkan data yang dibutuhkan modul baru:
--    Pembelian > Riwayat           (No Faktur, Status Lunas/Hutang, detail)
--    Laporan   > Laporan Pembelian (rekap supplier & barang, export)
--
--  Perubahan:
--    1. kasir_purchases.invoice_no  -> No Faktur "PO-YYMMDD-NNNNN" (unik)
--    2. kasir_purchases.status      -> 'lunas' | 'hutang'
--    3. kasir_purchase_items.unit   -> satuan saat pembelian (untuk detail)
--    4. Backfill invoice_no untuk data lama
--    5. RPC kasir_create_purchase   -> + p_status, isi invoice_no & unit
--    6. RPC kasir_delete_purchase   -> hapus PO + balikkan stok (atomik)
--
--  Idempotent: aman dijalankan berulang di Supabase → SQL Editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Kolom baru
-- ----------------------------------------------------------------------------
alter table public.kasir_purchases
  add column if not exists invoice_no text;

alter table public.kasir_purchases
  add column if not exists status text not null default 'lunas';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'kasir_purchases_status_chk'
  ) then
    alter table public.kasir_purchases
      add constraint kasir_purchases_status_chk check (status in ('lunas', 'hutang'));
  end if;
end $$;

alter table public.kasir_purchase_items
  add column if not exists unit text;

-- ----------------------------------------------------------------------------
-- 2. No Faktur: urutan + backfill data lama
-- ----------------------------------------------------------------------------
create sequence if not exists public.kasir_purchase_invoice_seq;

with n as (
  select id, row_number() over (order by created_at, id) as rn
  from public.kasir_purchases
  where invoice_no is null
)
update public.kasir_purchases p
   set invoice_no = 'PO-' || to_char(p.created_at, 'YYMMDD') || '-' || lpad(n.rn::text, 5, '0')
  from n
 where n.id = p.id;

create unique index if not exists kasir_purchases_invoice_no
  on public.kasir_purchases (invoice_no);

create index if not exists kasir_purchases_user_created
  on public.kasir_purchases (user_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 3. RPC create (signature lama tanpa p_status diganti)
-- ----------------------------------------------------------------------------
drop function if exists public.kasir_create_purchase(text, uuid, jsonb, text);

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
           'Pembelian ' || coalesce(p_supplier_name, ''), v_purchase_id, 'retur');
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

-- ----------------------------------------------------------------------------
-- 4. RPC delete: balikkan stok lalu hapus PO (atomik)
-- ----------------------------------------------------------------------------
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
           'Hapus pembelian', p_id, 'retur');
      end if;
    end if;
  end loop;

  delete from public.kasir_purchases where id = p_id;
  return jsonb_build_object('id', p_id);
end;
$$;

grant execute on function public.kasir_delete_purchase(uuid)
  to authenticated, service_role;
