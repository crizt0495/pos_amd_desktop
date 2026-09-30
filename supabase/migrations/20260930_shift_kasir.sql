-- ============================================================================
--  Migrasi: Shift Kasir + Laporan per Kasir
--  Fitur roadmap: "melampaui iPOS" #3
--
--  Script IDEMPOTENT — aman dijalankan berulang kali dan untuk DB yang sudah
--  berisi transaksi.
--
--  Jalankan di Supabase SQL Editor, atau via psql:
--    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260930_shift_kasir.sql
--
--  Isi:
--    1. kasir_shifts                    (buka/tutup shift, modal awal, uang aktual)
--    2. kasir_transactions.shift_id     (nullable — transaksi terikat ke shift)
--    3. RPC: kasir_open_shift / kasir_active_shift / kasir_shift_preview /
--           kasir_close_shift / kasir_report_by_cashier
--    4. kasir_create_transaction versi BARU (9 arg) dengan p_shift_id opsional
--
--  Math kas (shift):
--    expected = modal_awal + Σ(paid - change_due) transaksi TUNAI selesai
--    selisih  = uang_aktual - expected
--  Transaksi metode non-tunai tidak ikut di laci kas.
--
--  Catatan kompatibilitas:
--    Kasir lama tetap bisa bertransaksi TANPA membuka shift — RPC create
--    menerima p_shift_id nullable. Frontend hanya mengirim p_shift_id bila
--    memang ada shift aktif (basis data tanpa migrasi tetap aman).
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Tabel shift
-- ---------------------------------------------------------------------------
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
create index        if not exists kasir_shifts_user    on public.kasir_shifts (user_id, opened_at desc);

-- ---------------------------------------------------------------------------
-- 2. Transaksi terikat shift (nullable — tetap sah tanpa shift)
-- ---------------------------------------------------------------------------
alter table public.kasir_transactions add column if not exists shift_id uuid;
create index if not exists kasir_transactions_shift on public.kasir_transactions (user_id, shift_id);

-- ---------------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 4. RPC shift
-- ---------------------------------------------------------------------------
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
     and shift_no like 'SHIFT-' || to_char(now(), 'YYYYMMDD') || '-%';
  v_shift_no := 'SHIFT-' || to_char(now(), 'YYYYMMDD') || '-'
             || lpad((v_n + 1)::text, 4, '0');

  insert into public.kasir_shifts (user_id, cashier_name, shift_no, opening_cash)
  values (v_user, coalesce(p_cashier_name, 'Kasir'), v_shift_no,
          greatest(coalesce(p_opening_cash, 0), 0))
  returning * into v_shift;

  return to_jsonb(v_shift);
end;
$$;

-- Pratinjau perkiraan kas untuk shift yang masih berjalan (agar kasir bisa
-- melihat selisih di layar SEBELUM menutup shift).
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

  v_expected := round(coalesce(v_shift.opening_cash, 0) + v_masuk, 2);
  return jsonb_build_object('expected', v_expected);
end;
$$;

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

  v_expected := round(coalesce(v_shift.opening_cash, 0) + v_masuk, 2);
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

-- Laporan per kasir: daftar kasir + transaksi + omzet + laba pada rentang.
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

-- ---------------------------------------------------------------------------
-- 5. kasir_create_transaction versi BARU (9 arg) — simpan shift_id
--    Buang overload lama 7 & 8 argumen supaya tidak ambigu di paket frontend.
-- ---------------------------------------------------------------------------
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

  for v_item in select * from jsonb_array_elements(p_lines) loop
    v_subtotal   := v_subtotal
      + greatest(round(coalesce((v_item.value->>'price')::numeric, 0)
             * greatest(coalesce((v_item.value->>'qty')::numeric, 0), 0), 2)
             - coalesce((v_item.value->>'discount')::numeric, 0), 0);
    v_total_cost := v_total_cost
      + coalesce((v_item.value->>'cost')::numeric, 0)
        * greatest(coalesce((v_item.value->>'qty')::numeric, 0), 0);
  end loop;

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
--  Verifikasi (jalankan terpisah setelah commit)
-- ============================================================================
-- select table_name from information_schema.tables
--  where table_schema = 'public' and table_name = 'kasir_shifts';
-- -- expect 1 baris
--
-- select column_name, data_type from information_schema.columns
--  where table_schema = 'public' and table_name = 'kasir_transactions'
--    and column_name = 'shift_id';
-- -- expect 1 baris (uuid, nullable)
--
-- select count(*) as jumlah_function
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and p.proname in
--    ('kasir_create_transaction', 'kasir_open_shift', 'kasir_active_shift',
--     'kasir_shift_preview', 'kasir_close_shift', 'kasir_report_by_cashier');
-- -- kasir_create_transaction harus TEPAT SATU (9 arg). Sisanya satu masing-masing.