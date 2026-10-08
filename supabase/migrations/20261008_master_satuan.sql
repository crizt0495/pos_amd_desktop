-- =============================================================================
-- Master Satuan (global) + simpan satuan jual di item transaksi
--
-- SEBELUM: nama satuan diketik bebas di tiap form (Produk, Pembelian, Kasir),
--          sehingga "Dus", "dus", "DUS", "Dus/6" bisa beredar bersamaan dan
--          laporan stok jadi tidak konsisten.
-- SESUDAH : semua pilihan satuan datang dari tabel `master_satuan`, input teks
--          satuan tidak lagi ada di aplikasi, dan kode singkatan (mis. "DS")
--          ikut tersimpan per item transaksi untuk mencetak struk lebih
--          ramping ("2 DS Indomie").
--
-- Isi migrasi:
--   1. Tabel  master_satuan + RLS + unique index (nama & kode per user).
--   2. Kolom  kasir_transaction_items.unit (nama satuan jual saat jual).
--   3. Fungsi kasir_create_transaction() ikut menulis kolom `unit`.
--
-- Data awal 12 satuan disuntik oleh aplikasi (SATUAN_DEFAULT di
-- src/lib/api.ts) saat daftar masih kosong, supaya selalu milik user login.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Master satuan
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- 2. Kolom unit pada item transaksi
-- ---------------------------------------------------------------------------
alter table public.kasir_transaction_items add column if not exists unit text not null default '';

-- ---------------------------------------------------------------------------
-- 3. kasir_create_transaction() menulis kolom unit
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
