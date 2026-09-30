-- ============================================================================
--  Migrasi: Varian Satuan + No HP/Alamat Pelanggan
--  Commit: 691600f  "feat(kasir): F10 list barang, autocomplete, modal
--                   pelanggan, varian satuan"
--
--  Script ini IDEMPOTENT — aman dijalankan berulang kali dan aman untuk
--  database yang sudah berisi transaksi. Tidak menghapus atau mengubah
--  data yang sudah ada.
--
--  Jalankan di Supabase SQL Editor, atau via psql:
--    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260929_varian_satuan_pelanggan.sql
--
--  Isi:
--    1. kasir_customers.phone, kasir_customers.address
--    2. kasir_products.variants   (jsonb: [{satuan, harga_jual, harga_pokok, konversi}])
--    3. kasir_create_transaction  -> Potongan jadi FLAT per baris
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Pelanggan: No HP & Alamat (modal Tambah Pelanggan)
-- ---------------------------------------------------------------------------
alter table public.kasir_customers add column if not exists phone   text;
alter table public.kasir_customers add column if not exists address text;

-- ---------------------------------------------------------------------------
-- 2. Produk: Varian Satuan
--    Bentuk jsonb, contoh:
--      [
--        { "satuan": "Pcs",    "harga_jual": 3500,  "harga_pokok": 2900,  "konversi": 1 },
--        { "satuan": "Dus/6",  "harga_jual": 19500, "harga_pokok": 16900, "konversi": 6 }
--      ]
--    Nilai kosong '[]' = produk memakai harga produk apa adanya.
-- ---------------------------------------------------------------------------
alter table public.kasir_products add column if not exists variants jsonb not null default '[]';

-- ---------------------------------------------------------------------------
-- 3. kasir_create_transaction — potongan flat per baris
--    SEBELUM:  subtotal += (price - discount) * qty      (potongan per satuan)
--    SESUDAH:  subtotal += max(0, price * qty - discount) (potongan per baris)
--
--    Dipakai frontend (src/lib/format.ts hitungTotal + receipt.ts) agar
--    total, laba, dan laporan sama persis dengan yang tampil di layar.
--
--    Catatan: transaksi lama yang sudah tersimpan TIDAK dihitung ulang;
--    subtotal tersimpan tetap seperti aslinya. Angka Potongan pada baris
--    lama yang dulu dihitung per satuan tidak dikonversi.
-- ---------------------------------------------------------------------------
-- Buang versi LAMA (7 argumen, tanpa p_customer_name) dan versi BARU (8
-- argumen). Keduanya wajib: kalau hanya 8 argumen yang dihapus, DB yang
-- masih punya versi 7-argumen akan mendapat function OVERLOAD kedua dan
-- pemanggilnya gagal dengan "function ... is not unique".
-- PENTING: jumlah tipe harus cocok persis dengan definisi, kalau tidak
-- `drop` diam-diam tidak terjadi.
drop function if exists public.kasir_create_transaction(jsonb, text, numeric, text, numeric, text, text);      -- 7 argumen
drop function if exists public.kasir_create_transaction(jsonb, text, numeric, text, numeric, text, text, text);  -- 8 argumen
create or replace function public.kasir_create_transaction(
  p_lines          jsonb,
  p_discount_type  text,
  p_discount_value numeric,
  p_payment_method text,
  p_paid           numeric,
  p_note           text,
  p_cashier_name   text,
  p_customer_name  text default null
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
     and invoice_no like 'INV-' || to_char(now(), 'YYYYMMDD') || '-%';
  v_invoice := 'INV-' || to_char(now(), 'YYYYMMDD') || '-'
             || lpad((v_n + 1)::text, 4, '0');

  insert into public.kasir_transactions
    (user_id, invoice_no, subtotal, discount_type, discount_value, discount_amount,
     total, total_cost, paid, change_due, payment_method, note, cashier_name,
     customer_name, status)
  values
    (v_user, v_invoice, v_subtotal, coalesce(p_discount_type, 'none'),
     coalesce(p_discount_value, 0), v_discount, v_total, v_total_cost,
     v_paid, v_change, coalesce(p_payment_method, 'cash'),
     nullif(coalesce(p_note, ''), ''), coalesce(p_cashier_name, 'Kasir'),
     nullif(coalesce(p_customer_name, ''), ''), 'completed')
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

commit;

-- Muat ulang schema cache PostgREST. Tanpa ini, RPC/tabel baru bisa belum
-- terlihat dari aplikasi ("Could not find the function ... in the schema cache").
notify pgrst, 'reload schema';

-- ============================================================================
--  Verifikasi (jalankan terpisah setelah commit di atas)
-- ============================================================================
-- 1. Ketiga kolom harus muncul:
--    kasir_customers.phone, kasir_customers.address, kasir_products.variants
--
--    select table_name, column_name, data_type
--      from information_schema.columns
--     where (table_name = 'kasir_customers' and column_name in ('phone', 'address'))
--        or (table_name = 'kasir_products'   and column_name = 'variants')
--     order by 1, 2;
--    -- expect 3 baris
--
-- 2. Function harus TEPAT SATU (tidak boleh overload) dan pakai rumus flat.
--    Perhatikan: 8 argumen, bukan 7.
--
--    select count(*) as jumlah_function
--      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'public' and p.proname = 'kasir_create_transaction';
--    -- expect 1  (kalau 2 = ada overload, pemanggil akan error "not unique")
--
--    select regexp_replace(prosrc, '\s+', ' ', 'g')
--             ~ 'v_subtotal := v_subtotal \+ greatest\(round' as pakai_potong_flat
--      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'public' and p.proname = 'kasir_create_transaction';
--    -- expect true  (false = masih rumus per-satuan yang lama)
--
-- 3. Sanity check perhitungan (hanya select, tidak mengubah data):
--    select
--      greatest(round(19500 * 3, 2) - 5000, 0) as jumlah_baru,  -- 53500
--      round((19500 - 5000) * 3, 2)                as jumlah_lama;  -- 43500
