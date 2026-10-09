'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  BarChart3,
  FileDown,
  FileSpreadsheet,
  Loader2,
  Printer,
  RefreshCw,
} from 'lucide-react';

import { purchasesApi, suppliersApi } from '@/lib/api';
import { angka, isoHariIni, isoHariLalu, rupiah } from '@/lib/format';
import { cetakHtml, esc, unduhExcel } from '@/lib/ekspor';
import { useToast } from '@/components/Toast';
import { useClickCooldown } from '@/lib/useButtonGuard';
import type { PurchaseReportData, Supplier } from '@/lib/types';

type Preset = 'today' | '7days' | '30days' | 'all' | 'custom';

const PRESETS: { key: Preset; label: string }[] = [
  { key: 'today', label: 'Hari Ini' },
  { key: '7days', label: '7 Hari' },
  { key: '30days', label: '30 Hari' },
  { key: 'all', label: 'Semua' },
];

/**
 * Laporan > Laporan Pembelian — ringkasan + rekap per supplier + rekap per
 * barang pada periode terpilih, lengkap dengan Export Excel & PDF.
 */
export default function LaporanPembelianScreen() {
  const toast = useToast();
  const [suppliers, setSuppliers] = React.useState<Supplier[]>([]);
  const [preset, setPreset] = React.useState<Preset>('30days');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const [supplier, setSupplier] = React.useState('');
  const [ready, setReady] = React.useState(false);
  const [data, setData] = React.useState<PurchaseReportData | null>(null);
  const [loading, setLoading] = React.useState(true);

  const ui = useClickCooldown(1200);

  React.useEffect(() => {
    const today = isoHariIni();
    setFrom(isoHariLalu(29));
    setTo(today);
    setReady(true);
  }, []);

  React.useEffect(() => {
    void suppliersApi.list().then((r) => {
      if (r.ok) setSuppliers(r.data);
    });
  }, []);

  const muat = React.useCallback(async () => {
    setLoading(true);
    const range = preset === 'all' ? {} : { from, to };
    const r = await purchasesApi.report({ ...range, supplier });
    setLoading(false);
    if (!r.ok) {
      toast.error('Gagal memuat laporan', r.error);
      setData(null);
      return;
    }
    setData(r.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, supplier, preset]);

  React.useEffect(() => {
    if (!ready) return;
    void muat();
  }, [ready, muat]);

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
  const supplierLabel = supplier || 'Semua Supplier';

  const summary = data?.summary ?? { jumlah_transaksi: 0, total_item: 0, total_nilai: 0 };

  const barisSupplierHtml = (data?.bySupplier ?? [])
    .map(
      (s, i) => `<tr><td class="num">${i + 1}</td><td>${esc(s.supplier_name)}</td>
        <td class="num">${angka(s.jumlah)}</td><td class="num">${rupiah(s.total)}</td></tr>`,
    )
    .join('');
  const barisProdukHtml = (data?.byProduct ?? [])
    .map(
      (p, i) => `<tr><td class="num">${i + 1}</td><td>${esc(p.product_name)}</td><td>${esc(p.unit || '-')}</td>
        <td class="num">${angka(p.qty)}</td><td class="num">${rupiah(p.avg_cost)}</td>
        <td class="num">${rupiah(p.total)}</td></tr>`,
    )
    .join('');

  const tabelHtml = `
    <h3>Ringkasan</h3>
    <table>
      <tr><th>Total Transaksi</th><th>Total Barang Masuk</th><th>Total Nilai Pembelian</th></tr>
      <tr><td class="num">${angka(summary.jumlah_transaksi)}</td><td class="num">${angka(summary.total_item)}</td><td class="num">${rupiah(summary.total_nilai)}</td></tr>
    </table>
    <h3 style="margin-top:14px">Rekap per Supplier</h3>
    <table>
      <thead><tr><th>#</th><th>Nama Supplier</th><th class="num">Jumlah Transaksi</th><th class="num">Total Belanja</th></tr></thead>
      <tbody>${barisSupplierHtml || '<tr><td colspan="4">Tidak ada data.</td></tr>'}</tbody>
    </table>
    <h3 style="margin-top:14px">Rekap per Barang</h3>
    <table>
      <thead><tr><th>#</th><th>Nama Barang</th><th>Satuan</th><th class="num">Total Jumlah Beli</th><th class="num">Rata-rata Harga Beli</th><th class="num">Total Nilai</th></tr></thead>
      <tbody>${barisProdukHtml || '<tr><td colspan="6">Tidak ada data.</td></tr>'}</tbody>
    </table>`;

  function exportExcel() {
    unduhExcel(
      `Laporan-Pembelian_${preset === 'all' ? 'semua' : `${from}_${to}`}`,
      tabelHtml,
      `Laporan Pembelian — ${periode} — ${supplierLabel}`,
    );
  }

  function exportPdf() {
    cetakHtml(
      'Laporan Pembelian',
      `<h1>Laporan Pembelian</h1>
       <p class="muted">Periode: <b>${esc(periode)}</b> — Supplier: <b>${esc(supplierLabel)}</b></p>
       ${tabelHtml}`,
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ------------------------- SUB-RIBBON -------------------------- */}
      <div className="sub-ribbon">
        <span className="rb-label">Laporan · Laporan Pembelian</span>
        <Link href="/laporan" className="rb-btn">
          <ArrowLeft className="h-3.5 w-3.5" /> Laporan Penjualan
        </Link>
        <span className="rb-sep" />
        <button
          type="button"
          className="rb-btn-primary"
          onClick={() => ui.run(muat, 'lap-pembelian-muat')}
          disabled={ui.locked('lap-pembelian-muat') || loading}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Muat Ulang
        </button>
        <span className="rb-sep" />
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => ui.run(() => pilihPreset(p.key), `preset-pb-${p.key}`)}
            disabled={ui.locked(`preset-pb-${p.key}`)}
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
          onClick={() => ui.run(exportExcel, 'lap-pb-excel')}
          disabled={ui.locked('lap-pb-excel') || !data}
        >
          <FileSpreadsheet className="h-3.5 w-3.5" /> Export Excel
        </button>
        <button
          type="button"
          className="rb-btn"
          onClick={() => ui.run(exportPdf, 'lap-pb-pdf')}
          disabled={ui.locked('lap-pb-pdf') || !data}
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
          <BarChart3 className="h-4 w-4 text-[#1b5fa8]" /> Laporan Pembelian
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
      </div>

      {/* ------------------------------ isi ------------------------------- */}
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {loading && !data ? (
          <div className="grid place-items-center py-16 text-[12px] text-zinc-400">
            <Loader2 className="mb-2 h-6 w-6 animate-spin" /> Memuat laporan…
          </div>
        ) : (
          <div className="space-y-3">
            {/* Ringkasan */}
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              <Stat label="Total Transaksi" value={angka(summary.jumlah_transaksi)} />
              <Stat label="Total Barang Masuk" value={angka(summary.total_item)} />
              <Stat label="Total Nilai Pembelian" value={rupiah(summary.total_nilai)} tone="green" />
            </div>

            {/* Rekap per supplier */}
            <div className="card overflow-hidden p-0">
              <h3 className="border-b border-[#e3eaf3] bg-[#f6f9fd] px-3 py-2 text-[12.5px] font-bold text-[#1b3a5c]">
                Rekap per Supplier
              </h3>
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-[#5b6b80]">
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">Nama Supplier</th>
                    <th className="px-3 py-2 text-right">Jumlah Transaksi</th>
                    <th className="px-3 py-2 text-right">Total Belanja</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.bySupplier ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-3 py-6 text-center text-zinc-400">
                        Tidak ada data pada periode ini.
                      </td>
                    </tr>
                  ) : (
                    data!.bySupplier.map((s, i) => (
                      <tr key={s.supplier_name} className="border-t border-zinc-100">
                        <td className="px-3 py-2 text-zinc-400">{i + 1}</td>
                        <td className="px-3 py-2 font-medium">{s.supplier_name}</td>
                        <td className="tnum px-3 py-2 text-right">{angka(s.jumlah)}</td>
                        <td className="tnum px-3 py-2 text-right font-semibold">{rupiah(s.total)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Rekap per barang */}
            <div className="card overflow-hidden p-0">
              <h3 className="border-b border-[#e3eaf3] bg-[#f6f9fd] px-3 py-2 text-[12.5px] font-bold text-[#1b3a5c]">
                Rekap per Barang
              </h3>
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-[#5b6b80]">
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">Nama Barang</th>
                    <th className="px-3 py-2">Satuan</th>
                    <th className="px-3 py-2 text-right">Total Jumlah Beli</th>
                    <th className="px-3 py-2 text-right">Rata-rata Harga Beli</th>
                    <th className="px-3 py-2 text-right">Total Nilai</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.byProduct ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-zinc-400">
                        Tidak ada data pada periode ini.
                      </td>
                    </tr>
                  ) : (
                    data!.byProduct.map((p, i) => (
                      <tr key={p.product_id ?? `${p.product_name}-${i}`} className="border-t border-zinc-100">
                        <td className="px-3 py-2 text-zinc-400">{i + 1}</td>
                        <td className="px-3 py-2 font-medium">{p.product_name}</td>
                        <td className="px-3 py-2 text-[#5b6b80]">{p.unit || '-'}</td>
                        <td className="tnum px-3 py-2 text-right">{angka(p.qty)}</td>
                        <td className="tnum px-3 py-2 text-right">{rupiah(p.avg_cost)}</td>
                        <td className="tnum px-3 py-2 text-right font-semibold">{rupiah(p.total)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
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
