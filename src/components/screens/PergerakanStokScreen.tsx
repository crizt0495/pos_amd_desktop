'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  FileDown,
  FileSpreadsheet,
  Layers,
  Loader2,
  Printer,
  RefreshCw,
  Search,
} from 'lucide-react';

import { productsApi, stockApi } from '@/lib/api';
import { angka, isoHariIni, isoHariLalu } from '@/lib/format';
import { cetakHtml, esc, unduhExcel } from '@/lib/ekspor';
import { useToast } from '@/components/Toast';
import { useClickCooldown } from '@/lib/useButtonGuard';
import type { JenisMutasi, Product, StockMovement } from '@/lib/types';

type Preset = 'today' | '7days' | '30days' | 'all' | 'custom';

const PRESETS: { key: Preset; label: string }[] = [
  { key: 'today', label: 'Hari Ini' },
  { key: '7days', label: '7 Hari' },
  { key: '30days', label: '30 Hari' },
  { key: 'all', label: 'Semua' },
];

/** Pilihan filter jenis mutasi. */
const JENIS_FILTER: { value: string; label: string }[] = [
  { value: '', label: 'Semua Jenis' },
  { value: 'PEMBELIAN', label: 'Pembelian' },
  { value: 'PENJUALAN', label: 'Penjualan / Kasir' },
  { value: 'ADJUSTMENT', label: 'Adjustment / Opname' },
  { value: 'RETUR', label: 'Retur' },
  { value: 'PEMBATALAN', label: 'Pembatalan / Void' },
];

/** Label & warna lencana per jenis mutasi. */
const JENIS_META: Record<string, { label: string; cls: string }> = {
  PEMBELIAN: { label: 'Pembelian', cls: 'bg-[#e8f1fa] text-[#1b5fa8]' },
  PENJUALAN: { label: 'Penjualan', cls: 'bg-[#fff0f0] text-[#c92a2a]' },
  ADJUSTMENT: { label: 'Adjustment', cls: 'bg-[#fff8e1] text-[#a06a00]' },
  RETUR: { label: 'Retur', cls: 'bg-[#eafaf0] text-[#2f9e44]' },
  PEMBATALAN: { label: 'Pembatalan', cls: 'bg-[#f0f0f5] text-[#5b6b80]' },
  LAINNYA: { label: 'Lainnya', cls: 'bg-[#f0f0f5] text-[#5b6b80]' },
};

const meta = (jenis: string) => JENIS_META[jenis] ?? { label: jenis, cls: 'bg-[#f0f0f5] text-[#5b6b80]' };

/**
 * Laporan > Pergerakan Stok — buku besar seluruh keluar-masuk barang.
 *
 * Sumber data: `kasir_stock_logs` (kartu stok) lewat RPC `kasir_stock_movements`.
 * Setiap transaksi jual/beli/retur/pembatalan dan penyesuaian/opname otomatis
 * tercatat; kolom "Sisa Stok" mereplikasi stok Master Barang saat mutasi itu
 * terjadi. Tidak ada input manual di layar ini.
 */
