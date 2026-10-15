'use client';

import * as React from 'react';
import { Clock, Loader2, Wallet } from 'lucide-react';

import { Modal } from '@/components/Modal';
import { RupiahInput } from '@/components/RupiahInput';
import { rupiah, tanggalWaktu } from '@/lib/format';
import type { KasirShift, ShiftPreview } from '@/lib/types';

/**
 * Modal shift kasir.
 * - Bila `shift == null`  -> form BUKA shift (tanggal/jam otomatis + nama kasir
 *                            dari login + uang modal awal yang wajib diisi).
 * - Bila `shift` terisi   -> form TUTUP shift (rincian kas + uang aktual di
 *                            laci + catatan wajib bila selisih != 0).
 *
 * Semua panggilan API dilakukan pemanggil (KasirScreen) lewat `onOpen` /
 * `onCloseShift`; komponen hanya menampilkan dan menghitung selisih.
 */
export function ShiftModal({
  open,
  shift,
  preview,
  cashierName,
  busy,
  onClose,
  onOpen,
  onCloseShift,
}: {
  open: boolean;
  shift: KasirShift | null;
  /** Rincian kas shift dari RPC `kasir_shift_preview` (diisi saat tutup). */
  preview: ShiftPreview | null;
  /** Nama kasir dari sesi login — dipakai saat membuka shift. */
  cashierName: string;
  busy: boolean;
  onClose: () => void;
  onOpen: (openingCash: number) => void;
  onCloseShift: (actualCash: number, note: string) => void;
}) {
  const [opening, setOpening] = React.useState(0);
  // Teks mentah input: membedakan "kosong" dari "0" untuk validasi wajib isi.
  const [openingTeks, setOpeningTeks] = React.useState('');
  const [actual, setActual] = React.useState<number | null>(null);
  const [actualTeks, setActualTeks] = React.useState('');
  const [note, setNote] = React.useState('');
  // Jam real-time untuk form buka shift.
  const [now, setNow] = React.useState(() => new Date());

  // Reset isian tiap kali modal dibuka (atau shift berganti).
  React.useEffect(() => {
    if (open) {
      setOpening(shift?.opening_cash ?? 0);
      setOpeningTeks(shift ? String(shift.opening_cash ?? '') : '');
      setActual(null);
      setActualTeks('');
      setNote('');
      setNow(new Date());
    }
  }, [open, shift?.id]);

  // Jam & tanggal berjalan (real-time) selama modal buka shift terbuka.
  React.useEffect(() => {
    if (!open || shift) return;
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, [open, shift]);

  const isClose = Boolean(shift);
  const expected = preview?.expected ?? shift?.expected_cash ?? null;
  const actualNum = actual ?? 0;
  const selisih = isClose && expected != null && actual != null ? actualNum - expected : null;

  // Validasi: teks mentah harus berisi angka (bukan kosong / huruf).
  // RupiahInput sudah membuang karakter non-angka dari nilai tersimpan, jadi
  // cukup pastikan ada minimal satu digit — ini juga mencegah field "macet"
  // tidak valid hanya karena satu huruf nyasar yang tak terlihat.
  const terisi = (raw: string) => /\d/.test(raw);
  const validOpen = terisi(openingTeks);
  // Kas akhir fisik wajib diisi; catatan wajib bila selisih != 0.
  const validClose =
    isClose &&
    expected != null &&
    actual != null &&
    terisi(actualTeks) &&
    actualNum >= 0 &&
    (selisih == null || selisih === 0 || note.trim().length > 0);

  const fmtJam = (d: Date) =>
    d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });

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
              onClick={() => actual != null && onCloseShift(actualNum, note.trim())}
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
          </div>

          {/* Rincian kas shift (dari RPC kasir_shift_preview). */}
          <div className="space-y-1.5 rounded-lg border border-[#d8e0ec] bg-white p-3 text-[12.5px]">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[#5b6b80]">Kas Awal</span>
              <span className="tnum font-semibold text-[#22374b]">
                {preview ? rupiah(preview.kasAwal) : rupiah(shift.opening_cash)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[#5b6b80]">Total Penjualan Tunai</span>
              <span className="tnum font-semibold text-[#22374b]">
                {preview ? rupiah(preview.tunai) : '…'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[#5b6b80]">Total Non-Tunai (QRIS/Transfer)</span>
              <span className="tnum font-semibold text-[#22374b]">
                {preview ? rupiah(preview.nonTunai) : '…'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[#5b6b80]">Total Pengeluaran</span>
              <span className="tnum font-semibold text-[#c92a2a]">
                {preview ? `- ${rupiah(preview.pengeluaran)}` : '…'}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2 border-t border-[#eef2f7] pt-2">
              <span className="font-semibold text-[#35485c]">Total Seharusnya</span>
              <span className="tnum text-[15px] font-bold text-[#134a85]">
                {expected != null ? rupiah(expected) : '…'}
              </span>
            </div>
          </div>

          <div>
            <label className="frm-label" htmlFor="shift-aktual">
              Kas Akhir Fisik di Laci <span className="text-[#c92a2a]">*</span>
            </label>
            <RupiahInput
              id="shift-aktual"
              ariaLabel="Kas akhir fisik di laci"
              className="frm-input h-9 w-full text-[14px] font-semibold"
              value={actual ?? 0}
              min={0}
              onChange={setActual}
              onRawChange={setActualTeks}
              autoFocus
            />
            {!terisi(actualTeks) ? (
              <p className="mt-1 text-[11px] font-semibold text-[#b0720a]">
                Wajib diisi angka sesuai uang fisik di laci.
              </p>
            ) : null}
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

          {selisih != null && selisih !== 0 ? (
            <div>
              <label className="frm-label" htmlFor="shift-catatan">
                Catatan Selisih <span className="text-[#c92a2a]">*</span>
              </label>
              <textarea
                id="shift-catatan"
                className="frm-input min-h-[64px] w-full py-1.5 text-[12.5px]"
                placeholder="mis. kurang Rp 5.000 karena kembalian tidak dicatat"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              {!note.trim() ? (
                <p className="mt-1 text-[11px] font-semibold text-[#e03131]">
                  Kas tidak pas — catatan wajib diisi.
                </p>
              ) : null}
            </div>
          ) : null}

          <p className="text-[11px] leading-relaxed text-[#7a8ba0]">
            Total Seharusnya = Kas Awal + Penjualan Tunai − Pengeluaran. Selisih dihitung dari Kas
            Akhir Fisik dikurangi Total Seharusnya. Setelah shift ditutup, transaksi dikunci sampai
            shift baru dibuka.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          <div className="grid grid-cols-2 gap-1.5 rounded-lg bg-[#f6f9fd] p-3 text-[12px]">
            <div className="flex justify-between gap-2">
              <span className="text-[#5b6b80]">Tanggal</span>
              <span className="truncate font-semibold text-[#22374b]">{fmtJam(now)}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-[#5b6b80]">Jam</span>
              <span className="tnum truncate font-semibold text-[#22374b]">
                {now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            </div>
            <div className="col-span-2 flex justify-between gap-2 border-t border-[#eef2f7] pt-1.5">
              <span className="text-[#5b6b80]">Nama Kasir</span>
              <span className="truncate font-semibold text-[#22374b]">{cashierName || 'Kasir'}</span>
            </div>
          </div>

          <div>
            <label className="frm-label" htmlFor="shift-awal">
              Uang Modal Awal di Laci <span className="text-[#c92a2a]">*</span>
            </label>
            <RupiahInput
              id="shift-awal"
              ariaLabel="Uang modal awal"
              className="frm-input h-9 w-full text-[14px] font-semibold"
              value={opening}
              min={0}
              onChange={setOpening}
              onRawChange={setOpeningTeks}
              autoFocus
            />
            {!validOpen ? (
              <p className="mt-1 text-[11px] font-semibold text-[#b0720a]">
                Wajib diisi angka (tidak boleh kosong atau huruf).
              </p>
            ) : null}
          </div>
          <p className="text-[12px] leading-relaxed text-[#5b6b80]">
            Isi jumlah uang tunai yang ada di laci saat memulai shift. Transaksi yang disimpan
            selama shift berjalan akan dicatat ke shift ini (ID SHIFT-YYYYMMDD-0001) untuk laporan
            per kasir dan penghitungan kas saat tutup.
          </p>
        </div>
      )}
    </Modal>
  );
}
