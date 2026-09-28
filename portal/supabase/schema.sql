-- ===========================================================================
--  KASIRPRO PORTAL — Supabase PostgreSQL Schema
--  Jalankan seluruh file ini di: Supabase Dashboard > SQL Editor > New Query
--  Aman dijalankan berulang (idempotent).
--
--  Hanya 2 tabel bisnis: partners (toko operator) & licenses (serial key).
--  Aplikasi Desktop (Komputer Kasir) TIDAK menyentuh database ini langsung —
--  hanya lewat  POST /api/activate.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. Extension
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- 1. Tabel: partners  (toko komputer / operator)
-- ---------------------------------------------------------------------------
create table if not exists public.partners (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid unique references auth.users(id) on delete cascade,
  email           text unique,
  -- nama pengguna untuk login (username & password), unik per toko
  username        text,
  nama_toko       text        not null,
  no_hp           text,
  alamat          text,
  logo_url        text,
  -- jatah lisensi yang masih boleh dibuat (default 5, habis tiap generate key)
  license_quota   integer     not null default 5 check (license_quota >= 0),
  -- total serial key yang sudah pernah dibuat (dasar tier Bronze..Platinum)
  total_terjual   integer     not null default 0 check (total_terjual >= 0),
  -- akumulasi komisi (denormalisasi, source of truth tetap licenses.komisi_amount)
  komisi_total    integer     not null default 0 check (komisi_total >= 0),
  status          text        not null default 'active' check (status in ('active','suspended')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- migrasi aman untuk database lama
alter table public.partners add column if not exists email text;
alter table public.partners add column if not exists username text;
alter table public.partners add column if not exists komisi_total integer not null default 0;
alter table public.partners add column if not exists status text not null default 'active';
create unique index if not exists uq_partners_email on public.partners (email) where email is not null;
create unique index if not exists uq_partners_username on public.partners (username) where username is not null;
create index if not exists idx_partners_user on public.partners (user_id);

-- Isi username untuk baris lama yang belum punya (default = bagian email sebelum "@",
-- dipastikan unik dengan menambahkan -2, -3, … pada bentrok).
update public.partners set username = x.username
from (
  select id, coalesce(username, first_value(lower(split_part(coalesce(email,''),'@',1)))
                 over (partition by lower(split_part(coalesce(email,''),'@',1)) order by created_at)) ||
         case when row_number() over (partition by lower(split_part(coalesce(email,''),'@',1)) order by created_at) = 1
              then '' else row_number() over (partition by lower(split_part(coalesce(email,''),'@',1)) order by created_at)::text end
         as username
  from public.partners
  where username is null
) x
where public.partners.id = x.id;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_partners_updated on public.partners;
create trigger trg_partners_updated before update on public.partners
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Tabel: licenses  (serial key KPRO-XXXX-XXXX-XXXX)
-- ---------------------------------------------------------------------------
create table if not exists public.licenses (
  id              uuid primary key default gen_random_uuid(),
  serial_key      text        not null unique,
  partner_id      uuid        not null references public.partners(id) on delete cascade,
  status          text        not null default 'unused'
                                check (status in ('unused','active','blocked','revoked')),
  -- dikunci saat aplikasi desktop mengaktifkan key (Hardware ID)
  hwid_locked     text,
  hwid_locked_at  timestamptz,
  device_name     text,
  app_version     text,
  activated_at    timestamptz,
  paket_type      text        not null check (paket_type in ('bundle','app_only')),
  license_type    text        not null check (license_type in ('sekali','langganan')),
  pembeli_nama    text        not null,
  pembeli_hp      text,
  alamat          text,
  -- komisi final (rupiah bulat) saat key dibuat, sesuai tier saat itu
  komisi_amount   integer     not null default 0 check (komisi_amount >= 0),
  tier            text        not null default 'Bronze',
  tier_rate       numeric(5,2) not null default 5.00,
  expires_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- migrasi aman untuk database lama (nama kolom versi sebelumnya)
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'licenses' and column_name = 'pembeli_telepon'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'licenses' and column_name = 'pembeli_hp'
  ) then
    alter table public.licenses rename column pembeli_telepon to pembeli_hp;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'licenses' and column_name = 'pembeli_alamat'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'licenses' and column_name = 'alamat'
  ) then
    alter table public.licenses rename column pembeli_alamat to alamat;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'licenses' and column_name = 'komisi'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'licenses' and column_name = 'komisi_amount'
  ) then
    alter table public.licenses
      add column komisi_amount integer not null default 0;
    update public.licenses
       set komisi_amount = round(komisi)::integer
     where komisi is not null;
  end if;
