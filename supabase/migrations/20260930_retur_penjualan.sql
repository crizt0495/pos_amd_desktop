-- ============================================================================
--  Migrasi: Retur Penjualan (stok kembali + laporan retur)
--  Fitur roadmap: "melampaui iPOS" #2
--
--  Script IDEMPOTENT — aman dijalankan berulang kali dan untuk DB yang sudah
--  berisi transaksi. Tidak menghapus/mengubah data lama.
--
--  Jalankan di Supabase SQL Editor, atau via psql:
--    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260930_retur_penjualan.sql
--
--  Isi:
--    1. kasir_returns        (header retur: no retur RET-YYYYMMDD-0001)
--    2. kasir_return_items   (baris retur + refund proporsional potongan)
--    3. RLS + indeks
--    4. RPC kasir_create_return (atomik: validasi, simpan, stok kembali)
--
--  Ketentuan refund per baris = harga x qty_retur - potongan_proporsional,
--  SAMA DENGAN rumus di aplikasi (ReturModal). Diskon transaksi (header)
--  tidak diproporsikan ke retur.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Header retur
-- ---------------------------------------------------------------------------
create table if not exists public.kasir_returns (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  transaction_id uuid not null references public.kasir_transactions (id) on delete cascade,
  invoice_no     text not null,
  retur_no       text not null,
  total          numeric not null default 0,
  cashier_name   text,
  note           text,
  created_at     timestamptz not null default now()
);

create unique index if not exists kasir_returns_user_no on public.kasir_returns (user_id, retur_no);
create index        if not exists kasir_returns_user    on public.kasir_returns (user_id, created_at desc);
create index        if not exists kasir_returns_tx      on public.kasir_returns (transaction_id);

-- ---------------------------------------------------------------------------
-- 2. Baris retur
-- ---------------------------------------------------------------------------
create table if not exists public.kasir_return_items (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  return_id          uuid not null references public.kasir_returns (id) on delete cascade,
  transaction_item_id uuid,
  product_id         uuid,
  product_name       text not null,
  price              numeric not null default 0,
  cost               numeric not null default 0,
  qty                numeric not null default 0,
  discount           numeric not null default 0,  -- potongan baris proporsional
  refund             numeric not null default 0
);

create index if not exists kasir_return_items_ret on public.kasir_return_items (return_id);
create index if not exists kasir_return_items_ti  on public.kasir_return_items (transaction_item_id);
create index if not exists kasir_return_items_user on public.kasir_return_items (user_id);

-- ---------------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------------
alter table public.kasir_returns      enable row level security;
alter table public.kasir_return_items enable row level security;

drop policy if exists kasir_returns_select on public.kasir_returns;
create policy kasir_returns_select on public.kasir_returns
  for select using (user_id = auth.uid());
drop policy if exists kasir_returns_insert on public.kasir_returns;
create policy kasir_returns_insert on public.kasir_returns
  for insert with check (user_id = auth.uid());

drop policy if exists kasir_return_items_select on public.kasir_return_items;
create policy kasir_return_items_select on public.kasir_return_items
  for select using (user_id = auth.uid());
drop policy if exists kasir_return_items_insert on public.kasir_return_items;
create policy kasir_return_items_insert on public.kasir_return_items
  for insert with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 4. RPC — simpan retur (atomik)
