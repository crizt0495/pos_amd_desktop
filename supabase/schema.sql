-- ============================================================================
--  KasirPro POS — Supabase schema (idempotent)
-- ============================================================================
--  PUBLIK: aplikasi kasir web. Data milik per user (auth.uid()), RLS aktif.
--  Bagian:
--    1. Tabel  : kasir_products, kasir_transactions, kasir_transaction_items,
--                kasir_settings, kasir_customers, kasir_shifts,
--                kasir_returns, kasir_return_items, kasir_stock_logs
--    2. RLS    : policies select/insert/update/delete berdasar user_id
--    3. RPC    : transaksi atomik (create/void/retur) + laporan + kartu stok
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
  unit        text not null default 'pcs',
  satuan_list jsonb not null default '[]',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
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
  customer_name   text,
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
  subtotal       numeric not null default 0,
  -- Konversi satuan jual ke satuan dasar (Dus/6 = 6). Dipakai saatpotong/kembalikan stok.
  konversi       numeric not null default 1
);

create index if not exists kasir_items_transaction on public.kasir_transaction_items (transaction_id);
create index if not exists kasir_items_user          on public.kasir_transaction_items (user_id);

create table if not exists public.kasir_settings (
  user_id  uuid not null references auth.users (id) on delete cascade,
  key      text not null,
  value    jsonb,
  primary key (user_id, key)
);

-- Migrasi kolom baru untuk database yang sudah terisi (idempotent).
alter table public.kasir_products     add column if not exists satuan_list   jsonb not null default '[]';
alter table public.kasir_products     add column if not exists variants       jsonb not null default '[]';
alter table public.kasir_transactions add column if not exists customer_name text;
alter table public.kasir_transactions add column if not exists shift_id       uuid;
alter table public.kasir_transaction_items add column if not exists konversi numeric not null default 1;
-- Nama satuan jual saat transaksi dibuat (untuk cetak ulang struk/nota).
-- Data lama bernilai '' — struk lama tetap tampil tanpa kode satuan.
alter table public.kasir_transaction_items add column if not exists unit text not null default '';

create index if not exists kasir_transactions_shift on public.kasir_transactions (user_id, shift_id);

-- Pelanggan (dropdown "Pelanggan" di layar Kasir; default "Umum").
create table if not exists public.kasir_customers (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  phone      text,
  address    text,
  created_at timestamptz not null default now()
);

create unique index if not exists kasir_customers_user_name on public.kasir_customers (user_id, lower(name));
create index if not exists kasir_customers_user on public.kasir_customers (user_id);

-- Shift kasir (buka/tutup, modal awal, uang aktual di laci).
create table if not exists public.kasir_shifts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  cashier_name  text not null default 'Kasir',
  shift_no      text not null,
  opened_at     timestamptz not null default now(),
  closed_at     timestamptz,
  opening_cash  numeric not null default 0,
  closing_cash  numeric,
  expected_cash numeric,
  status        text not null default 'open' check (status in ('open', 'closed'))
);

create unique index if not exists kasir_shifts_user_no on public.kasir_shifts (user_id, shift_no);
create index if not exists kasir_shifts_user on public.kasir_shifts (user_id, opened_at desc);

-- Retur penjualan (stok kembali + laporan retur; nomor RET-YYYYMMDD-0001).
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

create table if not exists public.kasir_return_items (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  return_id           uuid not null references public.kasir_returns (id) on delete cascade,
  transaction_item_id uuid,
  product_id          uuid,
  product_name        text not null,
  price               numeric not null default 0,
  cost                numeric not null default 0,
  qty                 numeric not null default 0,
  discount            numeric not null default 0,  -- potongan baris proporsional
  refund              numeric not null default 0
);

create index if not exists kasir_return_items_ret  on public.kasir_return_items (return_id);
create index if not exists kasir_return_items_ti   on public.kasir_return_items (transaction_item_id);
create index if not exists kasir_return_items_user on public.kasir_return_items (user_id);

-- Kartu stok: buku besar mutasi stok (terjual/retur/stok masuk/stok keluar/void).
create table if not exists public.kasir_stock_logs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  product_id    uuid not null references public.kasir_products (id) on delete cascade,
  tipe          text not null check (tipe in ('terjual', 'retur', 'stok_masuk', 'stok_keluar', 'void')),
  qty           numeric not null default 0,   -- bertanda: + masuk, - keluar
  stok_sebelum  numeric,
  stok_sesudah  numeric,
  keterangan    text,
  ref_id        uuid,
  ref_tipe      text check (ref_tipe in ('transaksi', 'retur', 'pembelian')),
  created_at    timestamptz not null default now()
);

