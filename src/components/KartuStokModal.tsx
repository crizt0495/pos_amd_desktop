'use client';

import * as React from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Clock, Loader2, PackageOpen } from 'lucide-react';

import { Modal } from '@/components/Modal';
import { angka, tanggalWaktu } from '@/lib/format';
import type { Product, StockLog } from '@/lib/types';

const TIPE: Record<StockLog['tipe'], { label: string; masuk: boolean }> = {
  terjual: { label: 'Penjualan', masuk: false },
  retur: { label: 'Retur', masuk: true },
  stok_masuk: { label: 'Stok masuk', masuk: true },
  stok_keluar: { label: 'Stok keluar', masuk: false },
  void: { label: 'Pembatalan', masuk: true },
};

/**
 * Kartu Stok (Fitur #5): buku besar mutasi stok per produk.
 * Data `logs` diambil pemanggil (ProdukScreen) via `stockApi.logs`;
 * tombol Muat Ulang memanggil `onRefresh`.
 */
export function KartuStokModal({
  open,
  product,
  logs,
  loading,
  onClose,
  onRefresh,
}: {
  open: boolean;
  product: Product | null;
  logs: StockLog[];
  loading: boolean;
  onClose: () => void;
  onRefresh: () => void;
}) {
  return (
    <Modal
      open={open}
      title={product ? `Kartu Stok — ${product.name}` : 'Kartu Stok'}
      onClose={onClose}
      width="max-w-2xl"
      footer={
        <>
          <button type="button" className="btn-outline" onClick={onClose}>
            Tutup
          </button>
          <button type="button" className="btn-outline" onClick={onRefresh} disabled={loading} data-loading={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock className="h-4 w-4" />}
            Muat Ulang
          </button>
        </>
      }
    >
      {product ? (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-1.5 rounded-lg bg-[#f6f9fd] p-3 text-[12px]">
            <div className="flex flex-col gap-0.5">
              <span className="text-[#5b6b80]">Stok saat ini</span>
              <span className="tnum text-[15px] font-bold text-[#134a85]">
                {angka(product.stock)} {product.unit || ''}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[#5b6b80]">Batasan</span>
              <span className="tnum font-semibold text-[#35485c]">
                min {angka(product.min_stock)} {product.unit || ''}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[#5b6b80]">Mutasi tercatat</span>
              <span className="tnum font-semibold text-[#35485c]">{logs.length} baris</span>
            </div>
          </div>

          <div className="max-h-[320px] overflow-auto rounded-lg border border-[#e6edf4]">
            <table className="w-full min-w-[520px] border-collapse">
              <thead className="sticky top-0 bg-[#f6f9fd]">
                <tr>
                  <th className="th w-[130px]">Tanggal</th>
                  <th className="th w-[80px]">Mutasi</th>
                  <th className="th w-[90px] text-right">Masuk</th>
                  <th className="th w-[90px] text-right">Keluar</th>
                  <th className="th w-[70px] text-right">Stok</th>
                  <th className="th">Keterangan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#eef2f7]">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-[12.5px] text-[#9fb0c4]">
                      Memuat kartu stok…
                    </td>
                  </tr>
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center">
                      <PackageOpen className="mx-auto h-7 w-7 text-[#c9d6e5]" />
                      <p className="mt-1.5 text-[12.5px] text-[#9fb0c4]">
                        Belum ada mutasi tercatat. Penjualan, retur, pembatalan, dan penyesuaian
                        stok akan muncul di sini.
                      </p>
                    </td>
                  </tr>
                ) : (
                  logs.map((l) => {
                    const m = TIPE[l.tipe] ?? { label: l.tipe, masuk: l.qty >= 0 };
                    const qtyAbs = Math.abs(l.qty);
                    return (
                      <tr key={l.id} className="bg-white transition hover:bg-[#f6f9fd]">
                        <td className="td text-[11.5px] text-[#5b6b80]">{tanggalWaktu(l.created_at)}</td>
                        <td className="td">
                          <span
                            className={`chip !px-1.5 !py-0.5 !text-[10.5px] ${
                              m.masuk ? 'text-[#0a7a3d]' : 'text-[#e03131]'
                            }`}
                          >
                            {m.masuk ? <ArrowDownToLine className="mr-1 inline h-3 w-3" /> : <ArrowUpFromLine className="mr-1 inline h-3 w-3" />}
                            {m.label}
                          </span>
                        </td>
                        <td className="td tnum text-right font-semibold text-[#0a7a3d]">
                          {m.masuk ? `+${angka(qtyAbs)}` : ''}
                        </td>
                        <td className="td tnum text-right font-semibold text-[#e03131]">
                          {m.masuk ? '' : `-${angka(qtyAbs)}`}
                        </td>
                        <td className="td tnum text-right font-bold text-[#22374b]">
                          {l.stok_sesudah != null ? angka(l.stok_sesudah) : '—'}
                        </td>
                        <td className="td text-[11.5px] text-[#5b6b80]">{l.keterangan || '—'}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <p className="text-[11px] leading-relaxed text-[#7a8ba0]">
            Setiap penjualan (keluar), retur/pembatalan (masuk), dan penyesuaian stok manual
            tercatat otomatis di sini. Perubahan stok via tombol ± cepat di daftar produk juga
            tersimpan di kartu (setelah migrasi terpasang).
          </p>
        </div>
      ) : (
        <p className="text-[12.5px] text-[#7a8ba0]">Pilih produk terlebih dahulu.</p>
      )}
    </Modal>
  );
}