end $$;

alter table public.licenses add column if not exists pembeli_hp text;
alter table public.licenses add column if not exists alamat text;
alter table public.licenses add column if not exists komisi_amount integer not null default 0;

-- normalisasi nilai paket lama 'app' -> 'app_only'
update public.licenses set paket_type = 'app_only' where paket_type = 'app';
update public.licenses set paket_type = 'bundle'    where paket_type is null;

create index if not exists idx_licenses_partner on public.licenses (partner_id);
create index if not exists idx_licenses_status  on public.licenses (status);
create index if not exists idx_licenses_hwid     on public.licenses (hwid_locked);
create index if not exists idx_licenses_created  on public.licenses (partner_id, created_at desc);

drop trigger if exists trg_licenses_updated on public.licenses;
create trigger trg_licenses_updated before update on public.licenses
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Helper: partner milik user yang sedang login
-- ---------------------------------------------------------------------------
create or replace function public.current_partner_id()
returns uuid
language sql stable security definer set search_path = public as $$
  select p.id from public.partners p where p.user_id = auth.uid() limit 1;
$$;

-- ---------------------------------------------------------------------------
-- 4. Auto-create baris partner saat akun toko dibuat di Supabase Auth
--    (nama toko & username default dari user_metadata atau email sebelum "@",
--    kuota 5)
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_username text;
begin
  v_username := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'username', '')), '');
  if v_username is null then
    v_username := lower(split_part(coalesce(new.email, ''), '@', 1));
  end if;

  insert into public.partners (user_id, email, username, nama_toko, license_quota, total_terjual, komisi_total)
  values (
    new.id,
    new.email,
    v_username,
    coalesce(new.raw_user_meta_data ->> 'nama_toko', split_part(coalesce(new.email, ''), '@', 1)),
    5, 0, 0
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 5. Tier toko: Bronze 1-5 (5%) | Silver 6-10 (10%) | Gold 11-30 (20%) | Platinum 30+ (30%)
-- ---------------------------------------------------------------------------
create or replace function public.tier_rate_of(p_total_terjual integer)
returns numeric language sql immutable as $$
  select case
    when coalesce(p_total_terjual, 0) >= 30 then 30.00
    when coalesce(p_total_terjual, 0) >= 11 then 20.00
    when coalesce(p_total_terjual, 0) >= 6  then 10.00
    else 5.00
  end;
$$;

create or replace function public.tier_name_of(p_total_terjual integer)
returns text language sql immutable as $$
  select case
    when coalesce(p_total_terjual, 0) >= 30 then 'Platinum'
    when coalesce(p_total_terjual, 0) >= 11 then 'Gold'
    when coalesce(p_total_terjual, 0) >= 6  then 'Silver'
    else 'Bronze'
  end;
$$;

-- Dasar komisi: Bundle Rp 100.000 | Aplikasi Saja Rp 50.000
create or replace function public.base_commission_of(p_paket text)
returns integer language sql immutable as $$
  select case when p_paket = 'bundle' then 100000 else 50000 end;
$$;

-- ---------------------------------------------------------------------------
-- 6. RPC generate_license  (dipakai Route Handler POST /api/licenses)
--    - user WAJIB login (auth.uid() != null, partner_id harus miliknya)
--    - mengunci baris partner (FOR UPDATE) supaya kuota tidak dobel terpakai
--    - membuat serial key, menghitung komisi sesuai tier SEBELUM generate,
--      menambah total_terjual, mengurangi license_quota
-- ---------------------------------------------------------------------------
create or replace function public.generate_license(
  p_serial_key     text,
  p_pembeli_nama   text,
  p_pembeli_hp     text default null,
  p_alamat         text   default null,
  p_paket_type     text   default 'app_only',
  p_license_type   text   default 'sekali'
)
returns public.licenses
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partner_id uuid;
  v_quota     integer;
  v_total     integer;
  v_rate      numeric;
  v_tier      text;
  v_komisi    integer;
  v_license   public.licenses;
begin
  v_partner_id := public.current_partner_id();

  if v_partner_id is null then
    raise exception 'PARTNER_NOT_FOUND';
  end if;

  -- kunci baris partner
  select license_quota, total_terjual
    into v_quota, v_total
  from public.partners
  where id = v_partner_id
    and status = 'active'
  for update;

  if not found then
    raise exception 'PARTNER_NOT_FOUND';
  end if;

  if coalesce(v_quota, 0) <= 0 then
    raise exception 'QUOTA_EXHAUSTED';
  end if;

  -- tier dihitung dari total SEBELUM key ini dibuat
  v_rate   := public.tier_rate_of(v_total);
  v_tier   := public.tier_name_of(v_total);
  v_komisi := round(public.base_commission_of(p_paket_type) * v_rate / 100)::integer;

  insert into public.licenses (
    serial_key, partner_id, paket_type, license_type,
    pembeli_nama, pembeli_hp, alamat,
    komisi_amount, tier, tier_rate, status, expires_at
  )
  values (
    p_serial_key, v_partner_id, p_paket_type, p_license_type,
    p_pembeli_nama, p_pembeli_hp, p_alamat,
    v_komisi, v_tier, v_rate, 'unused',
    case when p_license_type = 'langganan' then now() + interval '12 months' else null end
  )
  returning * into v_license;

  -- tandai update berikut sebagai internal (definer) supaya guard trigger
  -- trg_partners_guard_sensitive mengizinkan perubahan kolom kuota/komisi.
  perform set_config('app.bypass_partner_guard', '1', true);

  update public.partners
     set license_quota = license_quota - 1,
         total_terjual = total_terjual + 1,
         komisi_total  = komisi_total + v_komisi
   where id = v_partner_id;

  return v_license;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. RPC activate_license  (dipakai Route Handler POST /api/activate,
--    ditembak oleh aplikasi desktop "Komputer Kasir")
--
--    status unused             -> kunci HWID, jadi active  (ACTIVATED)
--    status active + HWID sama -> boleh masuk               (ALREADY_ACTIVE)
--    status active + HWID beda -> HWID_MISMATCH (terikat perangkat lain)
-- ---------------------------------------------------------------------------
create or replace function public.activate_license(
  p_serial_key  text,
  p_hwid        text,
  p_device_name text default null,
  p_app_version text default null
)
returns table (
  ok            boolean,
  code          text,
  message       text,
  license_id    uuid,
  partner_id    uuid,
  nama_toko     text,
  pembeli_nama  text,
  paket_type    text,
  license_type  text,
  status        text,
  hwid_locked   text,
  locked_now    boolean,
  activated_at  timestamptz,
  expires_at    timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
-- Nama kolom hasil (RETURNS TABLE) sama dengan nama kolom tabel:
-- semua konflik nama diputuskan MEMILIH kolom (bukan variabel).
#variable_conflict use_column
declare
  v_lic    public.licenses%rowtype;
  v_id     uuid;
  v_toko   text;
  v_target text;
begin
  v_target := upper(trim(coalesce(p_hwid, '')));
  v_lic.hwid_locked := null;

  select * into v_lic
  from public.licenses
  where upper(trim(serial_key)) = upper(trim(coalesce(p_serial_key, '')));

  -- 7a. key tidak ada
  if not found then
    return query select
      false, 'INVALID_KEY', 'Serial Key tidak ditemukan. Periksa kembali kode dari toko Anda.',
      null::uuid, null::uuid, null::text, null::text, null::text, null::text, null::text,
      null::text, false, null::timestamptz, null::timestamptz;
    return;
  end if;

  select p.nama_toko into v_toko
    from public.partners p
   where p.id = v_lic.partner_id;

  -- 7b. diblokir / dicabut admin
  if v_lic.status in ('blocked', 'revoked') then
    return query select
      false, 'BLOCKED', 'Serial Key ini telah diblokir. Hubungi toko Anda.',
      v_lic.id, v_lic.partner_id, v_toko, v_lic.pembeli_nama, v_lic.paket_type,
      v_lic.license_type, v_lic.status, v_lic.hwid_locked, false, v_lic.activated_at, v_lic.expires_at;
    return;
  end if;

  -- 7c. masa langganan habis
  if v_lic.expires_at is not null and v_lic.expires_at < now() then
    update public.licenses set status = 'revoked' where id = v_lic.id;
    return query select
      false, 'EXPIRED', 'Masa langganan Serial Key ini sudah habis. Hubungi toko Anda.',
      v_lic.id, v_lic.partner_id, v_toko, v_lic.pembeli_nama, v_lic.paket_type,
      v_lic.license_type, 'expired', v_lic.hwid_locked, false, v_lic.activated_at, v_lic.expires_at;
    return;
  end if;

  -- 7d. sudah dipakai -> hanya perangkat yang sama boleh masuk
  if v_lic.status = 'active' and v_lic.hwid_locked is not null then
    if v_lic.hwid_locked = v_target then
      return query select
        true, 'ALREADY_ACTIVE', 'Serial Key ini sudah aktif di perangkat ini.',
        v_lic.id, v_lic.partner_id, v_toko, v_lic.pembeli_nama, v_lic.paket_type,
        v_lic.license_type, v_lic.status, v_lic.hwid_locked, false, v_lic.activated_at, v_lic.expires_at;
    else
      return query select
        false, 'HWID_MISMATCH', 'Lisensi terikat perangkat lain. Aktifkan di komputer kasir yang sama.',
        v_lic.id, v_lic.partner_id, v_toko, v_lic.pembeli_nama, v_lic.paket_type,
        v_lic.license_type, v_lic.status, v_lic.hwid_locked, false, v_lic.activated_at, v_lic.expires_at;
    end if;
    return;
  end if;

  -- 7e. kunci HWID (idempoten & anti race-condition)
  v_id := v_lic.id;

  update public.licenses
     set hwid_locked    = v_target,
         hwid_locked_at = now(),
         status         = 'active',
         activated_at   = now(),
         device_name    = coalesce(p_device_name, device_name),
         app_version    = coalesce(p_app_version, app_version)
   where id = v_id
     and (hwid_locked is null or hwid_locked = v_target)
  returning * into v_lic;

  if not found then
    -- perangkat lain menang balapan
    select * into v_lic from public.licenses where id = v_id;
    return query select
      false, 'HWID_MISMATCH', 'Lisensi terikat perangkat lain. Aktifkan di komputer kasir yang sama.',
      v_lic.id, v_lic.partner_id, v_toko, v_lic.pembeli_nama, v_lic.paket_type,
      v_lic.license_type, v_lic.status, v_lic.hwid_locked, false, v_lic.activated_at, v_lic.expires_at;
    return;
  end if;

  return query select
    true, 'ACTIVATED', 'Serial Key berhasil diaktifkan dan terkunci ke perangkat ini.',
    v_lic.id, v_lic.partner_id, v_toko, v_lic.pembeli_nama, v_lic.paket_type,
    v_lic.license_type, v_lic.status, v_lic.hwid_locked, true, v_lic.activated_at, v_lic.expires_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Row Level Security
--    Client (browser) hanya boleh membaca/menulis datanya sendiri.
--    Penulisan licenses hanya lewat RPC SECURITY DEFINER (dari Route Handler).
-- ---------------------------------------------------------------------------
alter table public.partners enable row level security;
alter table public.licenses enable row level security;

drop policy if exists "partners_select_own" on public.partners;
create policy "partners_select_own" on public.partners
  for select using (user_id = auth.uid());

drop policy if exists "partners_update_own" on public.partners;
create policy "partners_update_own" on public.partners
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "licenses_select_own" on public.licenses;
create policy "licenses_select_own" on public.licenses
  for select using (partner_id = public.current_partner_id());

-- akses tulis licenses DITOLAK untuk anon/authenticated:
drop policy if exists "licenses_insert_own" on public.licenses;
drop policy if exists "licenses_update_own" on public.licenses;
drop policy if exists "licenses_delete_own" on public.licenses;

-- ---------------------------------------------------------------------------
-- 9. Grants
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
-- kolom yang boleh di-UPDATE oleh user toko (via RLS + sesi login) HANYA ini.
-- Kolom sensitif (kuota, total terjual, komisi, status, user_id, email,
-- username) TIDAK boleh diubah klien — topup kuota hanya via SQL editor admin.
revoke update on public.partners from authenticated;
grant select on public.partners to authenticated;
grant update (nama_toko, no_hp, alamat, logo_url) on public.partners to authenticated;
grant select on public.licenses to authenticated;
grant execute on function public.current_partner_id() to anon, authenticated, service_role;
grant execute on function public.generate_license(text, text, text, text, text, text) to authenticated, service_role;
grant execute on function public.activate_license(text, text, text, text) to service_role;
grant execute on function public.tier_rate_of(integer) to anon, authenticated, service_role;
grant execute on function public.tier_name_of(integer) to anon, authenticated, service_role;
grant execute on function public.base_commission_of(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9b. Garda kolom sensitif partners (pertahanan kedua, di atas hak kolom)
--     Setiap UPDATE partners lewat klien akan dicek: kolom kuota/komisi/status
--     tidak boleh berubah kecuali pemanggil internal menandai GUC
--     `app.bypass_partner_guard` = '1' (dipakai RPC generate_license).
-- ---------------------------------------------------------------------------
create or replace function public.guard_partner_sensitive_columns()
returns trigger language plpgsql as $$
begin
  if current_setting('app.bypass_partner_guard', true) = '1' then
    return new;
  end if;

  if new.license_quota is distinct from old.license_quota
     or new.total_terjual is distinct from old.total_terjual
     or new.komisi_total  is distinct from old.komisi_total
     or new.status        is distinct from old.status
     or new.user_id       is distinct from old.user_id then
    raise exception 'GARDA: kolom sensitif toko tidak boleh diubah lewat klien.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_partners_guard_sensitive on public.partners;
create trigger trg_partners_guard_sensitive before update on public.partners
  for each row execute function public.guard_partner_sensitive_columns();

-- ---------------------------------------------------------------------------
-- 10. Storage bucket untuk logo toko
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('store-logos', 'store-logos', true)
on conflict (id) do update set public = true;

drop policy if exists "logos_public_read" on storage.objects;
create policy "logos_public_read" on storage.objects
  for select using (bucket_id = 'store-logos');

-- ---------------------------------------------------------------------------
-- 11. SETUP TOKO
--     Daftarkan akun lebih dulu di:
--       Supabase Dashboard > Authentication > Users > Add user
--       (centang "Auto Confirm User" supaya bisa langsung login)
--     Baris partners otomatis dibuat oleh trigger on_auth_user_created.
--     Setelah itu tinggal topup kuota:
--
--   update public.partners
--      set nama_toko     = 'Toko Komputer Maju',
--          no_hp         = '08123456789',
--          alamat        = 'Jl. Merdeka No. 10',
--          license_quota = 5
--    where email = 'toko@email.com';
--
--   Lihat daftar toko:
--   select id, email, nama_toko, license_quota, total_terjual, komisi_total
--     from public.partners order by created_at;
--
--   Reset lisensi yang terikat ke komputer salah (permintaan pembeli):
--   update public.licenses
--      set hwid_locked = null, hwid_locked_at = null, status = 'unused', activated_at = null
--    where serial_key = 'KPRO-XXXX-XXXX-XXXX';
-- ---------------------------------------------------------------------------