create index if not exists kasir_stock_logs_prod on public.kasir_stock_logs
  (user_id, product_id, created_at desc);
create index if not exists kasir_stock_logs_user on public.kasir_stock_logs
  (user_id, created_at desc);

-- Pergerakan Stok: pastikan nilai 'pembelian' diizinkan walau tabel sudah ada
-- dari versi lama (constraint inline di atas tidak otomatis berubah).
alter table public.kasir_stock_logs
  drop constraint if exists kasir_stock_logs_ref_tipe_check;
alter table public.kasir_stock_logs
  add constraint kasir_stock_logs_ref_tipe_check
  check (ref_tipe in ('transaksi', 'retur', 'pembelian'));

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

-- kasir_customers
alter table public.kasir_customers enable row level security;
drop policy if exists kasir_customers_select on public.kasir_customers;
create policy kasir_customers_select on public.kasir_customers
  for select using (user_id = auth.uid());
drop policy if exists kasir_customers_insert on public.kasir_customers;
create policy kasir_customers_insert on public.kasir_customers
  for insert with check (user_id = auth.uid());
drop policy if exists kasir_customers_update on public.kasir_customers;
create policy kasir_customers_update on public.kasir_customers
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists kasir_customers_delete on public.kasir_customers;
create policy kasir_customers_delete on public.kasir_customers
  for delete using (user_id = auth.uid());

-- kasir_shifts
alter table public.kasir_shifts enable row level security;
drop policy if exists kasir_shifts_select on public.kasir_shifts;
create policy kasir_shifts_select on public.kasir_shifts
  for select using (user_id = auth.uid());
drop policy if exists kasir_shifts_insert on public.kasir_shifts;
create policy kasir_shifts_insert on public.kasir_shifts
  for insert with check (user_id = auth.uid());
drop policy if exists kasir_shifts_update on public.kasir_shifts;
create policy kasir_shifts_update on public.kasir_shifts
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- kasir_returns
alter table public.kasir_returns enable row level security;
drop policy if exists kasir_returns_select on public.kasir_returns;
create policy kasir_returns_select on public.kasir_returns
  for select using (user_id = auth.uid());
drop policy if exists kasir_returns_insert on public.kasir_returns;
create policy kasir_returns_insert on public.kasir_returns
  for insert with check (user_id = auth.uid());

-- kasir_return_items
alter table public.kasir_return_items enable row level security;
drop policy if exists kasir_return_items_select on public.kasir_return_items;
create policy kasir_return_items_select on public.kasir_return_items
  for select using (user_id = auth.uid());
drop policy if exists kasir_return_items_insert on public.kasir_return_items;
create policy kasir_return_items_insert on public.kasir_return_items
  for insert with check (user_id = auth.uid());

-- kasir_stock_logs
alter table public.kasir_stock_logs enable row level security;
drop policy if exists kasir_stock_logs_select on public.kasir_stock_logs;
create policy kasir_stock_logs_select on public.kasir_stock_logs
  for select using (user_id = auth.uid());
