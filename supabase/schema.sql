-- ============================================================================
--  KasirPro POS — Supabase schema (idempotent)
-- ============================================================================
--  PUBLIK: aplikasi kasir web. Data milik per user (auth.uid()), RLS aktif.
--  Bagian:
--    1. Tabel  : kasir_products, kasir_transactions, kasir_transaction_items,
--                kasir_settings
--    2. RLS    : policies select/insert/update/delete berdasar user_id
--    3. RPC    : transaksi atomik (create/void) + laporan
--
--  Cara pakai: buka Supabase > SQL Editor > New query, tempel seluruh isi
--  file ini, lalu RUN. Bisa dijalankan ulang kapan saja (idempotent).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. TABEL
-- ----------------------------------------------------------------------------

create table if not exists public.kasir_products (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  barcode    text,
  name       text not null,
  category   text not null default 'Umum',
  price      numeric not null default 0 check (price >= 0),
  cost       numeric not null default 0 check (cost >= 0),
  stock      numeric not null default 0,
  min_stock  numeric not null default 0,
  unit       text not null default 'pcs',
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists kasir_products_user      on public.kasir_products (user_id);
create index if not exists kasir_products_user_name on public.kasir_products (user_id, lower(name));
create index if not exists kasir_products_user_bc   on public.kasir_products (user_id, barcode);

create table if not exists public.kasir_transactions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  invoice_no      text not null,
  subtotal        numeric not null default 0,
  discount_type   text not null default 'none',
  discount_value  numeric not null default 0,
  discount_amount numeric not null default 0,
  total           numeric not null default 0,
  total_cost      numeric not null default 0,
  paid            numeric not null default 0,
  change_due      numeric not null default 0,
  payment_method  text not null default 'cash',
  note            text,
  cashier_name    text,
  status          text not null default 'completed',
  created_at      timestamptz not null default now(),
  unique (user_id, invoice_no)
);

create index if not exists kasir_transactions_user on public.kasir_transactions (user_id, created_at desc);
create index if not exists kasir_transactions_stat on public.kasir_transactions (user_id, status);

create table if not exists public.kasir_transaction_items (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  transaction_id uuid not null references public.kasir_transactions (id) on delete cascade,
  product_id     uuid,
  barcode        text,
  product_name   text not null,
  price          numeric not null default 0,
  cost           numeric not null default 0,
  qty            numeric not null default 1,
  discount       numeric not null default 0,
  subtotal       numeric not null default 0
);

create index if not exists kasir_items_transaction on public.kasir_transaction_items (transaction_id);
create index if not exists kasir_items_user          on public.kasir_transaction_items (user_id);

create table if not exists public.kasir_settings (
  user_id  uuid not null references auth.users (id) on delete cascade,
  key      text not null,
  value    jsonb,
  primary key (user_id, key)
);

-- ----------------------------------------------------------------------------
-- 2. ROW LEVEL SECURITY
-- ----------------------------------------------------------------------------

alter table public.kasir_products         enable row level security;
alter table public.kasir_transactions     enable row level security;
alter table public.kasir_transaction_items enable row level security;
alter table public.kasir_settings         enable row level security;

-- kasir_products
drop policy if exists kasir_products_select on public.kasir_products;
create policy kasir_products_select on public.kasir_products
  for select using (user_id = auth.uid());
drop policy if exists kasir_products_insert on public.kasir_products;
create policy kasir_products_insert on public.kasir_products
  for insert with check (user_id = auth.uid());
drop policy if exists kasir_products_update on public.kasir_products;
create policy kasir_products_update on public.kasir_products
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists kasir_products_delete on public.kasir_products;
create policy kasir_products_delete on public.kasir_products
  for delete using (user_id = auth.uid());

-- kasir_transactions
drop policy if exists kasir_transactions_select on public.kasir_transactions;
create policy kasir_transactions_select on public.kasir_transactions
  for select using (user_id = auth.uid());
drop policy if exists kasir_transactions_insert on public.kasir_transactions;
create policy kasir_transactions_insert on public.kasir_transactions
  for insert with check (user_id = auth.uid());
drop policy if exists kasir_transactions_update on public.kasir_transactions;
create policy kasir_transactions_update on public.kasir_transactions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists kasir_transactions_delete on public.kasir_transactions;
create policy kasir_transactions_delete on public.kasir_transactions
  for delete using (user_id = auth.uid());

