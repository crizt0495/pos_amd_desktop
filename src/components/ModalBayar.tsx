'use client';

import * as React from 'react';
import { CheckCircle2, Landmark, Loader2, QrCode, Wallet, X } from 'lucide-react';

import { RupiahInput } from '@/components/RupiahInput';
import { rupiah } from '@/lib/format';
import type { PaymentMethod } from '@/lib/types';

/**
 * Modal Pembayaran — pengganti kotak bayar inline.
 *
 * - Responsive HP tegak: konten scrollable (`overflow-y-auto`) dengan
 *   padding-bawah besar supaya field Bayar & Catatan tidak tertutup keyboard
 *   dan tidak perlu memiringkan HP.
 * - Metode pembayaran berupa 3 kartu tombol besar (Tunai / Transfer / QRIS).
 * - Footer 2 tombol (Batal / Simpan Transaksi) selalu terlihat di bawah.
 *
 * Nilai metode tersimpan: `cash` | `transfer` | `qris`.
 */

const METODE: { key: PaymentMethod; label: string; Icon: typeof Wallet; sub: string }[] = [
  { key: 'cash', label: 'Tunai', Icon: Wallet, sub: 'uang fisik' },
  { key: 'transfer', label: 'Transfer', Icon: Landmark, sub: 'bank / EDC' },
  { key: 'qris', label: 'QRIS', Icon: QrCode, sub: 'scan QR' },
];

export type ShortcutBayar = 'pas' | '50' | '100' | '+10' | '+50';

const SHORTCUTS: { key: ShortcutBayar; label: string }[] = [
  { key: 'pas', label: 'Uang Pas' },
  { key: '50', label: 'Rp 50.000' },
  { key: '100', label: 'Rp 100.000' },
  { key: '+10', label: '+10rb' },
  { key: '+50', label: '+50rb' },
];

