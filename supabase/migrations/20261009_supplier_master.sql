-- =============================================================================
-- Master Supplier (untuk modul Pembelian)
--
-- SEBELUM: nama supplier hanya diketik bebas di form Pembelian dan disimpan apa
--          adanya di `kasir_purchases.supplier_name`; daftar supplier tidak bisa
--          dipilih ulang dan tidak ada No HP / Alamat.
-- SESUDAH : tabel `kasir_suppliers` jadi sumber dropdown Supplier. Tombol [+]
--          di form Pembelian membuka modal (Nama, No HP, Alamat) dan barisnya
--          langsung terpilih + `supplier_id` ikut tersimpan di PO.
--
-- Tabel ini sudah ada di `schema.sql`; migrasi ini idempotent supaya database
-- yang dibangun dari migrasi bertahap tetap memilikinya.
-- =============================================================================

create table if not exists public.kasir_suppliers (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  phone      text,
  address    text,
  created_at timestamptz not null default now()
);
create index if not exists kasir_suppliers_user on public.kasir_suppliers (user_id);

alter table public.kasir_suppliers enable row level security;
revoke all on public.kasir_suppliers from anon;
grant select, insert, update, delete on public.kasir_suppliers to service_role, authenticated;

drop policy if exists kasir_suppliers_select on public.kasir_suppliers;
create policy kasir_suppliers_select on public.kasir_suppliers
  for select using (user_id = auth.uid());
drop policy if exists kasir_suppliers_insert on public.kasir_suppliers;
create policy kasir_suppliers_insert on public.kasir_suppliers
  for insert with check (user_id = auth.uid());
drop policy if exists kasir_suppliers_update on public.kasir_suppliers;
create policy kasir_suppliers_update on public.kasir_suppliers
  for update using (user_id = auth.uid());
drop policy if exists kasir_suppliers_delete on public.kasir_suppliers;
create policy kasir_suppliers_delete on public.kasir_suppliers
  for delete using (user_id = auth.uid());

-- Nama supplier unik (tanpa peduli huruf besar/kecil) per pengguna, supaya
-- dropdown tidak menampilkan dua baris dengan nama sama.
create unique index if not exists kasir_suppliers_user_nama
  on public.kasir_suppliers (user_id, lower(name));