-- kasir_transaction_items
drop policy if exists kasir_items_select on public.kasir_transaction_items;
create policy kasir_items_select on public.kasir_transaction_items
  for select using (user_id = auth.uid());
drop policy if exists kasir_items_insert on public.kasir_transaction_items;
create policy kasir_items_insert on public.kasir_transaction_items
  for insert with check (user_id = auth.uid());
drop policy if exists kasir_items_update on public.kasir_transaction_items;
create policy kasir_items_update on public.kasir_transaction_items
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists kasir_items_delete on public.kasir_transaction_items;
create policy kasir_items_delete on public.kasir_transaction_items
  for delete using (user_id = auth.uid());

-- kasir_settings
drop policy if exists kasir_settings_select on public.kasir_settings;
create policy kasir_settings_select on public.kasir_settings
  for select using (user_id = auth.uid());
drop policy if exists kasir_settings_insert on public.kasir_settings;
create policy kasir_settings_insert on public.kasir_settings
  for insert with check (user_id = auth.uid());
drop policy if exists kasir_settings_update on public.kasir_settings;
create policy kasir_settings_update on public.kasir_settings
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists kasir_settings_delete on public.kasir_settings;
create policy kasir_settings_delete on public.kasir_settings
  for delete using (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 3. RPC — TRANSAKSI (atomik)
-- ----------------------------------------------------------------------------

-- Simpan transaksi + item + potong stok dalam SATU transaksi database.
-- Menghitung ulang semua total dari keranjang (tidak percaya nilai klien).
create or replace function public.kasir_create_transaction(
  p_lines          jsonb,
  p_discount_type  text,
  p_discount_value numeric,
  p_payment_method text,
  p_paid           numeric,
  p_note           text,
  p_cashier_name   text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user       uuid := auth.uid();
  v_item       record;
  v_subtotal   numeric := 0;
  v_total_cost numeric := 0;
  v_discount   numeric := 0;
  v_total      numeric := 0;
  v_paid       numeric;
  v_change     numeric := 0;
  v_invoice    text;
  v_n          int;
  v_tx_id      uuid;
  v_tx         public.kasir_transactions%rowtype;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Keranjang masih kosong.';
  end if;
  if v_user is null then
    raise exception 'Sesi tidak valid.';
  end if;

  -- hitung subtotal & total cost dari keranjang
  for v_item in select * from jsonb_array_elements(p_lines) loop
    v_subtotal   := v_subtotal
      + round((coalesce((v_item.value->>'price')::numeric, 0)
             - coalesce((v_item.value->>'discount')::numeric, 0))
             * greatest(coalesce((v_item.value->>'qty')::numeric, 0), 0), 2);
    v_total_cost := v_total_cost
      + coalesce((v_item.value->>'cost')::numeric, 0)
        * greatest(coalesce((v_item.value->>'qty')::numeric, 0), 0);
  end loop;

  -- diskon (sama dengan logika di aplikasi)
  if p_discount_type = 'percent' then
    v_discount := round((v_subtotal * least(greatest(coalesce(p_discount_value, 0), 0), 100)) / 100, 2);
  elsif p_discount_type = 'fixed' then
    v_discount := least(greatest(coalesce(p_discount_value, 0), 0), v_subtotal);
  end if;

  v_total := greatest(0, round(v_subtotal - v_discount, 2));
  v_paid  := round(coalesce(p_paid, v_total), 2);
  if v_paid < v_total then
    raise exception 'Nominal bayar kurang dari total belanja.';
  end if;
  v_change := greatest(0, round(v_paid - v_total, 2));

  -- nomor invoice harian: INV-YYYYMMDD-0001
  select count(*) into v_n
    from public.kasir_transactions
   where user_id = v_user
     and invoice_no like 'INV-' || to_char(now(), 'YYYYMMDD') || '-%';
  v_invoice := 'INV-' || to_char(now(), 'YYYYMMDD') || '-'
             || lpad((v_n + 1)::text, 4, '0');

  insert into public.kasir_transactions
    (user_id, invoice_no, subtotal, discount_type, discount_value, discount_amount,
     total, total_cost, paid, change_due, payment_method, note, cashier_name, status)
  values
    (v_user, v_invoice, v_subtotal, coalesce(p_discount_type, 'none'),
     coalesce(p_discount_value, 0), v_discount, v_total, v_total_cost,
     v_paid, v_change, coalesce(p_payment_method, 'cash'),
     nullif(coalesce(p_note, ''), ''), coalesce(p_cashier_name, 'Kasir'), 'completed')
  returning id into v_tx_id;

  for v_item in select * from jsonb_array_elements(p_lines) loop
    insert into public.kasir_transaction_items
      (user_id, transaction_id, product_id, barcode, product_name, price, cost,
       qty, discount, subtotal)
    values
      (v_user, v_tx_id,
       nullif(coalesce((v_item.value->>'product_id')::text, ''), '')::uuid,
       nullif(coalesce((v_item.value->>'barcode')::text, ''), ''),
       coalesce((v_item.value->>'name')::text, 'Item'),
       coalesce((v_item.value->>'price')::numeric, 0),
       coalesce((v_item.value->>'cost')::numeric, 0),
       greatest(coalesce((v_item.value->>'qty')::numeric, 1), 0),
       coalesce((v_item.value->>'discount')::numeric, 0),
       round((coalesce((v_item.value->>'price')::numeric, 0)
            - coalesce((v_item.value->>'discount')::numeric, 0))
            * greatest(coalesce((v_item.value->>'qty')::numeric, 1), 0), 2));

    -- potong stok hanya untuk produk terdaftar
    if coalesce((v_item.value->>'product_id')::text, '') <> '' then
      update public.kasir_products
         set stock = greatest(0, stock - greatest(coalesce((v_item.value->>'qty')::numeric, 1), 0)),
             updated_at = now()
       where id = nullif((v_item.value->>'product_id')::text, '')::uuid
         and user_id = v_user;
    end if;
  end loop;

  select * into v_tx from public.kasir_transactions where id = v_tx_id;
  return jsonb_build_object(
    'transaction', to_jsonb(v_tx),
    'totals', jsonb_build_object(
      'subtotal', v_subtotal, 'discountAmount', v_discount, 'total', v_total,
      'totalCost', v_total_cost, 'profit', round(v_total - v_total_cost, 2)),
    'changeDue', v_change
  );
end;
$$;

-- Batalkan transaksi: tandai void + kembalikan stok (atomik)
create or replace function public.kasir_void_transaction(p_tx_id uuid)
returns public.kasir_transactions
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tx public.kasir_transactions%rowtype;
  v_item record;
begin
  select * into v_tx from public.kasir_transactions
   where id = p_tx_id and user_id = auth.uid();
  if v_tx.id is null then
    raise exception 'Transaksi tidak ditemukan.';
  end if;
  if v_tx.status = 'void' then
    return v_tx;
  end if;

  for v_item in
    select * from public.kasir_transaction_items
     where transaction_id = p_tx_id and user_id = auth.uid()
  loop
    if v_item.product_id is not null then
      update public.kasir_products
         set stock = stock + v_item.qty,
             updated_at = now()
       where id = v_item.product_id and user_id = auth.uid();
    end if;
  end loop;

  update public.kasir_transactions set status = 'void' where id = p_tx_id;
  select * into v_tx from public.kasir_transactions where id = p_tx_id;
  return v_tx;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. RPC — LAPORAN
-- ----------------------------------------------------------------------------
-- p_from / p_to = timestamp ISO opsional (null = tanpa batas).
-- Laporan hanya menghitung transaksi status 'completed'.

create or replace function public.kasir_report_summary(p_from text, p_to text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row record;
  v_item numeric;
  v_rata numeric;
begin
  select
    count(*)                       as jumlah_transaksi,
    coalesce(sum(total), 0)        as total_omzet,
    coalesce(sum(total - total_cost), 0) as total_laba,
    coalesce(sum(discount_amount), 0)    as total_diskon,
    coalesce(sum(paid), 0)         as total_terima
  into v_row
  from public.kasir_transactions t
  where user_id = auth.uid()
    and t.status = 'completed'
    and (p_from is null or t.created_at >= p_from::timestamptz)
    and (p_to   is null or t.created_at <= p_to::timestamptz);

  select coalesce(sum(i.qty), 0) into v_item
  from public.kasir_transaction_items i
  join public.kasir_transactions t on t.id = i.transaction_id
  where t.user_id = auth.uid()
    and t.status = 'completed'
    and (p_from is null or t.created_at >= p_from::timestamptz)
    and (p_to   is null or t.created_at <= p_to::timestamptz);

  v_rata := case when v_row.jumlah_transaksi > 0
    then round(v_row.total_omzet / v_row.jumlah_transaksi, 2) else 0 end;

  return jsonb_build_object(
    'jumlah_transaksi', v_row.jumlah_transaksi,
    'total_omzet',       round(v_row.total_omzet, 2),
    'total_laba',        round(v_row.total_laba, 2),
    'total_diskon',      round(v_row.total_diskon, 2),
    'total_terima',      round(v_row.total_terima, 2),
    'total_item',        round(v_item, 2),
    'rata_rata',         v_rata
  );
end;
$$;

create or replace function public.kasir_report_top(p_from text, p_to text, p_limit int default 10)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_rows
  from (
    select i.product_name as name, i.product_id as product_id,
           round(sum(i.qty), 2) as qty,
           round(sum(i.subtotal), 2) as omzet
    from public.kasir_transaction_items i
    join public.kasir_transactions t on t.id = i.transaction_id
    where t.user_id = auth.uid()
      and t.status = 'completed'
      and (p_from is null or t.created_at >= p_from::timestamptz)
      and (p_to   is null or t.created_at <= p_to::timestamptz)
    group by i.product_name, i.product_id
    order by qty desc
    limit least(greatest(coalesce(p_limit, 10), 1), 100)
  ) r;
  return v_rows;
end;
$$;

create or replace function public.kasir_report_daily(p_from text, p_to text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_rows
  from (
    select t.created_at::date::text as tanggal,
           count(*) as transaksi,
           round(sum(t.total), 2) as omzet,
           round(sum(t.total - t.total_cost), 2) as laba
    from public.kasir_transactions t
    where t.user_id = auth.uid()
      and t.status = 'completed'
      and (p_from is null or t.created_at >= p_from::timestamptz)
      and (p_to   is null or t.created_at <= p_to::timestamptz)
    group by tanggal
    order by tanggal asc
  ) r;
  return v_rows;
end;
$$;

create or replace function public.kasir_report_by_payment(p_from text, p_to text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_rows
  from (
    select t.payment_method as metode,
           count(*) as n,
           round(sum(t.total), 2) as omzet
    from public.kasir_transactions t
    where t.user_id = auth.uid()
      and t.status = 'completed'
      and (p_from is null or t.created_at >= p_from::timestamptz)
      and (p_to   is null or t.created_at <= p_to::timestamptz)
    group by t.payment_method
    order by omzet desc
  ) r;
  return v_rows;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. PRODUK CONTOH (opsional — jalankan bila toko demo belum punya produk)
--    Produk otomatis juga dibuat sisi aplikasi saat daftar pertama kali kosong.
-- ----------------------------------------------------------------------------
-- insert into public.kasir_products (user_id, barcode, name, category, price, cost, stock, min_stock, unit)
-- select id, '8991002101015', 'Indomie Goreng', 'Makanan', 3500, 3000, 40, 10, 'pcs' from auth.users where email = 'toko@contoh.com'
-- union all
-- select id, '8992760223014', 'Susu Ultra 250ml', 'Minuman', 8000, 6500, 24, 6, 'pcs' from auth.users where email = 'toko@contoh.com'
-- union all
-- select id, '8999999030001', 'Air Mineral 600ml', 'Minuman', 4000, 3000, 48, 12, 'btl' from auth.users where email = 'toko@contoh.com';

-- ----------------------------------------------------------------------------
-- 5. AKUN LOGIN PER LISENSI (dipakai POS web / pos_amd_desktop)
--
-- Login POS memakai Serial Key (lisensi) dari Portal, bukan username/password.
-- Server (service role) mencatat akun GoTrue per lisensi di tabel ini supaya
-- sesi & RLS tetap per user (auth.uid()). Tabel diakses HANYA oleh service_role;
-- anon/authenticated diblokir penuh (tanpa RLS policy apa pun).
-- ----------------------------------------------------------------------------
create table if not exists public.kasir_license_accounts (
  serial_key   text        primary key,
  app_email    text        not null,
  app_password text        not null,
  created_at   timestamptz not null default now()
);

alter table public.kasir_license_accounts enable row level security;

revoke all on table public.kasir_license_accounts from anon, authenticated;
grant select, insert, update on table public.kasir_license_accounts to service_role;

-- Serial Key DEMO khusus POS web (KPRO-DEMO-* selalu boleh masuk, tanpa kunci
-- perangkat). Dibuat bila partner demo (username 'demo') tersedia; idempotent.
insert into public.licenses (
  serial_key, partner_id, status, paket_type, license_type, pembeli_nama
)
select 'KPRO-DEMO-AAAA-0001', p.id, 'unused', 'bundle', 'sekali', 'Demo POS Web'
from public.partners p
where p.username = 'demo'
on conflict (serial_key) do nothing;