export function ModalBayar({
  open,
  total,
  subtotal,
  discount,
  method,
  onMethod,
  bayar,
  onBayar,
  onShortcut,
  kembalian,
  kurang,
  note,
  onNote,
  busy,
  onBatal,
  onSimpan,
}: {
  open: boolean;
  /** Total tagihan (setelah diskon). */
  total: number;
  subtotal: number;
  /** Total potongan per baris. */
  discount: number;
  method: PaymentMethod;
  onMethod: (m: PaymentMethod) => void;
  /** Teks input Bayar (diformat ribuan saat diketik di RupiahInput). */
  bayar: string;
  onBayar: (v: string) => void;
  onShortcut: (s: ShortcutBayar) => void;
  kembalian: number;
  kurang: number;
  note: string;
  onNote: (v: string) => void;
  busy: boolean;
  onBatal: () => void;
  onSimpan: () => void;
}) {
  const bayarRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!open) return;
    // Esc = Batal. Saat sedang memproses, jangan izinkan menutup.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onBatal();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, busy, onBatal]);

  if (!open) return null;

  const nonTunai = method !== 'cash';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#10365c]/45 backdrop-blur-[2px] sm:items-center sm:p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Pembayaran"
        className="flex max-h-[90vh] w-full max-w-[540px] animate-pop-in flex-col overflow-hidden rounded-t-2xl bg-white shadow-[0_20px_50px_rgba(16,40,70,0.35)] sm:rounded-2xl"
      >
        {/* ============================ HEADER =========================== */}
        <div className="flex shrink-0 items-center justify-between gap-3 bg-gradient-to-r from-[#2470c0] to-[#134a85] px-4 py-3 sm:px-5">
          <h2 className="text-[15px] font-bold text-white">Pembayaran</h2>
          <div className="flex items-center gap-3">
            <div className="text-right leading-tight">
              <p className="text-[9.5px] font-bold uppercase tracking-wider text-white/70">Total Tagihan</p>
              <p className="tnum text-[19px] font-bold text-white">{rupiah(total)}</p>
            </div>
            <button
              type="button"
              onClick={onBatal}
              disabled={busy}
              aria-label="Tutup"
              className="grid h-7 w-7 place-items-center rounded text-white/80 transition hover:bg-white/20 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* ============================ ISI ============================= */}
        {/* overflow-y-auto + pb-28 (112px) => semua field tetap scrollable
            dan tidak ketutup keyboard/navi HP tegak. */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-28 pt-4 sm:px-5">
          {/* Ringkasan: Subtotal/Diskon (kiri) + Total (kanan) */}
          <div className="grid gap-3 sm:grid-cols-2">
            <dl className="space-y-1.5 rounded-lg border border-[#d8e0ec] bg-[#f6f9fd] px-3.5 py-3 text-[12.5px]">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-[#5b6b80]">Subtotal</dt>
                <dd className="tnum font-semibold text-[#35485c]">{rupiah(subtotal)}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-[#5b6b80]">Diskon</dt>
                <dd className="tnum font-semibold text-[#c92a2a]">
                  {discount > 0 ? `- ${rupiah(discount)}` : rupiah(0)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 border-t border-[#d8e0ec] pt-1.5">
                <dt className="font-bold text-[#22374b]">Total</dt>
                <dd className="tnum text-[15px] font-bold text-accent-600">{rupiah(total)}</dd>
              </div>
            </dl>

            <div className="flex flex-col items-end justify-center rounded-lg border border-[#ffd8a8] bg-[#fff4e6] px-3.5 py-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#a35b00]">Total Tagihan</p>
              <p className="grand-total text-[26px]">{rupiah(total)}</p>
            </div>
          </div>

          {/* Metode Pembayaran: 3 kartu tombol */}
          <div className="sm:col-span-2">
            <span className="frm-label">Metode Pembayaran</span>
            <div className="grid grid-cols-3 gap-2">
              {METODE.map(({ key, label, Icon, sub }) => {
                const aktif = method === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => onMethod(key)}
                    disabled={busy}
                    aria-pressed={aktif}
                    className={`flex min-h-[66px] flex-col items-center justify-center gap-1 rounded-xl border-2 px-1 py-3 text-center transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-60 ${
                      aktif
                        ? 'border-[#e8590c] bg-[#fff4e6] shadow-[0_0_0_2px_rgba(232,89,12,0.15)]'
                        : 'border-[#cdd8e6] bg-white hover:border-[#e8590c]/50 hover:bg-[#fffaf3]'
                    }`}
                  >
                    <Icon className={`h-6 w-6 ${aktif ? 'text-[#e8590c]' : 'text-[#5b6b80]'}`} />
                    <span className={`text-[13px] font-bold ${aktif ? 'text-[#e8590c]' : 'text-[#22374b]'}`}>
                      {label}
                    </span>
                    <span className="text-[10px] leading-none text-[#9fb0c4]">{sub}</span>
                  </button>
                );
              })}
            </div>
            {nonTunai ? (
              <p className="mt-1.5 flex items-center gap-1 text-[11px] font-semibold text-[#2f9e44]">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Nominal otomatis = total tagihan ({rupiah(total)}), tanpa kembalian.
              </p>
            ) : null}
          </div>

          {/* Bayar + Kembalian */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="frm-label" htmlFor="modal-bayar">
                Bayar
              </label>
              <RupiahInput
                id="modal-bayar"
                inputRef={bayarRef}
                autoFocus={!nonTunai}
                className="tnum h-12 w-full rounded-lg px-3 text-right text-[22px] font-bold text-[#22374b] disabled:bg-[#f1f5fa] disabled:text-[#7a8ba0]"
                value={bayar}
                onChange={(v) => onBayar(v ? String(v) : '')}
                disabled={nonTunai || busy}
                placeholder="0"
                onEnter={onSimpan}
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {SHORTCUTS.map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => onShortcut(key)}
                    disabled={nonTunai || busy}
                    className="rb-btn !h-9 !px-2.5"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div
              className={`flex flex-col justify-center rounded-lg border px-3.5 py-3 ${
                kurang > 0 ? 'border-[#ffc9c9] bg-[#fff5f5]' : 'border-[#b7e0c1] bg-[#ebfbee]'
              }`}
            >
              <p
                className={`text-[10px] font-bold uppercase tracking-wider ${
                  kurang > 0 ? 'text-[#c92a2a]' : 'text-[#2b8a3e]'
                }`}
              >
                {kurang > 0 ? 'Kurang' : 'Kembalian'}
              </p>
              <p
                className={`tnum text-[26px] font-bold leading-none ${
                  kurang > 0 ? 'text-[#e03131]' : 'text-[#2f9e44]'
                }`}
              >
                {kurang > 0 ? rupiah(kurang) : rupiah(kembalian)}
              </p>
            </div>
          </div>

          {/* Catatan (opsional) */}
          <div className="sm:col-span-2">
            <label className="frm-label" htmlFor="modal-note">
              Catatan (opsional)
            </label>
            <input
              id="modal-note"
              className="frm-input !h-10"
              placeholder="mis. uang pas, tanpa plastik…"
              value={note}
              onChange={(e) => onNote(e.target.value)}
              disabled={busy}
            />
          </div>
        </div>

        {/* ============================ FOOTER ========================== */}
        <div className="flex shrink-0 gap-2 border-t border-[#d8e0ec] bg-white px-4 py-3 sm:px-5">
          <button
            type="button"
            className="btn-outline h-11 flex-1"
            onClick={onBatal}
            disabled={busy}
          >
            Batal
            <span className="kbd">Esc</span>
          </button>
          <button
            type="button"
            className="btn-success h-11 flex-[1.6] !px-3"
            onClick={onSimpan}
            disabled={busy || kurang > 0}
            data-loading={busy}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {busy ? 'Memproses…' : 'Simpan Transaksi'}
            <span className="kbd !border-white/40 !bg-white/20 !text-white">End</span>
          </button>
        </div>
      </div>
    </div>
  );
}