export default function PergerakanStokScreen() {
  const toast = useToast();
  const ui = useClickCooldown(1200);

  const [products, setProducts] = React.useState<{ id: string; name: string }[]>([]);
  const [rows, setRows] = React.useState<StockMovement[]>([]);
  const [loading, setLoading] = React.useState(true);

  const [preset, setPreset] = React.useState<Preset>('30days');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const [productId, setProductId] = React.useState('');
  const [jenis, setJenis] = React.useState('');
  const [q, setQ] = React.useState('');
  const [qDeb, setQDeb] = React.useState('');

  React.useEffect(() => {
    setFrom(isoHariLalu(29));
    setTo(isoHariIni());
  }, []);

  React.useEffect(() => {
    void productsApi.list().then((r) => {
      if (r.ok) setProducts(r.data.map((p) => ({ id: p.id, name: p.name })));
    });
  }, []);

  // Pencarian nama/kode ditunda sedikit agar tidak memanggil server tiap ketik.
  React.useEffect(() => {
    const t = window.setTimeout(() => setQDeb(q), 350);
    return () => window.clearTimeout(t);
  }, [q]);

  const muat = React.useCallback(async () => {
    setLoading(true);
    const r = await stockApi.movements({
      from: preset === 'all' ? undefined : from,
      to: preset === 'all' ? undefined : to,
      productId,
      jenis,
      q: qDeb,
    });
    setLoading(false);
    if (!r.ok) {
      toast.error('Gagal memuat pergerakan stok', r.error);
      setRows([]);
      return;
    }
    setRows(r.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, productId, jenis, qDeb, preset]);

  React.useEffect(() => {
    void muat();
  }, [muat]);

  function pilihPreset(p: Preset) {
    setPreset(p);
    if (p === 'today') {
      setFrom(isoHariIni());
      setTo(isoHariIni());
    } else if (p === '7days') {
      setFrom(isoHariLalu(6));
      setTo(isoHariIni());
    } else if (p === '30days') {
      setFrom(isoHariLalu(29));
      setTo(isoHariIni());
    }
  }

  const periode = preset === 'all' ? 'Semua Periode' : `${from || '-'} s/d ${to || '-'}`;
  const productLabel = productId ? (products.find((p) => p.id === productId)?.name ?? 'Barang') : 'Semua Barang';
  const jenisLabel = JENIS_FILTER.find((j) => j.value === jenis)?.label ?? 'Semua Jenis';

  const totalMasuk = React.useMemo(() => rows.reduce((s, r) => s + r.masuk, 0), [rows]);
  const totalKeluar = React.useMemo(() => rows.reduce((s, r) => s + r.keluar, 0), [rows]);

  const barisHtml = rows
    .map(
      (k) => `<tr>
        <td>${esc(k.created_at ? new Date(k.created_at).toLocaleString('id-ID') : '-')}</td>
        <td>${esc(k.barcode || '-')}</td>
        <td>${esc(k.product_name)}</td>
        <td>${esc(meta(k.jenis).label)}</td>
        <td>${esc(k.no_referensi || '-')}</td>
        <td class="num">${k.masuk ? angka(k.masuk) : '-'}</td>
        <td class="num">${k.keluar ? angka(k.keluar) : '-'}</td>
        <td class="num">${k.stok_sesudah == null ? '-' : angka(k.stok_sesudah)}</td>
        <td>${esc(k.keterangan || '-')}</td>
      </tr>`,
    )
    .join('');

  const tabelHtml = `
    <p class="muted">Periode: <b>${esc(periode)}</b> — Barang: <b>${esc(productLabel)}</b> — Jenis: <b>${esc(jenisLabel)}</b>${qDeb ? ` — Cari: <b>${esc(qDeb)}</b>` : ''}</p>
    <table>
      <thead><tr>
        <th>Tanggal</th><th>Kode Barang</th><th>Nama Barang</th><th>Jenis</th>
        <th>No Referensi</th><th class="num">Stok Masuk</th><th class="num">Stok Keluar</th>
        <th class="num">Sisa Stok</th><th>Keterangan</th>
      </tr></thead>
      <tbody>${barisHtml || '<tr><td colspan="9">Tidak ada data.</td></tr>'}</tbody>
    </table>`;

  function exportExcel() {
    unduhExcel(
      `Pergerakan-Stok_${preset === 'all' ? 'semua' : `${from}_${to}`}`,
      tabelHtml,
      `Laporan Pergerakan Stok — ${periode}`,
    );
  }

  function exportPdf() {
    cetakHtml(
      'Pergerakan Stok',
      `<h1>Laporan Pergerakan Stok</h1>${tabelHtml}`,
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ------------------------- SUB-RIBBON -------------------------- */}
      <div className="sub-ribbon">
        <span className="rb-label">Laporan · Pergerakan Stok</span>
        <Link href="/laporan" className="rb-btn">
          <ArrowLeft className="h-3.5 w-3.5" /> Laporan Penjualan
        </Link>
        <Link href="/laporan/pembelian" className="rb-btn">
          Laporan Pembelian
        </Link>
        <span className="rb-sep" />
        <button
          type="button"
          className="rb-btn-primary"
          onClick={() => ui.run(muat, 'lap-ps-muat')}
          disabled={ui.locked('lap-ps-muat') || loading}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Muat Ulang
        </button>
        <span className="rb-sep" />
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => ui.run(() => pilihPreset(p.key), `preset-ps-${p.key}`)}
            disabled={ui.locked(`preset-ps-${p.key}`)}
            className={`rb-btn !h-7 !px-2 !text-[11.5px] ${
              preset === p.key ? '!border-[#1b5fa8] !bg-[#e8f1fa] !text-[#134a85]' : ''
            }`}
          >
            {p.label}
          </button>
        ))}
        <span className="rb-sep" />
        <button
          type="button"
          className="rb-btn"
          onClick={() => ui.run(exportExcel, 'lap-ps-excel')}
          disabled={ui.locked('lap-ps-excel') || !rows.length}
        >
          <FileSpreadsheet className="h-3.5 w-3.5" /> Export Excel
        </button>
        <button
          type="button"
          className="rb-btn"
          onClick={() => ui.run(exportPdf, 'lap-ps-pdf')}
          disabled={ui.locked('lap-ps-pdf') || !rows.length}
        >
          <FileDown className="h-3.5 w-3.5" /> Export PDF
        </button>
        <span className="ml-auto hidden shrink-0 pr-1 text-[11.5px] text-[#7a8ba0] sm:block">
          {periode}
        </span>
      </div>

      {/* ------------------------------ filter ---------------------------- */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[#d8e0ec] bg-white p-3">
        <h2 className="mr-1 flex items-center gap-1.5 text-[13px] font-bold text-[#1b3a5c]">
          <Layers className="h-4 w-4 text-[#1b5fa8]" /> Pergerakan Stok
        </h2>

        <div className="flex items-center gap-1.5">
          <input
            type="date"
            className="input h-8 w-[140px] text-[12px]"
            value={from}
            max={preset === 'all' ? undefined : to || undefined}
            onChange={(e) => {
              setFrom(e.target.value);
              setPreset('custom');
            }}
            disabled={preset === 'all'}
            aria-label="Dari tanggal"
          />
          <span className="text-[12px] text-[#9fb0c4]">s/d</span>
          <input
            type="date"
            className="input h-8 w-[140px] text-[12px]"
            value={to}
            min={preset === 'all' ? undefined : from || undefined}
            onChange={(e) => {
              setTo(e.target.value);
              setPreset('custom');
            }}
            disabled={preset === 'all'}
            aria-label="Sampai tanggal"
          />
        </div>

        <select
          className="input h-8 w-[180px] cursor-pointer text-[12px]"
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
          aria-label="Filter barang"
        >
          <option value="">Semua Barang</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <select
          className="input h-8 w-[170px] cursor-pointer text-[12px]"
          value={jenis}
          onChange={(e) => setJenis(e.target.value)}
          aria-label="Filter jenis"
        >
          {JENIS_FILTER.map((j) => (
            <option key={j.value} value={j.value}>
              {j.label}
            </option>
          ))}
        </select>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#9fb0c4]" />
          <input
            type="search"
            className="input h-8 w-[200px] pl-7 text-[12px]"
            placeholder="Cari nama / kode barang"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Cari nama atau kode barang"
          />
        </div>
      </div>

      {/* ------------------------------ isi ------------------------------- */}
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {loading && !rows.length ? (
          <div className="grid place-items-center py-16 text-[12px] text-zinc-400">
            <Loader2 className="mb-2 h-6 w-6 animate-spin" /> Memuat pergerakan stok…
          </div>
        ) : (
          <div className="space-y-3">
            {/* Ringkasan */}
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              <Stat label="Total Stok Masuk" value={angka(totalMasuk)} tone="green" />
              <Stat label="Total Stok Keluar" value={angka(totalKeluar)} tone="red" />
              <Stat label="Jumlah Mutasi" value={angka(rows.length)} />
            </div>

            <div className="card overflow-hidden p-0">
              <div className="flex items-center justify-between border-b border-[#e3eaf3] bg-[#f6f9fd] px-3 py-2">
                <h3 className="text-[12.5px] font-bold text-[#1b3a5c]">
                  Buku Besar Pergerakan Stok
                </h3>
                <span className="text-[11.5px] text-[#7a8ba0]">
                  {rows.length} baris · {productLabel} · {jenisLabel}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-[12.5px]">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-[#5b6b80]">
                      <th className="px-3 py-2">Tanggal</th>
                      <th className="px-3 py-2">Kode Barang</th>
                      <th className="px-3 py-2">Nama Barang</th>
                      <th className="px-3 py-2">Jenis</th>
                      <th className="px-3 py-2">No Referensi</th>
                      <th className="px-3 py-2 text-right">Stok Masuk</th>
                      <th className="px-3 py-2 text-right">Stok Keluar</th>
                      <th className="px-3 py-2 text-right">Sisa Stok</th>
                      <th className="px-3 py-2">Keterangan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-3 py-10 text-center text-zinc-400">
                          Tidak ada pergerakan stok pada filter ini.
                        </td>
                      </tr>
                    ) : (
                      rows.map((k) => {
                        const m = meta(k.jenis);
                        return (
                          <tr key={k.id} className="border-t border-zinc-100">
                            <td className="whitespace-nowrap px-3 py-2 text-[#5b6b80]">
                              {new Date(k.created_at).toLocaleString('id-ID', {
                                day: '2-digit',
                                month: 'short',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 font-mono text-[11.5px] text-[#7a8ba0]">
                              {k.barcode || '-'}
                            </td>
                            <td className="px-3 py-2 font-medium">{k.product_name}</td>
                            <td className="px-3 py-2">
                              <span className={`chip !py-0.5 !text-[11px] ${m.cls}`}>{m.label}</span>
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 font-mono text-[11.5px] text-[#1b5fa8]">
                              {k.no_referensi || '-'}
                            </td>
                            <td className="tnum px-3 py-2 text-right font-semibold text-[#2f9e44]">
                              {k.masuk ? angka(k.masuk) : '-'}
                            </td>
                            <td className="tnum px-3 py-2 text-right font-semibold text-[#c92a2a]">
                              {k.keluar ? angka(k.keluar) : '-'}
                            </td>
                            <td className="tnum px-3 py-2 text-right font-semibold text-[#1b3a5c]">
                              {k.stok_sesudah == null ? '-' : angka(k.stok_sesudah)}
                            </td>
                            <td className="px-3 py-2 text-[#5b6b80]">{k.keterangan || '-'}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <p className="flex items-center gap-1.5 text-[11.5px] text-[#7a8ba0]">
              <Printer className="h-3.5 w-3.5" /> Export PDF membuka dialog cetak — pilih
              &quot;Save as PDF&quot; untuk menyimpan.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'green' | 'red' }) {
  const warna =
    tone === 'green' ? 'text-[#2f9e44]' : tone === 'red' ? 'text-[#c92a2a]' : 'text-[#1b3a5c]';
  return (
    <div className="card p-3.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#5b6b80]">{label}</p>
      <p className={`tnum mt-1 text-[20px] font-bold ${warna}`}>{value}</p>
    </div>
  );
}
