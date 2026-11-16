'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  FileDown,
  FileSpreadsheet,
  Layers,
  Loader2,
  Printer,
  RefreshCw,
  Search,
} from 'lucide-react';

import { stockApi } from '@/lib/api';
import { angka, isoHariIni, isoHariLalu } from '@/lib/format';
import { cetakHtml, esc, unduhExcel } from '@/lib/ekspor';
import { useToast } from '@/components/Toast';
import { useClickCooldown } from '@/lib/useButtonGuard';
import type { StockMovement, StockMovementDaily, StockMovementReport } from '@/lib/types';

type Preset = 'today' | '7days' | '30days' | 'all' | 'custom';

const PRESETS: { key: Preset; label: string }[] = [
  { key: 'today', label: 'Hari Ini' },
  { key: '7days', label: '7 Hari' },
  { key: '30days', label: '30 Hari' },
  { key: 'all', label: 'Semua' },
];

/** Jumlah baris per halaman (dibatasi juga di server/RPC). */
const PAGE_SIZE = 100;

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
 * Sumber data: `kasir_stock_logs` (kartu stok) lewat RPC
 * `kasir_stock_movement_report`. Satu panggilan mengembalikan:
 *   - satu halaman baris (LIMIT/OFFSET di database),
 *   - total masuk/keluar hasil SUM agregasi,
 *   - deret harian untuk grafik.
 * Dengan begitu layar tidak perlu menarik seluruh riwayat hanya untuk
 * menghitung total atau menampilkan beberapa baris "Hari Ini".
 */
