'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Eye,
  FileSpreadsheet,
  Loader2,
  Pencil,
  Printer,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';

import { purchasesApi, suppliersApi } from '@/lib/api';
import { angka, isoHariIni, isoHariLalu, rupiah, tanggalWaktu } from '@/lib/format';
import { cetakHtml, esc } from '@/lib/ekspor';
import { useToast } from '@/components/Toast';
import { useButtonGuard, useClickCooldown } from '@/lib/useButtonGuard';
import { Modal } from '@/components/Modal';
import type { PurchaseItemRecord, PurchaseRecord, Supplier } from '@/lib/types';

const STATUS_LABEL: Record<string, string> = { lunas: 'Lunas', hutang: 'Hutang' };

/**
 * Pembelian > Riwayat — daftar seluruh transaksi pembelian dengan filter
 * tanggal / supplier, pencarian No Faktur & supplier, detail item, cetak,
 * dan hapus (untuk koreksi salah input).
 */
export default function RiwayatPembelianScreen() {
  const toast = useToast();
  const router = useRouter();
  const [suppliers, setSuppliers] = React.useState<Supplier[]>([]);
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const [supplier, setSupplier] = React.useState('');
  const [q, setQ] = React.useState('');
  const [rows, setRows] = React.useState<PurchaseRecord[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [ready, setReady] = React.useState(false);

  const [detail, setDetail] = React.useState<PurchaseRecord | null>(null);
  const [detailItems, setDetailItems] = React.useState<PurchaseItemRecord[]>([]);
  const [detailLoading, setDetailLoading] = React.useState(false);

  const [hapus, setHapus] = React.useState<PurchaseRecord | null>(null);

  const ui = useClickCooldown(1200);
  const hapusGuard = useButtonGuard();

  // Tanggal default 30 hari terakhir — diisi di klien hindari mismatch hidrasi.
  React.useEffect(() => {
    setFrom(isoHariLalu(29));
    setTo(isoHariIni());
    setReady(true);
  }, []);

  React.useEffect(() => {
    void suppliersApi.list().then((r) => {
      if (r.ok) setSuppliers(r.data);
    });
  }, []);

  const muat = React.useCallback(async () => {
    setLoading(true);
    const r = await purchasesApi.history({ from, to, supplier, q });
    setLoading(false);
    if (!r.ok) {
      toast.error('Gagal memuat riwayat', r.error);
      setRows([]);
      return;
    }
    setRows(r.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, supplier, q]);

  // Muat ulang saat filter berubah (search di-debounce ringan).
  React.useEffect(() => {
    if (!ready) return;
    const t = window.setTimeout(() => void muat(), 250);
    return () => window.clearTimeout(t);
  }, [ready, muat]);

  async function bukaDetail(p: PurchaseRecord) {
    setDetail(p);
    setDetailItems([]);
    setDetailLoading(true);
    const r = await purchasesApi.items(p.id);
    setDetailLoading(false);
    if (!r.ok) {
      toast.error('Gagal memuat detail', r.error);
      return;
    }
    setDetailItems(r.data);
  }

  /** Buka form Pembelian dalam mode Edit untuk PO ini. */
  function bukaEdit(p: PurchaseRecord) {
    setDetail(null);
    router.push(`/pembelian?edit=${p.id}`);
  }

  function cetak(p: PurchaseRecord, items: PurchaseItemRecord[]) {
    const total = items.reduce((s, it) => s + (Number(it.subtotal) || 0), 0);
    const barisHtml = items
      .map(
        (it, i) => `<tr>
          <td class="num">${i + 1}</td>
          <td>${esc(it.product_name)}</td>
          <td>${esc(it.unit || '-')}</td>
          <td class="num">${angka(it.qty)}</td>
          <td class="num">${rupiah(it.cost)}</td>
          <td class="num">${rupiah(it.subtotal)}</td>
        </tr>`,
      )
      .join('');
    cetakHtml(
      `Faktur ${p.invoice_no ?? p.id.slice(0, 8)}`,
      `
      <h1>Faktur Pembelian</h1>
      <p class="muted">No Faktur: <b>${esc(p.invoice_no ?? p.id.slice(0, 8))}</b></p>
      <p class="muted">Tanggal: ${esc(tanggalWaktu(p.created_at))}</p>
      <p class="muted">Supplier: <b>${esc(p.supplier_name || '-')}</b></p>
      <p class="muted">Status: <b>${STATUS_LABEL[p.status] ?? p.status}</b></p>
      <table>
        <thead><tr><th>#</th><th>Nama Barang</th><th>Satuan</th><th class="num">Jumlah</th><th class="num">Harga Beli</th><th class="num">Subtotal</th></tr></thead>
        <tbody>${barisHtml}</tbody>
        <tfoot><tr><td colspan="5" class="num"><b>Total</b></td><td class="num"><b>${rupiah(total)}</b></td></tr></tfoot>
      </table>
      ${p.note ? `<p class="muted">Catatan: ${esc(p.note)}</p>` : ''}`,
    );
  }

  async function konfirmasiHapus() {
    if (!hapus) return;
    const target = hapus;
    await hapusGuard.guard(
      async () => {
        const r = await purchasesApi.remove(target.id);
        if (!r.ok) {
          toast.error('Gagal menghapus', r.error);
          return;
        }
        toast.ok('Pembelian dihapus', 'Stok barang terkait sudah dikembalikan.');
        setHapus(null);
        if (detail?.id === target.id) setDetail(null);
        await muat();
      },
      { pesanTunggu: 'Menghapus pembelian…' },
    );
  }

  const totalNilai = rows.reduce((s, p) => s + (Number(p.total) || 0), 0);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ------------------------- SUB-RIBBON -------------------------- */}
      <div className="sub-ribbon">
        <span className="rb-label">Pembelian · Riwayat Transaksi</span>
        <Link href="/pembelian" className="rb-btn">
          <ArrowLeft className="h-3.5 w-3.5" /> Input PO
        </Link>
        <span className="rb-sep" />
        <button
          type="button"
          className="rb-btn-primary"
          onClick={() => ui.run(muat, 'riwayat-muat')}
          disabled={ui.locked('riwayat-muat') || loading}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Muat Ulang
        </button>
      </div>

      {/* ------------------------------ filter ---------------------------- */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[#d8e0ec] bg-white p-3">
        <h2 className="mr-1 flex items-center gap-1.5 text-[13px] font-bold text-[#1b3a5c]">
          <FileSpreadsheet className="h-4 w-4 text-[#1b5fa8]" /> Riwayat Transaksi Pembelian
        </h2>

        <div className="flex items-center gap-1.5">
          <input
            type="date"
            className="input h-8 w-[140px] text-[12px]"
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
            aria-label="Dari tanggal"
          />
          <span className="text-[12px] text-[#9fb0c4]">s/d</span>
          <input
            type="date"
            className="input h-8 w-[140px] text-[12px]"
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
            aria-label="Sampai tanggal"
          />
        </div>

        <select
          className="input h-8 w-[180px] cursor-pointer text-[12px]"
          value={supplier}
          onChange={(e) => setSupplier(e.target.value)}
          aria-label="Filter supplier"
        >
          <option value="">Semua Supplier</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>

        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#9fb0c4]" />
          <input
            className="input h-8 pl-8 text-[12px]"
            placeholder="Cari No Faktur / Nama Supplier…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        <span className="ml-auto text-[11.5px] text-[#7a8ba0]">
          <b className="tnum text-[#35485c]">{rows.length}</b> transaksi · total{' '}
          <b className="tnum text-[#35485c]">{rupiah(totalNilai)}</b>
        </span>
      </div>

      {/* ------------------------------ tabel ----------------------------- */}
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <div className="card overflow-hidden p-0">
          <table className="w-full text-[12.5px]">
            <thead className="sticky top-0 bg-[#f6f9fd]">
              <tr className="text-left text-[11px] uppercase tracking-wide text-[#5b6b80]">
                <th className="px-3 py-2">No Faktur</th>
                <th className="px-3 py-2">Tanggal</th>
                <th className="px-3 py-2">Supplier</th>
                <th className="px-3 py-2 text-right">Total Item</th>
                <th className="px-3 py-2 text-right">Total Belanja</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center text-[12px] text-zinc-400">
                    <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> Memuat riwayat…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center text-[12px] text-zinc-400">
                    Tidak ada pembelian pada periode / filter ini.
                  </td>
                </tr>
              ) : (
                rows.map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => void bukaDetail(p)}
                    className="cursor-pointer border-t border-zinc-100 hover:bg-[#f6f9fd]"
                  >
                    <td className="px-3 py-2 font-semibold text-[#1b3a5c]">
                      {p.invoice_no ?? `#${p.id.slice(0, 8)}`}
                    </td>
                    <td className="px-3 py-2 text-[#4a5b70]">{tanggalWaktu(p.created_at)}</td>
                    <td className="px-3 py-2">{p.supplier_name || '-'}</td>
                    <td className="tnum px-3 py-2 text-right">{angka(p.total_item ?? 0)}</td>
                    <td className="tnum px-3 py-2 text-right font-semibold">{rupiah(p.total)}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-[10.5px] font-bold ${
                          p.status === 'hutang'
                            ? 'bg-[#fff3bf] text-[#8a6d00]'
                            : 'bg-[#d3f9d8] text-[#237a3b]'
                        }`}
                      >
                        {STATUS_LABEL[p.status] ?? p.status}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          title="Detail"
                          aria-label="Detail"
                          className="rounded p-1.5 text-[#1b5fa8] hover:bg-[#e8f1fa]"
                          onClick={(e) => {
                            e.stopPropagation();
                            void bukaDetail(p);
                          }}
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          title="Edit PO"
                          aria-label="Edit PO"
                          className="rounded p-1.5 text-[#8a6d00] hover:bg-[#fff3bf]"
                          onClick={(e) => {
                            e.stopPropagation();
                            bukaEdit(p);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          title="Hapus"
                          aria-label="Hapus"
                          className="rounded p-1.5 text-[#c92a2a] hover:bg-[#ffe3e3]"
                          onClick={(e) => {
                            e.stopPropagation();
                            setHapus(p);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ------------------------------ detail ---------------------------- */}
      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={`Detail Pembelian ${detail?.invoice_no ?? ''}`}
        width="max-w-3xl"
        footer={
          detail ? (
            <>
              <button
                type="button"
                className="btn-outline"
                onClick={() => ui.run(() => cetak(detail, detailItems), 'riwayat-cetak')}
                disabled={ui.locked('riwayat-cetak') || !detailItems.length}
              >
                <Printer className="h-3.5 w-3.5" /> Print
              </button>
              <button
                type="button"
                className="btn-outline"
                onClick={() => bukaEdit(detail)}
              >
                <Pencil className="h-3.5 w-3.5" /> Edit
              </button>
              <button
                type="button"
                className="btn-danger"
                onClick={() => setHapus(detail)}
              >
                <Trash2 className="h-3.5 w-3.5" /> Hapus
              </button>
              <button type="button" className="btn-primary" onClick={() => setDetail(null)}>
                Tutup
              </button>
            </>
          ) : null
        }
      >
        {detail ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[12.5px] sm:grid-cols-4">
              <div>
                <p className="text-[10.5px] uppercase text-zinc-400">No Faktur</p>
                <p className="font-semibold">{detail.invoice_no ?? `#${detail.id.slice(0, 8)}`}</p>
              </div>
              <div>
                <p className="text-[10.5px] uppercase text-zinc-400">Tanggal</p>
                <p className="font-semibold">{tanggalWaktu(detail.created_at)}</p>
              </div>
              <div>
                <p className="text-[10.5px] uppercase text-zinc-400">Supplier</p>
                <p className="font-semibold">{detail.supplier_name || '-'}</p>
              </div>
              <div>
                <p className="text-[10.5px] uppercase text-zinc-400">Status</p>
                <p className="font-semibold">{STATUS_LABEL[detail.status] ?? detail.status}</p>
              </div>
            </div>

            <div className="overflow-hidden rounded-md border border-[#d8e0ec]">
              <table className="w-full text-[12.5px]">
                <thead className="bg-[#f6f9fd]">
                  <tr className="text-left text-[11px] uppercase tracking-wide text-[#5b6b80]">
                    <th className="px-3 py-2">Nama Barang</th>
                    <th className="px-3 py-2">Satuan</th>
                    <th className="px-3 py-2 text-right">Jumlah</th>
                    <th className="px-3 py-2 text-right">Harga Beli</th>
                    <th className="px-3 py-2 text-right">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {detailLoading ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-zinc-400">
                        <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                      </td>
                    </tr>
                  ) : detailItems.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-zinc-400">
                        Tidak ada item.
                      </td>
                    </tr>
                  ) : (
                    detailItems.map((it, i) => (
                      <tr key={i} className="border-t border-zinc-100">
                        <td className="px-3 py-2">{it.product_name}</td>
                        <td className="px-3 py-2 text-[#5b6b80]">{it.unit || '-'}</td>
                        <td className="tnum px-3 py-2 text-right">{angka(it.qty)}</td>
                        <td className="tnum px-3 py-2 text-right">{rupiah(it.cost)}</td>
                        <td className="tnum px-3 py-2 text-right font-semibold">{rupiah(it.subtotal)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
                {!detailLoading && detailItems.length > 0 ? (
                  <tfoot>
                    <tr className="border-t border-[#d8e0ec] bg-[#f6f9fd]">
                      <td colSpan={4} className="px-3 py-2 text-right font-bold">
                        Total
                      </td>
                      <td className="tnum px-3 py-2 text-right font-bold">
                        {rupiah(detailItems.reduce((s, it) => s + (Number(it.subtotal) || 0), 0))}
                      </td>
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>

            {detail.note ? (
              <p className="text-[12px] text-[#5b6b80]">
                Catatan: <b>{detail.note}</b>
              </p>
            ) : null}
          </div>
        ) : null}
      </Modal>

      {/* ------------------------------ hapus ----------------------------- */}
      <Modal
        open={!!hapus}
        onClose={() => setHapus(null)}
        title="Yakin hapus PO ini?"
        width="max-w-md"
        footer={
          <>
            <button
              type="button"
              className="btn-outline"
              onClick={() => setHapus(null)}
              disabled={hapusGuard.busy}
            >
              Batal
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={() => void konfirmasiHapus()}
              disabled={hapusGuard.busy}
              data-loading={hapusGuard.busy}
            >
              {hapusGuard.busy ? 'Menghapus…' : 'Ya, Hapus'}
            </button>
          </>
        }
      >
        <p className="text-[13px] text-[#35485c]">
          PO <b>{hapus?.invoice_no ?? hapus?.id.slice(0, 8)}</b> dari{' '}
          <b>{hapus?.supplier_name || '-'}</b> akan dihapus. <b>Stok akan dikembalikan.</b>{' '}
          Tindakan ini tidak bisa dibatalkan.
        </p>
      </Modal>
    </div>
  );
}
