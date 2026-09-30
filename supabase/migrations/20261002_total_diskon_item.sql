-- =============================================================================
-- Diskon kasir pindah ke per-item (kolom POTONGAN keranjang)
--
-- SEBELUM: diskon diketik di form header dan dipotong sekali lagi di level
--          transaksi (kasir_transactions.discount_amount).
-- SESUDAH: diskon header hanya mengisi kolom POTONGAN tiap item BARU yang
--          masuk ke keranjang. Transaksi disimpan dengan discount_type 'none'
--          supaya nominal tidak terpotong dua kali.
--
-- Efeknya: laporan "Diskon" tidak boleh lagi hanya menjumlah
-- kasir_transactions.discount_amount (selalu 0 untuk transaksi baru), tapi
-- harus menjumlahkan potongan per item (kasir_transaction_items.discount)
-- PLUS discount_amount lama — supaya angka transaksi lama tidak berubah.
--
-- Tidak ada perubahan tabel; hanya isi fungsi kasir_report_summary().
-- =============================================================================

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

-- Fungsi yang sudah ada di DB perlu cache PostgREST disegarkan:
notify pgrst, 'reload schema';