export default function PergerakanStokScreen() {
  const toast = useToast();
  const ui = useClickCooldown(1200);

  const [report, setReport] = React.useState<StockMovementReport | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [exporting, setExporting] = React.useState(false);

  const [preset, setPreset] = React.useState<Preset>('today');
  const [from, setFrom] = React.useState(() => isoHariIni());
  const [to, setTo] = React.useState(() => isoHariIni());
  const [q, setQ] = React.useState('');
  const [qDeb, setQDeb] = React.useState('');

  // Pencarian nama/kode ditunda sedikit agar tidak memanggil server tiap ketik.
  React.useEffect(() => {
    const t = window.setTimeout(() => setQDeb(q), 350);
    return () => window.clearTimeout(t);
  }, [q]);

  const reqRef = React.useRef(0);

  const muat = React.useCallback(
    async (halaman: number) => {
      const seq = ++reqRef.current;
      setLoading(true);
      try {
        const r = await stockApi.movementReport({
          from: preset === 'all' ? undefined : from,
          to: preset === 'all' ? undefined : to,
          q: qDeb,
          page: halaman,
          pageSize: PAGE_SIZE,
        });
        // Abaikan respons lama bila filter sudah berubah lagi.
        if (seq !== reqRef.current) return;
        if (!r.ok) {
          toast.error('Gagal memuat pergerakan stok', r.error);
          setReport(null);
          return;
        }
        setReport(r.data);
      } finally {
        if (seq === reqRef.current) setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [from, to, qDeb, preset],
  );

  React.useEffect(() => {
    void muat(1);
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

  const rows = report?.rows ?? [];
  const totalMasuk = report?.total_masuk ?? 0;
  const totalKeluar = report?.total_keluar ?? 0;
  const totalRows = report?.total_rows ?? 0;
  const totalPages = report?.total_pages ?? 1;
  const page = report?.page ?? 1;
  const pageSize = report?.page_size ?? PAGE_SIZE;
  const barisAwal = totalRows ? (page - 1) * pageSize + 1 : 0;
  const barisAkhir = Math.min(page * pageSize, totalRows);

  /** Isi hari yang kosong di rentang filter agar grafik tidak "bolong". */
  const dailyChart = React.useMemo<StockMovementDaily[]>(() => {
    const daily = report?.daily ?? [];
    if (preset === 'all' || !from || !to) return daily;
    const start = new Date(`${from}T00:00:00Z`);
    const end = new Date(`${to}T00:00:00Z`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return daily;
    const jumlahHari = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
    if (jumlahHari < 1 || jumlahHari > 370) return daily;

    const map = new Map(daily.map((d) => [d.tanggal, d]));
    const out: StockMovementDaily[] = [];
    for (let i = 0; i < jumlahHari; i++) {
      const d = new Date(start.getTime() + i * 86_400_000);
      const key = d.toISOString().slice(0, 10);
      out.push(map.get(key) ?? { tanggal: key, masuk: 0, keluar: 0 });
    }
    return out;
  }, [report, preset, from, to]);

  const filterSaatIni = React.useCallback(
    () => ({
      from: preset === 'all' ? undefined : from,
      to: preset === 'all' ? undefined : to,
      q: qDeb,
    }),
    [preset, from, to, qDeb],
  );

  const buatBarisHtml = (list: StockMovement[]) =>
    list
      .map(
        (k) => `<tr>
        <td>${esc(k.created_at ? new Date(k.created_at).toLocaleString('id-ID') : '-')}</td>
        <td>${esc(k.barcode || '-')}</td>
        <td>${esc(k.product_name)}</td>
        <td>${esc(meta(k.jenis).label)}</td>
        <td>${esc(k.no_referensi || '-')}</td>
        <td class="num">${k.masuk ? angka(k.masuk) : '-'}</td>
        <td class="num">${k.keluar ? angka(k.keluar) : '-'}</td>
      </tr>`,
      )
      .join('');

  const buatTabelHtml = (list: StockMovement[]) => `
    <p class="muted">Periode: <b>${esc(periode)}</b>${qDeb ? ` — Cari: <b>${esc(qDeb)}</b>` : ''}</p>
    <p class="muted">Total Stok Masuk: <b>${angka(totalMasuk)}</b> — Total Stok Keluar: <b>${angka(totalKeluar)}</b></p>
    <table>
      <thead><tr>
        <th>Tanggal</th><th>Kode Barang</th><th>Nama Barang</th><th>Jenis</th>
        <th>No Referensi</th><th class="num">Stok Masuk</th><th class="num">Stok Keluar</th>
      </tr></thead>
      <tbody>${buatBarisHtml(list) || '<tr><td colspan="7">Tidak ada data.</td></tr>'}</tbody>
    </table>`;

  /** Ambil seluruh baris (semua halaman) untuk Export Excel/PDF. */
  async function ambilSemuaBaris(): Promise<StockMovement[]> {
    if (!report || report.total_pages <= 1) return rows;
    const semua: StockMovement[] = [];
    // Batas aman 100.000 baris (200 halaman × 500).
    const maxHalaman = Math.min(report.total_pages, 200);
    for (let h = 1; h <= maxHalaman; h++) {
      const r = await stockApi.movementReport({ ...filterSaatIni(), page: h, pageSize: 500 });
      if (!r.ok) throw new Error(r.error);
      semua.push(...r.data.rows);
    }
    return semua;
  }

  async function exportExcel() {
    if (exporting) return;
    setExporting(true);
    try {
      const semua = await ambilSemuaBaris();
      unduhExcel(
        `Pergerakan-Stok_${preset === 'all' ? 'semua' : `${from}_${to}`}`,
        buatTabelHtml(semua),
        `Laporan Pergerakan Stok — ${periode}`,
      );
    } catch (e) {
      toast.error('Gagal menyiapkan Excel', e instanceof Error ? e.message : 'Terjadi kesalahan.');
    } finally {
      setExporting(false);
    }
  }

  async function exportPdf() {
    if (exporting) return;
    setExporting(true);
    try {
      const semua = await ambilSemuaBaris();
      cetakHtml('Pergerakan Stok', `<h1>Laporan Pergerakan Stok</h1>${buatTabelHtml(semua)}`);
    } catch (e) {
      toast.error('Gagal menyiapkan PDF', e instanceof Error ? e.message : 'Terjadi kesalahan.');
    } finally {
      setExporting(false);
    }
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
          onClick={() => ui.run(() => void muat(page), 'lap-ps-muat')}
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
          onClick={() => ui.run(() => void exportExcel(), 'lap-ps-excel')}
          disabled={ui.locked('lap-ps-excel') || !rows.length || exporting}
        >
          {exporting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <FileSpreadsheet className="h-3.5 w-3.5" />
          )}{' '}
          Export Excel
        </button>
        <button
          type="button"
          className="rb-btn"
          onClick={() => ui.run(() => void exportPdf(), 'lap-ps-pdf')}
          disabled={ui.locked('lap-ps-pdf') || !rows.length || exporting}
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

        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#9fb0c4]" />
          <input
            type="search"
            className="input h-8 w-[220px] pl-7 text-[12px]"
            placeholder="Cari nama barang"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Cari nama barang"
          />
        </div>
        {loading && (
          <span className="ml-auto flex items-center gap-1.5 text-[11.5px] text-[#7a8ba0]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Memuat…
          </span>
        )}
      </div>

      {/* ------------------------------ isi ------------------------------- */}
      <div className="min-h-0 flex-1 overflow-auto p-3" aria-busy={loading}>
        {loading && !report ? (
          <div className="grid place-items-center py-16 text-[12px] text-zinc-400">
            <Loader2 className="mb-2 h-6 w-6 animate-spin" /> Memuat pergerakan stok…
          </div>
        ) : (
          <div className={`space-y-3 ${loading ? 'opacity-70' : ''}`}>
            {/* Grafik ikut filter tanggal — datanya dari agregasi yang sama. */}
            <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-3">
              <div className="card p-3 lg:col-span-2">
                <div className="mb-1 flex items-center justify-between">
                  <h3 className="text-[12.5px] font-bold text-[#1b3a5c]">
                    Tren Harian — Stok Masuk vs Stok Keluar
                  </h3>
                  <span className="text-[11px] text-[#7a8ba0]">{periode}</span>
                </div>
                <GrafikGaris data={dailyChart} />
              </div>
              <div className="card p-3">
                <h3 className="mb-1 text-[12.5px] font-bold text-[#1b3a5c]">
                  Perbandingan Total
                </h3>
                <GrafikBatang masuk={totalMasuk} keluar={totalKeluar} />
              </div>
            </div>

            {/* Ringkasan — dihitung di database, bukan dari baris satu halaman. */}
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <Stat label="Total Stok Masuk" value={angka(totalMasuk)} tone="green" />
              <Stat label="Total Stok Keluar" value={angka(totalKeluar)} tone="red" />
            </div>

            <div className="card overflow-hidden p-0">
              <div className="flex items-center justify-between border-b border-[#e3eaf3] bg-[#f6f9fd] px-3 py-2">
                <h3 className="text-[12.5px] font-bold text-[#1b3a5c]">
                  Buku Besar Pergerakan Stok
                </h3>
                <span className="text-[11.5px] text-[#7a8ba0]">{angka(totalRows)} baris</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[880px] text-[12.5px]">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-[#5b6b80]">
                      <th className="px-3 py-2">Tanggal</th>
                      <th className="px-3 py-2">Kode Barang</th>
                      <th className="px-3 py-2">Nama Barang</th>
                      <th className="px-3 py-2">Jenis</th>
                      <th className="px-3 py-2">No Referensi</th>
                      <th className="px-3 py-2 text-right">Stok Masuk</th>
                      <th className="px-3 py-2 text-right">Stok Keluar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-3 py-10 text-center text-zinc-400">
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
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#e3eaf3] bg-[#f6f9fd] px-3 py-2 text-[11.5px] text-[#5b6b80]">
                <span>
                  Menampilkan <b>{barisAwal}</b>–<b>{barisAkhir}</b> dari{' '}
                  <b>{angka(totalRows)}</b> baris
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    className="btn-outline !h-7 !px-2 !text-[11.5px]"
                    onClick={() => ui.run(() => void muat(page - 1), 'lap-ps-prev')}
                    disabled={ui.locked('lap-ps-prev') || loading || page <= 1}
                  >
                    <ChevronLeft className="h-3.5 w-3.5" /> Sebelumnya
                  </button>
                  <span className="px-1">
                    Halaman <b>{page}</b> / <b>{totalPages}</b>
                  </span>
                  <button
                    type="button"
                    className="btn-outline !h-7 !px-2 !text-[11.5px]"
                    onClick={() => ui.run(() => void muat(page + 1), 'lap-ps-next')}
                    disabled={ui.locked('lap-ps-next') || loading || page >= totalPages}
                  >
                    Berikutnya <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
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

/* ------------------------------ grafik ------------------------------- */

const WARNA_MASUK = '#2f9e44';
const WARNA_KELUAR = '#c92a2a';

function nilaiMaks(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 1;
  const pangkat = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pangkat;
  const bulat = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return bulat * pangkat;
}

function labelTanggal(ymd: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(ymd);
  return m ? `${m[2]}/${m[1]}` : ymd;
}

/** Grafik garis: tren stok masuk vs stok keluar per hari. */
function GrafikGaris({ data }: { data: StockMovementDaily[] }) {
  const W = 720;
  const H = 240;
  const PL = 46;
  const PR = 12;
  const PT = 16;
  const PB = 34;
  const maxV = nilaiMaks(Math.max(1, ...data.map((d) => Math.max(d.masuk, d.keluar))));

  const x = (i: number) =>
    data.length <= 1 ? PL + (W - PL - PR) / 2 : PL + (i / (data.length - 1)) * (W - PL - PR);
  const y = (v: number) => PT + (1 - Math.max(0, v) / maxV) * (H - PT - PB);
  const garis = (k: 'masuk' | 'keluar') =>
    data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(d[k]).toFixed(1)}`).join(' ');

  const langkahLabel = Math.max(1, Math.ceil(data.length / 6));
  const yTicks = [0, maxV / 2, maxV];

  return (
    <div>
      <div className="mb-1 flex items-center gap-3 text-[11px] text-[#5b6b80]">
        <span className="flex items-center gap-1">
          <i className="inline-block h-2 w-2 rounded-full" style={{ background: WARNA_MASUK }} /> Masuk
        </span>
        <span className="flex items-center gap-1">
          <i className="inline-block h-2 w-2 rounded-full" style={{ background: WARNA_KELUAR }} /> Keluar
        </span>
      </div>
      {data.length === 0 ? (
        <div className="grid h-[200px] place-items-center text-[12px] text-zinc-400">
          Tidak ada data untuk grafik pada filter ini.
        </div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="h-[220px] w-full" role="img" aria-label="Grafik tren stok masuk dan keluar">
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={PL} x2={W - PR} y1={y(t)} y2={y(t)} stroke="#e8eef5" strokeWidth={1} />
              <text x={PL - 6} y={y(t) + 3.5} textAnchor="end" fontSize={9} fill="#9fb0c4">
                {angka(t)}
              </text>
            </g>
          ))}
          <path d={garis('masuk')} fill="none" stroke={WARNA_MASUK} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
          <path d={garis('keluar')} fill="none" stroke={WARNA_KELUAR} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
          {data.map((d, i) => (
            <g key={d.tanggal}>
              <circle cx={x(i)} cy={y(d.masuk)} r={2.6} fill={WARNA_MASUK}>
                <title>{`${d.tanggal} — masuk ${angka(d.masuk)}`}</title>
              </circle>
              <circle cx={x(i)} cy={y(d.keluar)} r={2.6} fill={WARNA_KELUAR}>
                <title>{`${d.tanggal} — keluar ${angka(d.keluar)}`}</title>
              </circle>
              {(i % langkahLabel === 0 || i === data.length - 1) && (
                <text x={x(i)} y={H - 12} textAnchor="middle" fontSize={9} fill="#9fb0c4">
                  {labelTanggal(d.tanggal)}
                </text>
              )}
            </g>
          ))}
        </svg>
      )}
    </div>
  );
}

/** Grafik batang: perbandingan total masuk vs total keluar. */
function GrafikBatang({ masuk, keluar }: { masuk: number; keluar: number }) {
  const W = 320;
  const H = 240;
  const PL = 22;
  const PR = 22;
  const PT = 20;
  const PB = 40;
  const maxV = nilaiMaks(Math.max(1, masuk, keluar));
  const areaW = W - PL - PR;
  const areaH = H - PT - PB;
  const barW = Math.min(72, areaW / 3);
  const x1 = PL + areaW * 0.25 - barW / 2;
  const x2 = PL + areaW * 0.75 - barW / 2;
  const y = (v: number) => PT + (1 - Math.max(0, v) / maxV) * areaH;
  const h = (v: number) => Math.max(0, areaH - (y(v) - PT));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-[220px] w-full" role="img" aria-label="Grafik batang total stok masuk dan keluar">
      <line x1={PL} x2={W - PR} y1={PT + areaH} y2={PT + areaH} stroke="#e8eef5" />
      <rect x={x1} y={y(masuk)} width={barW} height={h(masuk)} rx={4} fill={WARNA_MASUK} opacity={0.9}>
        <title>{`Total masuk ${angka(masuk)}`}</title>
      </rect>
      <rect x={x2} y={y(keluar)} width={barW} height={h(keluar)} rx={4} fill={WARNA_KELUAR} opacity={0.9}>
        <title>{`Total keluar ${angka(keluar)}`}</title>
      </rect>
      <text x={x1 + barW / 2} y={Math.max(PT + 10, y(masuk) - 6)} textAnchor="middle" fontSize={10} fontWeight={700} fill={WARNA_MASUK}>
        {angka(masuk)}
      </text>
      <text x={x2 + barW / 2} y={Math.max(PT + 10, y(keluar) - 6)} textAnchor="middle" fontSize={10} fontWeight={700} fill={WARNA_KELUAR}>
        {angka(keluar)}
      </text>
      <text x={x1 + barW / 2} y={H - 18} textAnchor="middle" fontSize={10} fill="#5b6b80">
        Masuk
      </text>
      <text x={x2 + barW / 2} y={H - 18} textAnchor="middle" fontSize={10} fill="#5b6b80">
        Keluar
      </text>
    </svg>
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
