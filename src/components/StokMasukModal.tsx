'use client';

import * as React from 'react';
import { Loader2, Minus, PackagePlus, Plus } from 'lucide-react';

import { Modal } from '@/components/Modal';
import { RupiahInput } from '@/components/RupiahInput';
import { angka } from '@/lib/format';
import type { Product } from '@/lib/types';

/**
 * Modal penyesuaian stok (Fitur #5): Tambah (stok masuk) / Kurangi (stok keluar)
 * dengan keterangan opsional. Pemanggil (ProdukScreen) bertanggung jawab
 * memanggil `stockApi.adjust` / `productsApi.adjustStock` lewat `onAdjust`;
 * komponen hanya menampilkan & menghitung delta bertanda.
 */
export function StokMasukModal({
  open,
  product,
  busy,
  onClose,
  onAdjust,
}: {
  open: boolean;
  product: Product | null;
  busy: boolean;
  onClose: () => void;
  onAdjust: (delta: number, keterangan: string) => void;
}) {
  const [arah, setArah] = React.useState<'masuk' | 'keluar'>('masuk');
  const [qty, setQty] = React.useState(0);
  const [keterangan, setKeterangan] = React.useState('');

  React.useEffect(() => {
    if (open) {
      setArah('masuk');
      setQty(0);
      setKeterangan('');
    }
  }, [open, product?.id]);

  const valid = qty > 0;
  const maxKeluar = arah === 'keluar' && product ? product.stock : null;
  const melebihi = maxKeluar != null && qty > maxKeluar;

  return (
    <Modal
      open={open}
      title={product ? `Atur Stok — ${product.name}` : 'Atur Stok'}
      onClose={() => (busy ? undefined : onClose())}
      width="max-w-sm"
      footer={
        <>
          <button type="button" className="btn-outline" onClick={onClose} disabled={busy}>
            Batal
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!valid || melebihi || busy}
            data-loading={busy}
            onClick={() => onAdjust(arah === 'masuk' ? qty : -qty, keterangan.trim())}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackagePlus className="h-4 w-4" />}
            {busy ? 'Menyimpan…' : arah === 'masuk' ? 'Tambah Stok' : 'Kurangi Stok'}
          </button>
        </>
      }
    >
      {product ? (
        <div className="space-y-2.5">
          <div className="flex justify-between gap-2 rounded-lg bg-[#f6f9fd] px-3 py-2 text-[12px]">
            <span className="text-[#5b6b80]">Stok saat ini</span>
            <span className="tnum font-bold text-[#134a85]">
              {angka(product.stock)} {product.unit || ''}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-[12.5px] font-semibold transition ${
                arah === 'masuk'
                  ? 'border-[#1b5fa8] bg-[#e8f1fa] text-[#1b5fa8]'
                  : 'border-[#cdd8e6] bg-white text-[#5b6b80] hover:bg-[#f6f9fd]'
              }`}
              onClick={() => {
                setArah('masuk');
                setQty(0);
              }}
            >
              <Plus className="h-3.5 w-3.5" /> Masuk
            </button>
            <button
              type="button"
              className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-[12.5px] font-semibold transition ${
                arah === 'keluar'
                  ? 'border-[#e03131] bg-[#fff0f0] text-[#e03131]'
                  : 'border-[#cdd8e6] bg-white text-[#5b6b80] hover:bg-[#f6f9fd]'
              }`}
              onClick={() => {
                setArah('keluar');
                setQty(0);
              }}
            >
              <Minus className="h-3.5 w-3.5" /> Keluar
            </button>
          </div>

          <div>
            <label className="frm-label" htmlFor="stok-qty">
              Jumlah
            </label>
            <RupiahInput
              id="stok-qty"
              ariaLabel="Jumlah stok"
              className="frm-input h-9 w-full text-[14px] font-semibold"
              value={qty}
              min={0}
              onChange={setQty}
              autoFocus
            />
            {melebihi ? (
              <p className="mt-1 text-[11px] font-semibold text-[#e03131]" data-testid="stok-lebih">
                Max {angka(maxKeluar)} — tidak bisa {arah} melebihi stok tersedia.
              </p>
            ) : null}
          </div>

          <div>
            <label className="frm-label" htmlFor="stok-keterangan">
              Keterangan <span className="font-normal text-[#9fb0c4]">(opsional)</span>
            </label>
            <input
              id="stok-keterangan"
              className="frm-input h-9 w-full text-[13px]"
              placeholder="cth: stok masuk dari supplier"
              aria-label="Keterangan stok"
              value={keterangan}
              onChange={(e) => setKeterangan(e.target.value)}
            />
          </div>

          <p className="text-[11px] leading-relaxed text-[#7a8ba0]">
            Penyesuaian ini langsung mengubah stok dan dicatat ke <b>kartu stok</b> produk
            (masuk/keluar) untuk jejak audit.{' '}
            {arah === 'keluar' ? `Sisa ${product.unit || ''} saat ini ${angka(product.stock)}.` : ''}
          </p>
        </div>
      ) : (
        <p className="text-[12.5px] text-[#7a8ba0]">Pilih produk terlebih dahulu.</p>
      )}
    </Modal>
  );
}