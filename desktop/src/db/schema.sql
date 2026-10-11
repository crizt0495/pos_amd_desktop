-- ============================================================================
--  KasirPro POS — skema database lokal (SQLite) untuk aplikasi desktop.
-- ----------------------------------------------------------------------------
--  Cermin dari supabase/schema.sql (Postgres) supaya aplikasi web yang sama
--  bisa berjalan di atas database lokal tanpa mengubah layar/`api.ts`.
--
--  Penyimpangan yang disengaja:
--    numeric      -> REAL   (dibulatkan 2 desimal di JS)
--    boolean      -> INTEGER 0/1 (dikembalikan sebagai boolean saat dibaca)
--    jsonb        -> TEXT   (JSON string)
--    timestamptz  -> TEXT   (ISO-8601 UTC)
--  Semua tabel transaksional punya `user_id` sebagai pengganti RLS.
-- ============================================================================

-- ------------------------------- master -------------------------------
create table if not exists kasir_products (
  id          text primary key,
  user_id     text not null,
  barcode     text,
  name        text not null,
  category    text not null default 'Umum',
  price       real not null default 0,
  cost        real not null default 0,
  stock       real not null default 0,
  min_stock   real not null default 0,
  unit        text not null default 'pcs',
  satuan_list text not null default '[]',
  variants    text not null default '[]',
  is_active   integer not null default 1,
  created_at  text not null,
  updated_at  text not null
);
create index if not exists idx_products_user      on kasir_products (user_id);
create index if not exists idx_products_user_name on kasir_products (user_id, name);
create index if not exists idx_products_user_bc   on kasir_products (user_id, barcode);

create table if not exists kasir_customers (
  id         text primary key,
  user_id    text not null,
  name       text not null,
  phone      text,
  address    text,
  created_at text not null
);
create index if not exists idx_customers_user on kasir_customers (user_id);

create table if not exists kasir_suppliers (
  id         text primary key,
  user_id    text not null,
  name       text not null,
  phone      text,
  address    text,
  created_at text not null
);
create index if not exists idx_suppliers_user on kasir_suppliers (user_id);

create table if not exists master_satuan (
  id         text primary key,
  user_id    text not null,
  nama       text not null,
  kode       text not null,
  created_at text not null
);
create index if not exists idx_satuan_user on master_satuan (user_id, nama);

create table if not exists kasir_settings (
  user_id text not null,
  key     text not null,
  value   text,
  primary key (user_id, key)
);

-- ----------------------------- penjualan ------------------------------
create table if not exists kasir_transactions (
  id              text primary key,
  user_id         text not null,
  invoice_no      text not null,
  subtotal        real not null default 0,
  discount_type   text not null default 'none',
  discount_value  real not null default 0,
  discount_amount real not null default 0,
  total           real not null default 0,
  total_cost      real not null default 0,
  paid            real not null default 0,
  change_due      real not null default 0,
  payment_method  text not null default 'cash',
  note            text,
  cashier_name    text,
  customer_name   text,
  status          text not null default 'completed',
  shift_id        text,
  created_at      text not null,
  unique (user_id, invoice_no)
);
create index if not exists idx_tx_user    on kasir_transactions (user_id, created_at desc);
create index if not exists idx_tx_stat    on kasir_transactions (user_id, status);
create index if not exists idx_tx_shift   on kasir_transactions (user_id, shift_id);

create table if not exists kasir_transaction_items (
  id             text primary key,
  user_id        text not null,
  transaction_id text not null,
  product_id     text,
  barcode        text,
  product_name   text not null,
  price          real not null default 0,
  cost           real not null default 0,
  qty            real not null default 1,
  discount       real not null default 0,
  subtotal       real not null default 0,
  konversi       real not null default 1,
  unit           text not null default ''
);
create index if not exists idx_items_tx   on kasir_transaction_items (transaction_id);
create index if not exists idx_items_user on kasir_transaction_items (user_id);

create table if not exists kasir_shifts (
  id            text primary key,
  user_id       text not null,
  cashier_name  text not null default 'Kasir',
  shift_no      text not null,
  opened_at     text not null,
  closed_at     text,
  opening_cash  real not null default 0,
  closing_cash  real,
  expected_cash real,
  status        text not null default 'open',
  unique (user_id, shift_no)
);
create index if not exists idx_shifts_user on kasir_shifts (user_id, opened_at desc);

create table if not exists kasir_returns (
  id             text primary key,
  user_id        text not null,
  transaction_id text not null,
  invoice_no     text not null,
  retur_no       text not null,
  total          real not null default 0,
  cashier_name   text,
  note           text,
  created_at     text not null,
  unique (user_id, retur_no)
);
create index if not exists idx_returns_user on kasir_returns (user_id, created_at desc);

create table if not exists kasir_return_items (
  id                  text primary key,
  user_id             text not null,
  return_id           text not null,
  transaction_item_id text,
  product_id          text,
  product_name        text not null,
  price               real not null default 0,
  cost                real not null default 0,
  qty                 real not null default 0,
  discount            real not null default 0,
  refund              real not null default 0
);
create index if not exists idx_ritems_return on kasir_return_items (return_id);

create table if not exists kasir_stock_logs (
  id           text primary key,
  user_id      text not null,
  product_id   text not null,
  tipe         text not null,
  qty          real not null default 0,
  stok_sebelum real,
  stok_sesudah real,
  keterangan   text,
  ref_id       text,
  ref_tipe     text,
  created_at   text not null
);
create index if not exists idx_logs_product on kasir_stock_logs (product_id, created_at desc);
create index if not exists idx_logs_user    on kasir_stock_logs (user_id, created_at desc);

-- ----------------------------- pembelian ------------------------------
create table if not exists kasir_purchases (
  id            text primary key,
  user_id       text not null,
  supplier_id   text,
  supplier_name text,
  total         real not null default 0,
  note          text,
  invoice_no    text,
  status        text not null default 'lunas',
  created_at    text not null
);
create index if not exists idx_purch_user on kasir_purchases (user_id, created_at desc);
create unique index if not exists idx_purch_invoice on kasir_purchases (invoice_no);

create table if not exists kasir_purchase_items (
  id           text primary key,
  purchase_id  text not null,
  user_id      text not null,
  product_id   text,
  product_name text not null,
  qty          real not null default 0,
  cost         real not null default 0,
  subtotal     real not null default 0,
  unit         text
);
create index if not exists idx_pitems_purchase on kasir_purchase_items (purchase_id);

-- -------------------------- infrastruktur -----------------------------
-- Metadata lokal: localUserId (id user GoTrue lisensi), penghitung, dsb.
create table if not exists _meta (
  key   text primary key,
  value text
);

-- Outbox sinkronisasi: satu baris per (tabel, baris) — yang terakhir menang.
create table if not exists _outbox (
  tbl    text not null,
  row_id text not null,
  op     text not null,          -- 'upsert' | 'delete'
  ts     text not null,
  done   integer not null default 0,
  primary key (tbl, row_id)
);
create index if not exists idx_outbox_pending on _outbox (done, ts);