drop policy if exists kasir_stock_logs_insert on public.kasir_stock_logs;
create policy kasir_stock_logs_insert on public.kasir_stock_logs
  for insert with check (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 3. RPC — TRANSAKSI (atomik)
-- ----------------------------------------------------------------------------

-- Simpan transaksi + item + potong stok dalam SATU transaksi database.
-- Menghitung ulang semua total dari keranjang (tidak percaya nilai klien).
-- (buang overload lama 7 & 8 param; versi 9 param menambah p_shift_id opsional)
drop function if exists public.kasir_create_transaction(jsonb, text, numeric, text, numeric, text, text);
drop function if exists public.kasir_create_transaction(jsonb, text, numeric, text, numeric, text, text, text);
create or replace function public.kasir_create_transaction(
  p_lines          jsonb,
  p_discount_type  text,
  p_discount_value numeric,
  p_payment_method text,
  p_paid           numeric,
  p_note           text,
  p_cashier_name   text,
  p_customer_name  text default null,
  p_shift_id       uuid default null
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
  v_pid        uuid;
  v_qty        numeric;
  v_sebelum    numeric;
  v_sesudah    numeric;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Keranjang masih kosong.';
  end if;
  if v_user is null then
    raise exception 'Sesi tidak valid.';
  end if;

  -- pastikan shift milik user & masih aktif (bila dikirim)
  if p_shift_id is not null then
    perform 1 from public.kasir_shifts
     where id = p_shift_id and user_id = v_user and status = 'open';
    if not found then
      raise exception 'Shift tidak aktif.';
    end if;
  end if;

  -- hitung subtotal & total cost dari keranjang
  -- potongan bersifat flat per baris: qty x harga - potongan (dibatasi 0)
  for v_item in select * from jsonb_array_elements(p_lines) loop
    v_subtotal   := v_subtotal
      + greatest(round(coalesce((v_item.value->>'price')::numeric, 0)
             * greatest(coalesce((v_item.value->>'qty')::numeric, 0), 0), 2)
             - coalesce((v_item.value->>'discount')::numeric, 0), 0);
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
     and invoice_no like 'INV-' || to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYYMMDD') || '-%';
  v_invoice := 'INV-' || to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYYMMDD') || '-'
             || lpad((v_n + 1)::text, 4, '0');

  insert into public.kasir_transactions
    (user_id, invoice_no, subtotal, discount_type, discount_value, discount_amount,
     total, total_cost, paid, change_due, payment_method, note, cashier_name,
     customer_name, status, shift_id)
  values
    (v_user, v_invoice, v_subtotal, coalesce(p_discount_type, 'none'),
     coalesce(p_discount_value, 0), v_discount, v_total, v_total_cost,
     v_paid, v_change, coalesce(p_payment_method, 'cash'),
     nullif(coalesce(p_note, ''), ''), coalesce(p_cashier_name, 'Kasir'),
     nullif(coalesce(p_customer_name, ''), ''), 'completed', p_shift_id)
  returning id into v_tx_id;

  for v_item in select * from jsonb_array_elements(p_lines) loop
    insert into public.kasir_transaction_items
      (user_id, transaction_id, product_id, barcode, product_name, price, cost,
       qty, discount, subtotal, konversi, unit)
    values
      (v_user, v_tx_id,
       nullif(coalesce((v_item.value->>'product_id')::text, ''), '')::uuid,
       nullif(coalesce((v_item.value->>'barcode')::text, ''), ''),
       coalesce((v_item.value->>'name')::text, 'Item'),
       coalesce((v_item.value->>'price')::numeric, 0),
       coalesce((v_item.value->>'cost')::numeric, 0),
       greatest(coalesce((v_item.value->>'qty')::numeric, 1), 0),
       coalesce((v_item.value->>'discount')::numeric, 0),
       greatest(round(coalesce((v_item.value->>'price')::numeric, 0)
            * greatest(coalesce((v_item.value->>'qty')::numeric, 1), 0), 2)
            - coalesce((v_item.value->>'discount')::numeric, 0), 0),
       coalesce((v_item.value->>'konversi')::numeric, 1),
       coalesce((v_item.value->>'unit')::text, ''));

    -- potong stok hanya untuk produk terdaftar + catat mutasi ke kartu stok.
    -- Konversi dipakai: jual 1 Dus mengurangi stok sebanyak konversi-nya.
    if coalesce((v_item.value->>'product_id')::text, '') <> '' then
      v_pid := nullif((v_item.value->>'product_id')::text, '')::uuid;
      v_qty := greatest(coalesce((v_item.value->>'qty')::numeric, 1), 0)
            * coalesce((v_item.value->>'konversi')::numeric, 1);
      select stock into v_sebelum
        from public.kasir_products
       where id = v_pid and user_id = v_user;
      if v_sebelum is not null then
        update public.kasir_products
           set stock = greatest(0, v_sebelum - v_qty),
               updated_at = now()
         where id = v_pid and user_id = v_user
        returning stock into v_sesudah;
        insert into public.kasir_stock_logs
          (user_id, product_id, tipe, qty, stok_sebelum, stok_sesudah,
           keterangan, ref_id, ref_tipe)
        values
          (v_user, v_pid, 'terjual', -v_qty, v_sebelum, v_sesudah,
           'Penjualan ' || v_invoice, v_tx_id, 'transaksi');
      end if;
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

-- Batalkan transaksi: tandai void + kembalikan stok (atomik) + catat mutasi
create or replace function public.kasir_void_transaction(p_tx_id uuid)
returns public.kasir_transactions
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user    uuid := auth.uid();
  v_tx      public.kasir_transactions%rowtype;
  v_item    record;
  v_sebelum numeric;
  v_sesudah numeric;
begin
  select * into v_tx from public.kasir_transactions
   where id = p_tx_id and user_id = v_user;
  if v_tx.id is null then
    raise exception 'Transaksi tidak ditemukan.';
  end if;
  if v_tx.status = 'void' then
    return v_tx;
  end if;

  for v_item in
    select * from public.kasir_transaction_items
     where transaction_id = p_tx_id and user_id = v_user
  loop
    if v_item.product_id is not null then
      select stock into v_sebelum
        from public.kasir_products
       where id = v_item.product_id and user_id = v_user;
      if v_sebelum is not null then
        update public.kasir_products
           set stock = v_sebelum + (v_item.qty * coalesce(v_item.konversi, 1)),
               updated_at = now()
         where id = v_item.product_id and user_id = v_user
        returning stock into v_sesudah;
        insert into public.kasir_stock_logs
          (user_id, product_id, tipe, qty, stok_sebelum, stok_sesudah,
           keterangan, ref_id, ref_tipe)
        values
          (v_user, v_item.product_id, 'void', v_item.qty * coalesce(v_item.konversi, 1), v_sebelum, v_sesudah,
           'Pembatalan ' || v_tx.invoice_no, v_tx.id, 'transaksi');
      end if;
    end if;
  end loop;

  update public.kasir_transactions set status = 'void' where id = p_tx_id;
  select * into v_tx from public.kasir_transactions where id = p_tx_id;
  return v_tx;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3a. RPC — RETUR & KARTU STOK
-- ----------------------------------------------------------------------------

-- Simpan retur + stok kembali + catat mutasi ke kartu stok (atomik).
-- Refund per baris = harga x qty_retur - potongan proporsional.
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
  v_sebelum  numeric;
  v_sesudah  numeric;
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
     and retur_no like 'RET-' || to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYYMMDD') || '-%';
  v_retur_no := 'RET-' || to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYYMMDD') || '-'
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

    -- refund proporsional dengan potongan baris asal
    v_disc   := round(v_it.discount * v_qty / greatest(v_it.qty, 1), 2);
    v_refund := round(v_it.price * v_qty - v_disc, 2);

    insert into public.kasir_return_items
      (user_id, return_id, transaction_item_id, product_id, product_name,
       price, cost, qty, discount, refund)
    values
      (v_user, v_retur_id, v_it.id, v_it.product_id, v_it.product_name,
       v_it.price, v_it.cost, v_qty, v_disc, v_refund);

    v_total := v_total + v_refund;

    -- stok kembali + catat mutasi ke kartu stok
    if v_it.product_id is not null then
      select stock into v_sebelum
        from public.kasir_products
       where id = v_it.product_id and user_id = v_user;
      if v_sebelum is not null then
        update public.kasir_products
           set stock = v_sebelum + (v_qty * coalesce(v_it.konversi, 1)),
               updated_at = now()
         where id = v_it.product_id and user_id = v_user
        returning stock into v_sesudah;
        insert into public.kasir_stock_logs
          (user_id, product_id, tipe, qty, stok_sebelum, stok_sesudah,
           keterangan, ref_id, ref_tipe)
        values
          (v_user, v_it.product_id, 'retur', v_qty * coalesce(v_it.konversi, 1), v_sebelum, v_sesudah,
           'Retur ' || v_retur_no, v_retur_id, 'retur');
      end if;
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

-- Penyesuaian stok (+/-) dengan keterangan, atomik & tercatat di kartu stok.
create or replace function public.kasir_adjust_stock(
  p_product_id uuid,
  p_delta      numeric,
  p_keterangan text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user  uuid := auth.uid();
  v_sebelum numeric;
  v_sesudah numeric;
  v_tipe  text;
  v_p     public.kasir_products%rowtype;
begin
  if v_user is null then
    raise exception 'Sesi tidak valid.';
  end if;
  if p_product_id is null or p_delta is null or round(p_delta, 2) = 0 then
    raise exception 'Jumlah stok tidak valid.';
  end if;

  select stock into v_sebelum
    from public.kasir_products
   where id = p_product_id and user_id = v_user;
  if v_sebelum is null then
    raise exception 'Produk tidak ditemukan.';
  end if;

  v_sesudah := round(v_sebelum + p_delta, 2);
  if v_sesudah < 0 then
    raise exception 'Stok tidak boleh negatif (tersedia %).',
      to_char(v_sebelum, 'FM9990.00');
  end if;

  update public.kasir_products
     set stock = v_sesudah,
         updated_at = now()
   where id = p_product_id and user_id = v_user;

  v_tipe := case when p_delta > 0 then 'stok_masuk' else 'stok_keluar' end;

  insert into public.kasir_stock_logs
    (user_id, product_id, tipe, qty, stok_sebelum, stok_sesudah, keterangan)
  values
    (v_user, p_product_id, v_tipe, round(p_delta, 2), v_sebelum, v_sesudah,
     nullif(coalesce(p_keterangan, ''), ''));

  select * into v_p from public.kasir_products
   where id = p_product_id and user_id = v_user;
  return to_jsonb(v_p);
end;
$$;

-- Kartu stok per produk: seluruh mutasi (terbaru dulu).
create or replace function public.kasir_stock_logs_list(p_product_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_rows jsonb;
begin
  if v_user is null then
    raise exception 'Sesi tidak valid.';
  end if;
  select coalesce(jsonb_agg(s order by s.created_at desc, s.id), '[]'::jsonb)
    into v_rows
    from public.kasir_stock_logs s
   where s.product_id = p_product_id
     and s.user_id = v_user;
  return v_rows;
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
  v_diskon_item numeric;
  v_rata numeric;
begin
  select
    count(*)                       as jumlah_transaksi,
    coalesce(sum(total), 0)        as total_omzet,
    coalesce(sum(total - total_cost), 0) as total_laba,
    coalesce(sum(discount_amount), 0)    as total_diskon_transaksi,
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

  -- Diskon sekarang disimpan per item (kolom Potongan di keranjang kasir),
  -- bukan lagi di level transaksi — jadi keduanya harus dijumlahkan supaya
  -- angka "Diskon" di laporan tetap benar untuk transaksi lama & baru.
  select coalesce(sum(i.discount), 0) into v_diskon_item
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
    'total_diskon',      round(v_row.total_diskon_transaksi + v_diskon_item, 2),
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

-- Laporan per kasir: transaksi + omzet + laba per kasir pada rentang.
create or replace function public.kasir_report_by_cashier(p_from text, p_to text)
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
    select coalesce(nullif(t.cashier_name, ''), 'Kasir') as kasir,
           count(*)                                        as transaksi,
           round(sum(t.total), 2)                          as omzet,
           round(sum(t.total - t.total_cost), 2)           as laba
    from public.kasir_transactions t
    where t.user_id = auth.uid()
      and t.status = 'completed'
      and (p_from is null or t.created_at >= p_from::timestamptz)
      and (p_to   is null or t.created_at <= p_to::timestamptz)
    group by t.cashier_name
    order by omzet desc
  ) r;
  return v_rows;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3b. RPC — SHIFT KASIR
-- ----------------------------------------------------------------------------

-- Shift yang sedang terbuka (null bila tidak ada).
create or replace function public.kasir_active_shift()
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_shift public.kasir_shifts%rowtype;
begin
  select * into v_shift from public.kasir_shifts
   where user_id = auth.uid() and status = 'open'
   order by opened_at desc
   limit 1;
  if v_shift.id is null then
    return null;
  end if;
  return to_jsonb(v_shift);
end;
$$;

-- Buka shift baru (gagal bila masih ada shift open).
create or replace function public.kasir_open_shift(
  p_opening_cash  numeric default 0,
  p_cashier_name  text default 'Kasir'
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user     uuid := auth.uid();
  v_active   public.kasir_shifts%rowtype;
  v_shift_no text;
  v_n        int;
  v_shift    public.kasir_shifts%rowtype;
begin
  if v_user is null then
    raise exception 'Sesi tidak valid.';
  end if;
  select * into v_active from public.kasir_shifts
   where user_id = v_user and status = 'open'
   order by opened_at desc
   limit 1;
  if v_active.id is not null then
    raise exception 'Shift % masih terbuka. Tutup dulu sebelum buka yang baru.',
      v_active.shift_no;
  end if;

  select count(*) into v_n from public.kasir_shifts
   where user_id = v_user
     and shift_no like 'SHIFT-' || to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYYMMDD') || '-%';
  v_shift_no := 'SHIFT-' || to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYYMMDD') || '-'
             || lpad((v_n + 1)::text, 4, '0');

  insert into public.kasir_shifts (user_id, cashier_name, shift_no, opening_cash)
  values (v_user, coalesce(p_cashier_name, 'Kasir'), v_shift_no,
          greatest(coalesce(p_opening_cash, 0), 0))
  returning * into v_shift;

  return to_jsonb(v_shift);
end;
$$;

-- Pratinjau perkiraan kas untuk shift yang masih berjalan.
create or replace function public.kasir_shift_preview(p_shift_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user     uuid := auth.uid();
  v_shift    public.kasir_shifts%rowtype;
  v_masuk    numeric;
  v_expected numeric;
  v_retur_cash numeric;
begin
  select * into v_shift from public.kasir_shifts
   where id = p_shift_id and user_id = v_user;
  if v_shift.id is null then
    raise exception 'Shift tidak ditemukan.';
  end if;

  select coalesce(sum(paid - change_due), 0) into v_masuk
    from public.kasir_transactions
   where user_id = v_user
     and shift_id = p_shift_id
     and status = 'completed'
     and payment_method = 'cash';

  -- Kurangi pengembalian uang (retur) yang masih berasal dari transaksi shift
  -- ini agar perkiraan kas kasir tidak melaporkan uang yang sudah dikembalikan.
  select coalesce(sum(r.total), 0) into v_retur_cash
    from public.kasir_returns r
    join public.kasir_transactions t on t.id = r.transaction_id
   where t.user_id = v_user
     and t.shift_id = p_shift_id
     and t.payment_method = 'cash';

  v_expected := round(coalesce(v_shift.opening_cash, 0) + v_masuk - coalesce(v_retur_cash, 0), 2);
  return jsonb_build_object('expected', v_expected);
end;
$$;

-- Tutup shift: hitung perkiraan kas & selisih dari uang aktual.
create or replace function public.kasir_close_shift(
  p_shift_id    uuid,
  p_actual_cash numeric default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user     uuid := auth.uid();
  v_shift    public.kasir_shifts%rowtype;
  v_masuk    numeric;
  v_expected numeric;
  v_retur_cash numeric;
  v_actual   numeric;
begin
  select * into v_shift from public.kasir_shifts
   where id = p_shift_id and user_id = v_user;
  if v_shift.id is null then
    raise exception 'Shift tidak ditemukan.';
  end if;
  if v_shift.status = 'closed' then
    raise exception 'Shift sudah ditutup.';
  end if;

  select coalesce(sum(paid - change_due), 0) into v_masuk
    from public.kasir_transactions
   where user_id = v_user
     and shift_id = p_shift_id
     and status = 'completed'
     and payment_method = 'cash';

  -- Kurangi pengembalian uang (retur) yang masih berasal dari transaksi shift
  -- ini agar perkiraan kas kasir tidak melaporkan uang yang sudah dikembalikan.
  select coalesce(sum(r.total), 0) into v_retur_cash
    from public.kasir_returns r
    join public.kasir_transactions t on t.id = r.transaction_id
   where t.user_id = v_user
     and t.shift_id = p_shift_id
     and t.payment_method = 'cash';

  v_expected := round(coalesce(v_shift.opening_cash, 0) + v_masuk - coalesce(v_retur_cash, 0), 2);
  v_actual   := round(coalesce(p_actual_cash, v_expected), 2);

  update public.kasir_shifts
     set closed_at     = now(),
         closing_cash  = v_actual,
         expected_cash = v_expected,
         status        = 'closed'
   where id = p_shift_id
  returning * into v_shift;

  return jsonb_build_object(
    'shift', to_jsonb(v_shift),
    'expected', v_expected,
    'selisih', round(v_actual - v_expected, 2)
  );
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

-- ============================================================================
--  5. RELOAD SCHEMA CACHE
-- ============================================================================
--  Paksa PostgREST membaca ulang definisi fungsi/tabel di atas, supaya RPC baru
--  (mis. kasir_open_shift) langsung terlihat dari aplikasi. Tanpa baris ini
--  aplikasi bisa menampilkan:
--    "Could not find the function public.kasir_open_shift(...) in the schema cache"
notify pgrst, 'reload schema';
-- ============================================================================
--  6. PEMBELIAN + SUPPLIER (PO sederhana)
-- ============================================================================
--  IPOS 5 menyebut modul Pembelian dengan PO/hutang/supplier. Di sini versi
--  sederhana: satu tabel supplier + satu tabel pembelian (langsung masuk stok
--  + catat kartu stok 'stok_masuk'). Belum mengelola hutang terbuka; cukup untuk
--  operasional harian toko.
create table if not exists public.kasir_suppliers (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  phone      text,
  address    text,
  created_at timestamptz not null default now()
);
create index if not exists kasir_suppliers_user on public.kasir_suppliers (user_id);

create table if not exists public.kasir_purchases (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  supplier_id   uuid references public.kasir_suppliers (id) on delete set null,
  supplier_name text,
  total         numeric not null default 0,
  note          text,
  invoice_no    text,
  status        text not null default 'lunas',
  created_at    timestamptz not null default now()
);
create index if not exists kasir_purchases_user on public.kasir_purchases (user_id, created_at desc);

create table if not exists public.kasir_purchase_items (
  id            uuid primary key default gen_random_uuid(),
  purchase_id   uuid not null references public.kasir_purchases (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  product_id    uuid,
  product_name  text not null,
  qty           numeric not null default 0,
  cost          numeric not null default 0,
  subtotal      numeric not null default 0,
  unit          text
);
create index if not exists kasir_purchase_items_purchase on public.kasir_purchase_items (purchase_id);

-- Kolom baru untuk database yang sudah ada (No Faktur "PO-YYMMDD-NNNNN",
-- status Lunas/Hutang, dan satuan saat pembelian).
alter table public.kasir_purchases  add column if not exists invoice_no text;
alter table public.kasir_purchases  add column if not exists status text not null default 'lunas';
alter table public.kasir_purchase_items add column if not exists unit text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'kasir_purchases_status_chk') then
    alter table public.kasir_purchases
      add constraint kasir_purchases_status_chk check (status in ('lunas', 'hutang'));
  end if;
end $$;

create sequence if not exists public.kasir_purchase_invoice_seq;
create unique index if not exists kasir_purchases_invoice_no
  on public.kasir_purchases (invoice_no);

alter table public.kasir_suppliers enable row level security;
alter table public.kasir_purchases enable row level security;
alter table public.kasir_purchase_items enable row level security;
revoke all on public.kasir_suppliers from anon;
revoke all on public.kasir_purchases from anon;
revoke all on public.kasir_purchase_items from anon;
grant select, insert, update, delete on public.kasir_suppliers to service_role, authenticated;
grant select, insert, update, delete on public.kasir_purchases to service_role, authenticated;
grant select, insert, update, delete on public.kasir_purchase_items to service_role, authenticated;

drop policy if exists kasir_suppliers_select on public.kasir_suppliers;
create policy kasir_suppliers_select on public.kasir_suppliers for select using (user_id = auth.uid());
drop policy if exists kasir_suppliers_insert on public.kasir_suppliers;
create policy kasir_suppliers_insert on public.kasir_suppliers for insert with check (user_id = auth.uid());
drop policy if exists kasir_suppliers_update on public.kasir_suppliers;
create policy kasir_suppliers_update on public.kasir_suppliers for update using (user_id = auth.uid());
drop policy if exists kasir_suppliers_delete on public.kasir_suppliers;
create policy kasir_suppliers_delete on public.kasir_suppliers for delete using (user_id = auth.uid());

drop policy if exists kasir_purchases_select on public.kasir_purchases;
create policy kasir_purchases_select on public.kasir_purchases for select using (user_id = auth.uid());
drop policy if exists kasir_purchases_insert on public.kasir_purchases;
create policy kasir_purchases_insert on public.kasir_purchases for insert with check (user_id = auth.uid());
drop policy if exists kasir_purchases_update on public.kasir_purchases;
create policy kasir_purchases_update on public.kasir_purchases for update using (user_id = auth.uid());
drop policy if exists kasir_purchases_delete on public.kasir_purchases;
create policy kasir_purchases_delete on public.kasir_purchases for delete using (user_id = auth.uid());

drop policy if exists kasir_purchase_items_select on public.kasir_purchase_items;
create policy kasir_purchase_items_select on public.kasir_purchase_items for select using (user_id = auth.uid());
drop policy if exists kasir_purchase_items_insert on public.kasir_purchase_items;
create policy kasir_purchase_items_insert on public.kasir_purchase_items for insert with check (user_id = auth.uid());
drop policy if exists kasir_purchase_items_update on public.kasir_purchase_items;
create policy kasir_purchase_items_update on public.kasir_purchase_items for update using (user_id = auth.uid());
drop policy if exists kasir_purchase_items_delete on public.kasir_purchase_items;
create policy kasir_purchase_items_delete on public.kasir_purchase_items for delete using (user_id = auth.uid());

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
  if v_user is null then raise exception 'Harus login.'; end if;
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
      select stock into v_sebelum from public.kasir_products
       where id = v_pid and user_id = v_user for update;
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

  select user_id into v_owner from public.kasir_purchases where id = p_id for update;
  if v_owner is null then raise exception 'Pembelian tidak ditemukan.'; end if;
  if v_owner <> v_user then raise exception 'Bukan milik pengguna ini.'; end if;

  for v_item in
    select product_id, qty from public.kasir_purchase_items where purchase_id = p_id
  loop
    v_qty := coalesce(v_item.qty, 0);
    if v_item.product_id is not null and v_qty <> 0 then
      select stock into v_sebelum from public.kasir_products
       where id = v_item.product_id and user_id = v_user for update;
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

grant execute on function public.kasir_delete_purchase(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Edit PO: ganti supplier/status/catatan + seluruh item; stok disesuaikan
-- sebesar SELISIH qty (bukan ditambah ulang). No Faktur tetap.
-- ----------------------------------------------------------------------------
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

  -- 1. Sesuaikan stok per produk sebesar selisih qty baru - qty lama.
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

  -- 2. Ganti seluruh item PO dengan item hasil edit.
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

  -- 3. Update header PO (No Faktur tetap).
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

-- ----------------------------------------------------------------------------
-- Stok opname: koreksi stok fisik -> hitung selisih -> catat ADJUSTMENT.
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
  if v_user is null then raise exception 'Sesi tidak valid.'; end if;
  if p_product_id is null or p_stok_fisik is null or p_stok_fisik < 0 then
    raise exception 'Stok fisik tidak valid.';
  end if;

  select stock into v_sebelum from public.kasir_products
   where id = p_product_id and user_id = v_user for update;
  if v_sebelum is null then raise exception 'Produk tidak ditemukan.'; end if;

  v_delta := round(p_stok_fisik - v_sebelum, 2);
  if v_delta = 0 then
    return jsonb_build_object('product_id', p_product_id, 'stok_sebelum', v_sebelum,
      'stok_sesudah', v_sebelum, 'delta', 0, 'tipe', null);
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

  return jsonb_build_object('product_id', p_product_id, 'stok_sebelum', v_sebelum,
    'stok_sesudah', v_sesudah, 'delta', v_delta, 'tipe', v_tipe);
end;
$$;

grant execute on function public.kasir_opname_stock(uuid, numeric, text)
  to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Laporan Pergerakan Stok: gabungan seluruh mutasi kartu stok + referensi.
--   p_from / p_to : tanggal 'YYYY-MM-DD' (p_to mencakup seharian)
--   p_jenis       : PENJUALAN | PEMBELIAN | ADJUSTMENT | RETUR | PEMBATALAN
-- ----------------------------------------------------------------------------
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
      s.id, s.created_at, s.product_id,
      p.barcode, p.name as product_name, p.unit,
      s.tipe, s.ref_tipe, s.qty, s.stok_sebelum, s.stok_sesudah, s.keterangan,
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
    left join public.kasir_transactions t on s.ref_tipe = 'transaksi' and t.id = s.ref_id
    left join public.kasir_purchases pu on s.ref_tipe = 'pembelian' and pu.id = s.ref_id
    left join public.kasir_returns r on s.ref_tipe = 'retur' and r.id = s.ref_id
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
    select * from dasar
    where p_jenis is null or p_jenis = '' or jenis = p_jenis
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', f.id, 'created_at', f.created_at, 'product_id', f.product_id,
        'barcode', f.barcode, 'product_name', f.product_name, 'unit', f.unit,
        'jenis', f.jenis, 'no_referensi', f.no_referensi,
        'masuk', case when f.qty > 0 then f.qty else 0 end,
        'keluar', case when f.qty < 0 then -f.qty else 0 end,
        'stok_sebelum', f.stok_sebelum, 'stok_sesudah', f.stok_sesudah,
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

-- ============================================================================
-- 12. MASTER SATUAN (GLOBAL)
-- ----------------------------------------------------------------------------
--    Satuan tidak lagi diketik manual per form. Semua pilihan satuan
--    (Produk, Pembelian, Kasir) membaca tabel ini lewat `satuanApi.list()`.
--
--    1. Tabel  : master_satuan (per pengguna)
--    2. RLS    : policies select/insert/update/delete berdasar user_id
--    3. Benih  : 12 satuan bawaan disuntik oleh aplikasi saat daftar masih
--                kosong (lihat SATUAN_DEFAULT di src/lib/api.ts) — supaya
--                baris benih selalu milik user yang sedang login.
--
--    Kode singkatan (kolom `kode`) dipakai di struk/nota: "2 DS Indomie".
-- ============================================================================

create table if not exists public.master_satuan (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  nama       text not null,
  kode       text not null,
  created_at timestamptz not null default now()
);
create index if not exists master_satuan_user on public.master_satuan (user_id, nama);

alter table public.master_satuan enable row level security;
revoke all on public.master_satuan from anon;
grant select, insert, update, delete on public.master_satuan to service_role, authenticated;

drop policy if exists master_satuan_select on public.master_satuan;
create policy master_satuan_select on public.master_satuan
  for select using (user_id = auth.uid());
drop policy if exists master_satuan_insert on public.master_satuan;
create policy master_satuan_insert on public.master_satuan
  for insert with check (user_id = auth.uid());
drop policy if exists master_satuan_update on public.master_satuan;
create policy master_satuan_update on public.master_satuan
  for update using (user_id = auth.uid());
drop policy if exists master_satuan_delete on public.master_satuan;
create policy master_satuan_delete on public.master_satuan
  for delete using (user_id = auth.uid());

-- Satuan kembar dicegah di tingkat database: nama unik (tanpa peduli huruf
-- besar/kecil) dan kode singkatan unik (di hurufkan besar).
create unique index if not exists master_satuan_user_nama
  on public.master_satuan (user_id, lower(nama));
create unique index if not exists master_satuan_user_kode
  on public.master_satuan (user_id, upper(kode));
