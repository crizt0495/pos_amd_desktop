-- ============================================================================
--  Migrasi: Kartu Stok & Stok Masuk
--  Fitur roadmap: "melampaui iPOS" #5
--
--  Script IDEMPOTENT — aman dijalankan berulang kali.
--  Jalankan di Supabase SQL Editor (atau psql), SETELAH migrasi:
--    1. 20260929_varian_satuan_pelanggan.sql
--    2. 20260930_retur_penjualan.sql   (tabel kasir_returns/kasir_return_items)
--    3. 20260930_shift_kasir.sql       (kolom shift_id; create_transaction 9-arg)
--
--  Isi:
--    1. kasir_stock_logs           (buku besar stok: masuk/keluar + penyebab)
--    2. RLS + indeks
--    3. RPC kasir_adjust_stock     (penyesuaian stok atomik + tercatat)
--    4. RPC kasir_stock_logs_list  (baca kartu stok per produk)
--    5. kasir_create_transaction   (ditulis ulang = versi 9-arg + log 'terjual')
--    6. kasir_void_transaction     (ditulis ulang + log 'void')
--    7. kasir_create_return        (ditulis ulang + log 'retur')
--
--  Ketentuan qty di kasir_stock_logs: BERTANDA.
--    positif = stok bertambah (masuk/retur/void), negatif = stok berkurang (terjual).
--  Kolom stok_sebelum/stok_sesudah dipakai kartu stok untuk urutan mutasi.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Buku besar stok
-- ---------------------------------------------------------------------------
create table if not exists public.kasir_stock_logs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  product_id    uuid not null references public.kasir_products (id) on delete cascade,
  tipe          text not null check (tipe in ('terjual', 'retur', 'stok_masuk', 'stok_keluar', 'void')),
  qty           numeric not null default 0,   -- bertanda: + masuk, - keluar
  stok_sebelum  numeric,
  stok_sesudah  numeric,
  keterangan    text,
  ref_id        uuid,                          -- id transaksi / retur bila ada
  ref_tipe      text check (ref_tipe in ('transaksi', 'retur')),
  created_at    timestamptz not null default now()
);

create index if not exists kasir_stock_logs_prod on public.kasir_stock_logs
  (user_id, product_id, created_at desc);
create index if not exists kasir_stock_logs_user on public.kasir_stock_logs
  (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. RLS
-- ---------------------------------------------------------------------------
alter table public.kasir_stock_logs enable row level security;

drop policy if exists kasir_stock_logs_select on public.kasir_stock_logs;
create policy kasir_stock_logs_select on public.kasir_stock_logs
  for select using (user_id = auth.uid());
drop policy if exists kasir_stock_logs_insert on public.kasir_stock_logs;
create policy kasir_stock_logs_insert on public.kasir_stock_logs
  for insert with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 3. RPC — penyesuaian stok (+/- dengan keterangan), atomik & tercatat.
--    delta > 0 -> tipe 'stok_masuk'; delta < 0 -> 'stok_keluar'.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 4. RPC — kartu stok (seluruh mutasi per produk, terbaru dulu)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 5. Simpan transaksi (versi 9-arg, + log stok 'terjual')
-- ---------------------------------------------------------------------------
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
     and invoice_no like 'INV-' || to_char(now(), 'YYYYMMDD') || '-%';
  v_invoice := 'INV-' || to_char(now(), 'YYYYMMDD') || '-'
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
       greatest(round(coalesce((v_item.value->>'price')::numeric, 0)
            * greatest(coalesce((v_item.value->>'qty')::numeric, 1), 0), 2)
            - coalesce((v_item.value->>'discount')::numeric, 0), 0));

    -- potong stok untuk produk terdaftar + catat mutasi ke kartu stok
    if coalesce((v_item.value->>'product_id')::text, '') <> '' then
      v_pid := nullif((v_item.value->>'product_id')::text, '')::uuid;
      v_qty := greatest(coalesce((v_item.value->>'qty')::numeric, 1), 0);
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

-- ---------------------------------------------------------------------------
-- 6. Batalkan transaksi (+ log stok 'void')
-- ---------------------------------------------------------------------------
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
           set stock = v_sebelum + v_item.qty,
               updated_at = now()
         where id = v_item.product_id and user_id = v_user
        returning stock into v_sesudah;
        insert into public.kasir_stock_logs
          (user_id, product_id, tipe, qty, stok_sebelum, stok_sesudah,
           keterangan, ref_id, ref_tipe)
        values
          (v_user, v_item.product_id, 'void', v_item.qty, v_sebelum, v_sesudah,
           'Pembatalan ' || v_tx.invoice_no, v_tx.id, 'transaksi');
      end if;
    end if;
  end loop;

  update public.kasir_transactions set status = 'void' where id = p_tx_id;
  select * into v_tx from public.kasir_transactions where id = p_tx_id;
  return v_tx;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Simpan retur (+ log stok 'retur')
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
           set stock = v_sebelum + v_qty,
               updated_at = now()
         where id = v_it.product_id and user_id = v_user
        returning stock into v_sesudah;
        insert into public.kasir_stock_logs
          (user_id, product_id, tipe, qty, stok_sebelum, stok_sesudah,
           keterangan, ref_id, ref_tipe)
        values
          (v_user, v_it.product_id, 'retur', v_qty, v_sebelum, v_sesudah,
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

commit;

-- Muat ulang schema cache PostgREST. Tanpa ini, RPC/tabel baru bisa belum
-- terlihat dari aplikasi ("Could not find the function ... in the schema cache").
notify pgrst, 'reload schema';

-- ============================================================================
--  Verifikasi (jalankan terpisah setelah commit)
-- ============================================================================
-- select table_name from information_schema.tables
--  where table_schema = 'public' and table_name = 'kasir_stock_logs';
-- -- expect 1 baris
--
-- select p.proname, pg_get_function_identity_arguments(p.oid) as args
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public'
--    and p.proname in ('kasir_adjust_stock','kasir_stock_logs_list')
--  order by 1;
-- -- expect kasir_adjust_stock | (p_product_id uuid, p_delta numeric, p_keterangan text)
-- --        kasir_stock_logs_list | (p_product_id uuid)