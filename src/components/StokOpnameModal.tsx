'use client';

import * as React from 'react';
import { ClipboardCheck, Loader2, Minus, Plus } from 'lucide-react';

import { Modal } from '@/components/Modal';
import { RupiahInput } from '@/components/RupiahInput';
import { angka } from '@/lib/format';
import type { Product } from '@/lib/types';

/**
 * Stok Opname — koreksi stok karena selisih fisik di gudang.
 *
 * Admin memasukkan **stok fisik** hasil hitung ulang; selisih terhadap stok
 * sistem dihitung otomatis (`fisik - sistem`) dan dikirim ke pemanggil
 * (ProdukScreen) untuk dicatat sebagai ADJUSTMENT di Pergerakan Stok lewat RPC
 * `kasir_opname_stock`. Bila tidak ada selisih, tidak ada mutasi yang dicatat.
 */
export function StokOpnameModal({
  open,
  product,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  product: Product | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (stokFisik: number, keterangan: string) => void;
}) {
  const [fisik, setFisik] = React.useState(0);
  const [keterangan, setKeterangan] = React.useState('');

  React.useEffect(() => {
    if (open) {
      setFisik(product ? product.stock : 0);
      setKeterangan('');
    }
  }, [open, product?.id, product?.stock]);

  const sistem = product?.stock ?? 0;
  const delta = Math.round((fisik - sistem) * 100) / 100;
  const valid = fisik >= 0 && delta !== 0;

  return (
    <Modal
      open={open}
      title={product ? `Stok Opname — ${product.name}` : 'Stok Opname'}
      onClose={() => (busy ? undefined : onClose())}
      width="max-w-md"
      footer={
        <>
          <button type="button" className="btn-outline" onClick={onClose} disabled={busy}>
            Batal
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!valid || busy}
            data-loading={busy}
            onClick={() => onSubmit(fisik, keterangan.trim())}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}
            {busy ? 'Menyimpan…' : 'Simpan Opname'}
          </button>
        </>
      }
    >
      {product ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-[#d8e0ec] bg-[#f6f9fd] px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#5b6b80]">
                Stok Sistem
              </p>
              <p className="tnum mt-0.5 text-[18px] font-bold text-[#1b3a5c]">
                {angka(sistem)} <span className="text-[12px] font-normal text-[#7a8ba0]">{product.unit}</span>
              </p>
            </div>
            <div className="rounded-lg border border-[#cfe0f5] bg-[#eef5fd] px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#1b5fa8]">
                Stok Fisik
              </p>
              <RupiahInput
                ariaLabel="Stok fisik"
                className="h-8 w-full bg-white text-[18px] font-bold text-[#134a85]"
                value={fisik}
                min={0}
                onChange={setFisik}
                autoFocus
              />
            </div>
          </div>

          <div
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-[12.5px] font-semibold ${
              delta === 0
                ? 'bg-[#f0f4f8] text-[#5b6b80]'
                : delta > 0
                  ? 'bg-[#eafaf0] text-[#2f9e44]'
                  : 'bg-[#fff0f0] text-[#c92a2a]'
            }`}
          >
            {delta === 0 ? (
              <ClipboardCheck className="h-4 w-4" />
            ) : delta > 0 ? (
              <Plus className="h-4 w-4" />
            ) : (
              <Minus className="h-4 w-4" />
            )}
            Selisih: {delta > 0 ? '+' : ''}
            {angka(delta)} {product.unit}
            {delta === 0 ? ' (stok sudah cocok)' : ''}
          </div>

          <div>
            <label className="frm-label" htmlFor="opname-keterangan">
              Keterangan <span className="font-normal text-[#9fb0c4]">(opsional)</span>
            </label>
            <input
              id="opname-keterangan"
              className="frm-input h-9 w-full text-[13px]"
              placeholder="cth: barang rusak / salah hitung di gudang"
              value={keterangan}
              onChange={(e) => setKeterangan(e.target.value)}
            />
          </div>

          <p className="text-[11px] leading-relaxed text-[#7a8ba0]">
            Stok sistem langsung disesuaikan menjadi stok fisik dan selisihnya dicatat
            sebagai <b>ADJUSTMENT</b> di Laporan &gt; Pergerakan Stok, lengkap dengan
            keterangan di atas. Tidak ada selisih = tidak ada catatan.
          </p>
        </div>
      ) : (
        <p className="text-[12.5px] text-[#7a8ba0]">Pilih produk terlebih dahulu.</p>
      )}
    </Modal>
  );
}
