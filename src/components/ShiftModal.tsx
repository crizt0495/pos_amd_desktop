'use client';

import * as React from 'react';
import { Clock, Loader2, Wallet } from 'lucide-react';

import { Modal } from '@/components/Modal';
import { RupiahInput } from '@/components/RupiahInput';
import { rupiah, tanggalWaktu } from '@/lib/format';
import type { KasirShift } from '@/lib/types';

/**
 * Modal shift kasir.
 * - Bila `shift == null`  -> form BUKA shift (isi uang modal awal di laci).
 * - Bila `shift` terisi   -> form TUTUP shift (isi uang aktual di laci;
 *                            selisih tampil LIVE terhadap `expectedCash`).
 *
 * Semua panggilan API dilakukan pemanggil (KasirScreen) lewat `onOpen` /
 * `onCloseShift`; komponen hanya menampilkan dan menghitung selisih.
 * Struktur ini juga memungkinkan verifikasi e2e lewat preview (komponen asli
 * dengan data mock) tanpa koneksi Supabase.
 */
export function ShiftModal({
  open,
  shift,
  expectedCash,
  busy,
  onClose,
  onOpen,
  onCloseShift,
}: {
  open: boolean;
  shift: KasirShift | null;
  expectedCash: number | null;
  busy: boolean;
  onClose: () => void;
  onOpen: (openingCash: number) => void;
  onCloseShift: (actualCash: number) => void;
}) {
  const [opening, setOpening] = React.useState(0);
  const [actual, setActual] = React.useState<number | null>(null);

  // Reset isian tiap kali modal dibuka (atau shift berganti).
  React.useEffect(() => {
    if (open) {
      setOpening(shift?.opening_cash ?? 0);
      setActual(null);
    }
  }, [open, shift?.id]);

  const isClose = Boolean(shift);
  const expected = expectedCash ?? shift?.expected_cash ?? null;
  const actualNum = actual ?? 0;
  const selisih = isClose && expected != null && actual != null ? actualNum - expected : null;
  const validOpen = opening >= 0;
  const validClose = isClose && expected != null && actual != null && actualNum >= 0;

  return (
    <Modal
      open={open}
      title={isClose ? `Tutup Shift — ${shift?.shift_no}` : 'Buka Shift Kasir'}
      onClose={() => (busy ? undefined : onClose())}
      width="max-w-md"
      footer={
        <>
          <button type="button" className="btn-outline" onClick={onClose} disabled={busy}>
            Batal
          </button>
          {isClose ? (
            <button
              type="button"
              className="btn-primary"
              disabled={!validClose || busy}
              data-loading={busy}
              onClick={() => actual != null && onCloseShift(actualNum)}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock className="h-4 w-4" />}
              {busy ? 'Memproses…' : 'Tutup Shift'}
            </button>
          ) : (
            <button
              type="button"
              className="btn-primary"
              disabled={!validOpen || busy}
              data-loading={busy}
              onClick={() => onOpen(opening)}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
              {busy ? 'Memproses…' : 'Buka Shift'}
            </button>
          )}
        </>
      }
    >
      {isClose && shift ? (
        <div className="space-y-2.5">
          <div className="grid grid-cols-2 gap-1.5 rounded-lg bg-[#f6f9fd] p-3 text-[12px]">
            <div className="flex justify-between gap-2">
              <span className="text-[#5b6b80]">Kasir</span>
              <span className="truncate font-semibold text-[#22374b]">{shift.cashier_name}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-[#5b6b80]">Dibuka</span>
              <span className="tnum truncate font-semibold text-[#22374b]">
                {tanggalWaktu(shift.opened_at)}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-[#5b6b80]">Uang Awal</span>
              <span className="tnum font-semibold text-[#22374b]">{rupiah(shift.opening_cash)}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-[#5b6b80]">Perkiraan Kas</span>
              <span className="tnum font-bold text-[#134a85]">
                {expected != null ? rupiah(expected) : '…'}
              </span>
            </div>
          </div>

          <div>
            <label className="frm-label" htmlFor="shift-aktual">
              Uang Aktual di Laci
            </label>
            <RupiahInput
              id="shift-aktual"
              ariaLabel="Uang aktual di laci"
              className="frm-input h-9 w-full text-[14px] font-semibold"
              value={actual ?? 0}
              min={0}
              onChange={setActual}
              autoFocus
            />
          </div>

          {selisih != null ? (
            <div
              data-testid="shift-selisih"
              className={`flex items-center justify-between rounded-lg px-3 py-2.5 ${
                selisih === 0
                  ? 'bg-[#e8f1fa] text-[#134a85]'
                  : selisih > 0
                    ? 'bg-[#fff4e5] text-[#b0720a]'
                    : 'bg-[#fff0f0] text-[#e03131]'
              }`}
            >
              <span className="text-[12.5px] font-semibold">
                {selisih === 0 ? 'Kas Pas' : selisih > 0 ? 'Lebih' : 'Kurang'}
              </span>
              <span className="tnum text-[16px] font-bold">
                {selisih === 0 ? '0' : selisih > 0 ? `+${rupiah(selisih)}` : `-${rupiah(Math.abs(selisih))}`}
              </span>
            </div>
          ) : null}

          {actual != null && actualNum < 0 ? (
            <p className="text-[11px] font-semibold text-[#e03131]">Jumlah tidak boleh negatif.</p>
          ) : null}

          <p className="text-[11px] leading-relaxed text-[#7a8ba0]">
            Perkiraan kas = uang awal + penjualan tunai (dikurangi kembalian) selama shift. Selisih
            dihitung dari uang aktual yang kamu hitung di laci.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          <div>
            <label className="frm-label" htmlFor="shift-awal">
              Uang Modal Awal di Laci
            </label>
            <RupiahInput
              id="shift-awal"
              ariaLabel="Uang modal awal"
              className="frm-input h-9 w-full text-[14px] font-semibold"
              value={opening}
              min={0}
              onChange={setOpening}
              autoFocus
            />
          </div>
          <p className="text-[12px] leading-relaxed text-[#5b6b80]">
            Isi jumlah uang yang ada di laci saat memulai shift. Nol boleh — laci dianggap kosong.
            Transaksi yang disimpan selama shift berjalan akan dicatat ke shift ini untuk laporan
            per kasir dan penghitungan kas saat tutup.
          </p>
        </div>
      )}
    </Modal>
  );
}