-- ---------------------------------------------------------------------------
create or replace function public.kasir_create_return(
  p_tx_id uuid,
  p_items jsonb,
  p_note  text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user     uuid := auth.uid();
  v_tx       public.kasir_transactions%rowtype;
  v_item     record;
  v_it       public.kasir_transaction_items%rowtype;
  v_qty      numeric;
  v_prev     numeric;
  v_total    numeric := 0;
  v_retur_no text;
  v_n        int;
  v_retur_id uuid;
  v_retur    public.kasir_returns%rowtype;
  v_disc     numeric;
  v_refund   numeric;
begin
  if v_user is null then
    raise exception 'Sesi tidak valid.';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Tidak ada item yang diretur.';
  end if;

  select * into v_tx from public.kasir_transactions
   where id = p_tx_id and user_id = v_user;
  if v_tx.id is null then
    raise exception 'Transaksi tidak ditemukan.';
  end if;
  if v_tx.status = 'void' then
    raise exception 'Transaksi sudah dibatalkan, tidak bisa diretur.';
  end if;

  -- nomor retur harian: RET-YYYYMMDD-0001
  select count(*) into v_n
    from public.kasir_returns
   where user_id = v_user
     and retur_no like 'RET-' || to_char(now(), 'YYYYMMDD') || '-%';
  v_retur_no := 'RET-' || to_char(now(), 'YYYYMMDD') || '-'
             || lpad((v_n + 1)::text, 4, '0');

  insert into public.kasir_returns
    (user_id, transaction_id, invoice_no, retur_no, total, cashier_name, note)
  values
    (v_user, p_tx_id, v_tx.invoice_no, v_retur_no, 0,
     coalesce(v_tx.cashier_name, 'Kasir'),
     nullif(coalesce(p_note, ''), ''))
  returning id into v_retur_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_it
      from public.kasir_transaction_items
     where id = nullif(coalesce((v_item.value->>'transaction_item_id')::text, ''), '')::uuid
       and transaction_id = p_tx_id
       and user_id = v_user;
    if v_it.id is null then
      raise exception 'Item transaksi tidak ditemukan.';
    end if;

    v_qty := round(coalesce((v_item.value->>'qty')::numeric, 0), 2);
    if v_qty <= 0 then
      continue;
    end if;

    -- sudah berapa yang pernah diretur untuk baris item ini
    select coalesce(sum(qty), 0) into v_prev
      from public.kasir_return_items
     where transaction_item_id = v_it.id
       and user_id = v_user;

    if v_prev + v_qty > v_it.qty + 0.01 then
      raise exception 'Qty retur melebihi sisa terjual (% + % > %).',
        to_char(v_prev, 'FM9990.00'), to_char(v_qty, 'FM9990.00'), to_char(v_it.qty, 'FM9990.00');
    end if;

    -- refund proporsional dengan potongan baris asal (lihat header file)
    v_disc   := round(v_it.discount * v_qty / greatest(v_it.qty, 1), 2);
    v_refund := round(v_it.price * v_qty - v_disc, 2);

    insert into public.kasir_return_items
      (user_id, return_id, transaction_item_id, product_id, product_name,
       price, cost, qty, discount, refund)
    values
      (v_user, v_retur_id, v_it.id, v_it.product_id, v_it.product_name,
       v_it.price, v_it.cost, v_qty, v_disc, v_refund);

    v_total := v_total + v_refund;

    -- stok kembali
    if v_it.product_id is not null then
      update public.kasir_products
         set stock = stock + v_qty,
             updated_at = now()
       where id = v_it.product_id
         and user_id = v_user;
    end if;
  end loop;

  if v_total = 0 then
    raise exception 'Tidak ada item yang diretur.';
  end if;

  update public.kasir_returns set total = v_total where id = v_retur_id;
  select * into v_retur from public.kasir_returns where id = v_retur_id;
  return jsonb_build_object('return', to_jsonb(v_retur), 'total', v_total);
end;
$$;

commit;

-- ============================================================================
--  Verifikasi (jalankan terpisah setelah commit)
-- ============================================================================
-- select table_name from information_schema.tables
--  where table_schema = 'public' and table_name in ('kasir_returns', 'kasir_return_items')
--  order by 1;
-- -- expect 2 baris
--
-- select p.proname, pg_get_function_identity_arguments(p.oid) as args
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and p.proname = 'kasir_create_return';
-- -- expect kasir_create_return | (p_tx_id uuid, p_items jsonb, p_note text)