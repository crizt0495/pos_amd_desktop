'use client';

import * as React from 'react';
import { Ban, BarChart3, Eye, Loader2, Printer, RefreshCw, TrendingUp, Undo2 } from 'lucide-react';

import { reportsApi, returnsApi, shiftsApi, transactionsApi } from '@/lib/api';
import { angka, isoHariIni, isoHariLalu, rupiah, tanggalWaktu } from '@/lib/format';
import { buildReceiptFromTx, loadStoreMeta, type StoreMeta } from '@/lib/receipt';
import { bacaPrinterSettings } from '@/lib/printerSettings';
import { cetakStrukBluetooth } from '@/lib/bluetoothPrinter';
import { useToast } from '@/components/Toast';
import { useButtonGuard, useClickCooldown } from '@/lib/useButtonGuard';
import { Modal } from '@/components/Modal';
import { ReturModal } from '@/components/ReturModal';
import { ReceiptView } from '@/components/Receipt';
import { PAYMENT_METHOD_LABEL } from '@/lib/types';
import type {
  CashierReport,
  DailyReport,
  KasirShift,
  PaymentReport,
  ReceiptData,
  ReportSummary,
  ReturnRecord,
  TopProduct,
  Transaction,
  TransactionItem,
} from '@/lib/types';

type Preset = 'today' | '7days' | '30days' | 'all' | 'custom';

const PRESETS: { key: Preset; label: string; from?: string; to?: string }[] = [
  { key: 'today', label: 'Hari Ini', from: isoHariIni(), to: isoHariIni() },
  { key: '7days', label: '7 Hari', from: isoHariLalu(6), to: isoHariIni() },
  { key: '30days', label: '30 Hari', from: isoHariLalu(29), to: isoHariIni() },
  { key: 'all', label: 'Semua' },
];

export default function LaporanScreen({ onVoid }: { onVoid?: (invoiceNo: string) => void }) {
  const toast = useToast();

  const [preset, setPreset] = React.useState<Preset>('today');
  // Tanggal mulai kosong di SSR lalu diisi di klien — hindari mismatch hidrasi.
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const [ready, setReady] = React.useState(false);

  const [summary, setSummary] = React.useState<ReportSummary | null>(null);
  const [top, setTop] = React.useState<TopProduct[]>([]);
  const [daily, setDaily] = React.useState<DailyReport[]>([]);
  const [byPayment, setByPayment] = React.useState<PaymentReport[]>([]);
  const [list, setList] = React.useState<Transaction[]>([]);
  const [loading, setLoading] = React.useState(true);

  const [detail, setDetail] = React.useState<{
    tx: Transaction;
    items: TransactionItem[];
  } | null>(null);
  const [printData, setPrintData] = React.useState<ReceiptData | null>(null);
  const [voiding, setVoiding] = React.useState<Transaction | null>(null);
  const [returns, setReturns] = React.useState<ReturnRecord[]>([]);
  const [cashiers, setCashiers] = React.useState<CashierReport[]>([]);
  const [shifts, setShifts] = React.useState<KasirShift[]>([]);
  const [returSel, setReturSel] = React.useState<{
    tx: Transaction;
    items: TransactionItem[];
  } | null>(null);
  // Kunci pembatalan transaksi agar tak terkirim dua kali.
  const voidGuard = useButtonGuard();
  // Kunci tombol ringan (buka detail, cetak, preset) tanpa spinner.
  const ui = useClickCooldown(1500);

  const range = preset === 'all' ? {} : { from, to };

  async function cetakLaporan() {
    const meta = await loadStoreMeta('KasirPro');
    const rows = list ?? [];
    const periode =
      preset === 'all'
        ? 'Semua Periode'
        : `${from || '-'} s/d ${to || '-'}`;
    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) {
      alert('Izinkan popup untuk bisa mencetak.');
      return;
    }
    const rowsHtml = rows
      .map(
        (t) => `
        <tr>
          <td>${new Date(t.created_at).toLocaleString('id-ID')}</td>
          <td>${t.invoice_no}</td>
          <td>${t.customer_name ?? '-'}</td>
          <td class="num">${rupiah(t.total)}</td>
          <td>${PAYMENT_METHOD_LABEL[t.payment_method] ?? t.payment_method}</td>
        </tr>`,
      )
      .join('');
    // Pakai ukuran kertas dari pengaturan printer (printer_settings localStorage).
    const prf = bacaPrinterSettings();
    const sizeCss =
      prf.ukuran === '58mm' ? '58mm auto' : prf.ukuran === '80mm' ? '80mm auto' : 'A4 portrait';
    const fontCss = prf.ukuran === 'A4' ? '12px' : '11px';

    win.document.write(`<!doctype html><html><head><title>Laporan</title>
      <style>
        @page{size:${sizeCss};margin:8mm}
        body{font-family:sans-serif;padding:24px;color:#1b3a5c;font-size:${fontCss}}
        h1,h2{margin:0;padding:0}
        table{width:100%;border-collapse:collapse;margin-top:12px}
        th,td{border:1px solid #d8e0ec;padding:6px 8px;font-size:${fontCss}}
        th{background:#f6f9fd;text-align:left}
        .num{text-align:right;font-variant-numeric:tabular-nums}
        .total{margin-top:16px;font-size:20px;font-weight:bold;text-align:right}
      </style></head><body>
      <h1>${meta.name}</h1>
      ${meta.address ? `<p style="margin-top:4px;font-size:12px;color:#5b6b80">${meta.address}</p>` : ''}
      ${meta.phone ? `<p style="margin-top:2px;font-size:12px;color:#5b6b80">Telp: ${meta.phone}</p>` : ''}
      <h2 style="margin-top:8px">Laporan Penjualan — Periode ${periode}</h2>
      <table>
        <thead><tr><th>Tanggal</th><th>Invoice</th><th>Pelanggan</th><th class="num">Total</th><th>Bayar</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <p class="total">Total Penjualan: ${rupiah(rows.reduce((s, t) => s + t.total, 0))}</p>
      <script>window.onload=function(){window.print();}</script>
    </body></html>`);
    win.document.close();
  }

  const load = React.useCallback(async () => {
    if (!ready) return;
    setLoading(true);
    const [s, t, d, p, l, r, k, sh] = await Promise.all([
      reportsApi.summary(range),
      reportsApi.topProducts(range),
      reportsApi.daily(range),
      reportsApi.byPayment(range),
      transactionsApi.list({ ...range, limit: 200 }),
      returnsApi.list(range),
      reportsApi.byCashier(range),
      shiftsApi.list({ ...range, limit: 100 }),
    ]);

    if (s.ok) setSummary(s.data);
    if (t.ok) setTop(t.data);
    if (d.ok) setDaily(d.data);
    if (p.ok) setByPayment(p.data);
    if (l.ok) setList(l.data);
    if (r.ok) setReturns(r.data);
    if (k.ok) setCashiers(k.data);
    if (sh.ok) setShifts(sh.data);
    setLoading(false);
  }, [from, to, preset, ready]);

  React.useEffect(() => {
    // Inisialisasi rentang tanggal di sisi klien (bukan saat SSR).
    setFrom(isoHariIni());
    setTo(isoHariIni());
    setReady(true);
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  function pilihPreset(p: (typeof PRESETS)[number]) {
    setPreset(p.key);
    if (p.from && p.to) {
      setFrom(p.from);
      setTo(p.to);
    }
  }

  /* ------------------------------ detail struk ------------------------ */
  async function lihat(tx: Transaction) {
    const res = await transactionsApi.get(tx.id);
    if (!res.ok) {
      toast.error('Gagal memuat transaksi', res.error);
      return;
    }
    if (!res.data.transaction) return;
    setDetail({ tx: res.data.transaction, items: res.data.items });
  }

  /** Buka pratinjau struk satu transaksi (dijalankan lewat `ui.run`). */
  async function bukaCetak(tx: Transaction) {
    const res = await transactionsApi.get(tx.id);
    if (!res.ok) {
      toast.error('Gagal memuat transaksi', res.error);
      return;
    }
    if (!res.data.transaction) {
      toast.error('Transaksi tidak ditemukan', tx.invoice_no);
      return;
    }
    const store: StoreMeta = await loadStoreMeta(tx.cashier_name || 'KasirPro');
    const receipt = buildReceiptFromTx(res.data.transaction, res.data.items, store);
    setPrintData(receipt);
  }

  async function batalkan(tx: Transaction) {
    const res = await transactionsApi.void(tx.id);
    if (!res.ok) {
      toast.error('Gagal membatalkan transaksi', res.error);
      return;
    }
    toast.ok('Transaksi dibatalkan', 'Stok produk sudah dikembalikan.');
    setVoiding(null);
    onVoid?.(tx.invoice_no);
    await load();
  }

  /** Buka modal retur transaksi: muat item lalu tampilkan. */
  async function bukaRetur(tx: Transaction) {
    const res = await transactionsApi.get(tx.id);
    if (!res.ok) {
      toast.error('Gagal memuat transaksi', res.error);
      return;
    }
    if (!res.data.transaction) return;
    setReturSel({ tx: res.data.transaction, items: res.data.items });
  }

  /** Pembatalan transaksi: satu klik = satu void (klik ganda ditolak). */
  function klikBatalkan(tx: Transaction) {
    if (voidGuard.busy) {
      toast.info('Mohon tunggu…', 'Transaksi sedang dibatalkan.');
      return;
    }
    void voidGuard.guard(() => batalkan(tx), {
      cooldownMs: 2000,
      pesanTunggu: 'Transaksi sedang dibatalkan…',
      onBlocked: (pesan) => toast.info('Mohon tunggu…', pesan),
    });
  }

  const omzetMax = Math.max(1, ...daily.map((d) => d.omzet));

  // Diskon transaksi = potongan tiap item + diskon level transaksi (hanya
  // transaksi lama yang memakainya). Transaksi baru diskonnya per item.
  const potonganDetail = detail
    ? detail.items.reduce((s, it) => s + (Number(it.discount) || 0), 0) +
      (Number(detail.tx.discount_amount) || 0)
    : 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ------------------------- SUB-RIBBON -------------------------- */}
      <div className="sub-ribbon">
        <span className="rb-label">Laporan · Laporan Penjualan</span>
        <button
          type="button"
          className="rb-btn-primary"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Muat Ulang
        </button>
        <span className="rb-sep" />
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => ui.run(() => pilihPreset(p), `preset-${p.key}`)}
            disabled={ui.locked(`preset-${p.key}`)}
            className={`rb-btn !h-7 !px-2 !text-[11.5px] ${
              preset === p.key ? '!border-[#1b5fa8] !bg-[#e8f1fa] !text-[#134a85]' : ''
            }`}
          >
            {p.label}
          </button>
        ))}
        <span className="ml-auto hidden shrink-0 pr-1 text-[11.5px] text-[#7a8ba0] sm:block">
          {preset === 'all' ? 'Semua transaksi' : `${from} s/d ${to}`}
        </span>
      </div>

      {/* ------------------------------ filter ---------------------------- */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[#d8e0ec] bg-white p-3">
        <h2 className="mr-1 flex items-center gap-1.5 text-[13px] font-bold text-[#1b3a5c]">
          <BarChart3 className="h-4 w-4 text-[#1b5fa8]" /> Laporan Penjualan
        </h2>

        <div className="flex items-center gap-1.5">
          <input
            type="date"
            className="input h-8 w-[142px] text-[12px]"
            value={from}
            max={to}
            onChange={(e) => {
              setFrom(e.target.value);
              setPreset('custom');
            }}
          />
          <span className="text-[12px] text-[#9fb0c4]">s/d</span>
          <input
            type="date"
            className="input h-8 w-[142px] text-[12px]"
            value={to}
            min={from}
            onChange={(e) => {
              setTo(e.target.value);
              setPreset('custom');
            }}
          />
        </div>

        <button
          type="button"
          className="btn-outline h-8 px-3"
          onClick={() => ui.run(() => cetakLaporan(), 'cetak-laporan')}
          disabled={ui.locked('cetak-laporan')}
        >
          <Printer className="h-3.5 w-3.5" /> Cetak Laporan
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {/* ---------------------------- summary -------------------------- */}
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-5">
          <Stat label="Omzet" value={rupiah(summary?.total_omzet ?? 0)} icon={<TrendingUp className="h-3.5 w-3.5" />} />
          <Stat label="Laba Kotor" value={rupiah(summary?.total_laba ?? 0)} tone="green" />
          <Stat label="Diskon" value={rupiah(summary?.total_diskon ?? 0)} tone="red" />
          <Stat label="Transaksi" value={angka(summary?.jumlah_transaksi ?? 0)} />
          <Stat label="Item Terjual" value={angka(summary?.total_item ?? 0)} />
        </div>

        {/* Laba rugi sederhana: omzet dikurangi retur tunai */}
        <div className="mt-2.5 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <Stat label="Total Retur" value={rupiah(returns.reduce((s, r) => s + r.total, 0))} tone="red" />
          <Stat label="Omzet Bersih" value={rupiah(Math.max(0, (summary?.total_omzet ?? 0) - returns.reduce((s, r) => s + r.total, 0)))} tone="green" />
          <Stat label="Kas Masuk" value={rupiah(byPayment.find((p) => p.metode === 'cash')?.omzet ?? 0)} />
          <Stat label="Non Tunai" value={rupiah((summary?.total_omzet ?? 0) - (byPayment.find((p) => p.metode === 'cash')?.omzet ?? 0))} />
        </div>

        <div className="mt-2.5 grid gap-2.5 lg:grid-cols-[1.35fr_1fr]">
          {/* ------------------------- grafik harian ------------------- */}
          <div className="card p-3.5">
            <h3 className="mb-2.5 flex items-center gap-2 text-[13px] font-bold text-[#1b3a5c]">
              <BarChart3 className="h-4 w-4 text-[#1b5fa8]" /> Omzet Harian
            </h3>
            {!daily.length ? (
              <p className="py-8 text-center text-[12.5px] text-[#9fb0c4]">Belum ada transaksi pada rentang ini.</p>
            ) : (
              <>
                <div className="flex h-32 items-end gap-1">
                  {daily.map((d) => (
                    <div key={d.tanggal} className="group flex flex-1 flex-col items-center gap-1">
                      <div className="relative flex w-full flex-1 items-end">
                        <div
                          className="w-full rounded-t bg-[#1b5fa8]/85 transition group-hover:bg-[#134a85]"
                          style={{ height: `${Math.max(3, (d.omzet / omzetMax) * 100)}%` }}
                          title={`${d.tanggal}: ${rupiah(d.omzet)} (${d.transaksi} transaksi)`}
                        />
                      </div>
                      <span className="truncate text-[9.5px] text-[#9fb0c4]">
                        {d.tanggal.slice(8)}/{d.tanggal.slice(5, 7)}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-2.5 space-y-1 border-t border-dashed border-[#d8e0ec] pt-2 text-[11.5px]">
                  {daily.slice(-5).reverse().map((d) => (
                    <div key={d.tanggal} className="flex items-center justify-between">
                      <span className="text-[#5b6b80]">{d.tanggal}</span>
                      <span className="flex items-center gap-3">
                        <span className="tnum text-[#7a8ba0]">{d.transaksi} trx</span>
                        <span className="tnum w-24 text-right font-semibold text-[#22374b]">{rupiah(d.omzet)}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* ---------------------- produk terlaris -------------------- */}
          <div className="card p-3.5">
            <h3 className="mb-2.5 text-[13px] font-bold text-[#1b3a5c]">Produk Terlaris</h3>
            {!top.length ? (
              <p className="py-8 text-center text-[12.5px] text-[#9fb0c4]">Belum ada penjualan.</p>
            ) : (
              <ol className="space-y-1.5">
                {top.map((p, i) => (
                  <li key={`${p.name}-${i}`} className="flex items-center gap-2.5">
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded bg-[#e8f1fa] text-[10.5px] font-bold text-[#1b5fa8]">
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-[#35485c]">{p.name}</span>
                    <span className="tnum shrink-0 text-[11.5px] text-[#7a8ba0]">{angka(p.qty)}</span>
                    <span className="tnum w-24 shrink-0 text-right text-[12px] font-semibold text-[#22374b]">
                      {rupiah(p.omzet)}
                    </span>
                  </li>
                ))}
              </ol>
            )}

            {byPayment.length ? (
              <>
                <h3 className="mb-1.5 mt-3.5 border-t border-dashed border-[#d8e0ec] pt-3 text-[13px] font-bold text-[#1b3a5c]">
                  Metode Pembayaran
                </h3>
                <ul className="space-y-1">
                  {byPayment.map((p) => (
                    <li key={p.metode} className="flex items-center justify-between text-[12px]">
                      <span className="text-[#4a5b70]">{PAYMENT_METHOD_LABEL[p.metode] ?? p.metode}</span>
                      <span className="flex items-center gap-3">
                        <span className="tnum text-[#9fb0c4]">{p.n} trx</span>
                        <span className="tnum w-24 text-right font-semibold text-[#22374b]">{rupiah(p.omzet)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        </div>

        {/* ------------------------ daftar transaksi -------------------- */}
        <div className="card mt-2.5 overflow-hidden">
          <div className="panel-head">
            <h3 className="panel-title">Riwayat Transaksi</h3>
            <span className="text-[11.5px] text-[#7a8ba0]">{list.length} transaksi terbaru</span>
          </div>

          <div className="max-h-[320px] overflow-auto">
            <table className="w-full min-w-[820px] border-collapse">
              <thead className="sticky top-0 bg-[#f6f9fd]">
                <tr>
                  <th className="th w-[150px]">Invoice</th>
                  <th className="th w-[150px]">Waktu</th>
                  <th className="th w-[90px]">Metode</th>
                  <th className="th w-[110px] text-right">Total</th>
                  <th className="th w-[100px]">Status</th>
                  <th className="th w-[190px] text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#eef2f7]">
                {!list.length && !loading ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-[12.5px] text-[#9fb0c4]">
                      Belum ada transaksi pada rentang ini.
                    </td>
                  </tr>
                ) : (
                  list.map((tx) => (
                    <tr key={tx.id} className="bg-white transition hover:bg-[#f6f9fd]">
                      <td className="td font-mono text-[12px] font-semibold text-[#35485c]">{tx.invoice_no}</td>
                      <td className="td text-[#5b6b80]">{tanggalWaktu(tx.created_at)}</td>
                      <td className="td text-[#5b6b80]">{PAYMENT_METHOD_LABEL[tx.payment_method] ?? tx.payment_method}</td>
                      <td className="td tnum text-right font-bold text-accent-600">{rupiah(tx.total)}</td>
                      <td className="td">
                        {tx.status === 'void' ? (
                          <span className="rounded bg-[#fff5f5] px-1.5 py-0.5 text-[10.5px] font-semibold text-[#c92a2a]">
                            Dibatalkan
                          </span>
                        ) : (
                          <span className="rounded bg-[#ebfbee] px-1.5 py-0.5 text-[10.5px] font-semibold text-[#1b5a2b]">
                            Selesai
                          </span>
                        )}
                      </td>
                      <td className="td">
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            className="btn-ghost px-2 py-1 text-[11.5px]"
                            onClick={() => ui.run(() => void lihat(tx), `lihat-${tx.id}`)}
                            disabled={ui.locked(`lihat-${tx.id}`)}
                          >
                            <Eye className="h-3.5 w-3.5" /> Detail
                          </button>
                          <button
                            type="button"
                            className="btn-ghost px-2 py-1 text-[11.5px]"
                            onClick={() => ui.run(() => void bukaCetak(tx), `cetak-${tx.id}`)}
                            disabled={ui.locked(`cetak-${tx.id}`) || voidGuard.busy || tx.status === 'void'}
                            aria-label={`Cetak struk ${tx.invoice_no}`}
                          >
                            <Printer className="h-3.5 w-3.5" />
                          </button>
                          {tx.status !== 'void' ? (
                            <>
                              <button
                                type="button"
                                className="btn-ghost px-2 py-1 text-[11.5px] text-[#b0720a] hover:bg-[#fff9db]"
                                onClick={() => ui.run(() => void bukaRetur(tx), `retur-${tx.id}`)}
                                disabled={ui.locked(`retur-${tx.id}`)}
                                aria-label={`Retur transaksi ${tx.invoice_no}`}
                              >
                                <Undo2 className="h-3.5 w-3.5" /> Retur
                              </button>
                              <button
                                type="button"
                                className="btn-ghost px-2 py-1 text-[11.5px] text-[#e03131] hover:bg-[#fff5f5]"
                                onClick={() => ui.run(() => setVoiding(tx), `void-${tx.id}`)}
                                disabled={ui.locked(`void-${tx.id}`)}
                                aria-label={`Batalkan transaksi ${tx.invoice_no}`}
                              >
                                <Ban className="h-3.5 w-3.5" />
                              </button>
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ------------------------ riwayat retur ---------------------- */}
        <div className="card mt-2.5 overflow-hidden">
          <div className="panel-head">
            <h3 className="panel-title">Riwayat Retur</h3>
            <span className="text-[11.5px] text-[#7a8ba0]">{returns.length} retur</span>
          </div>

          <div className="max-h-[200px] overflow-auto">
            <table className="w-full min-w-[640px] border-collapse">
              <thead className="sticky top-0 bg-[#f6f9fd]">
                <tr>
                  <th className="th w-[150px]">Retur No</th>
                  <th className="th w-[150px]">Nota Asal</th>
                  <th className="th w-[150px]">Waktu</th>
                  <th className="th w-[90px]">Kasir</th>
                  <th className="th w-[110px] text-right">Dana Kembali</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#eef2f7]">
                {!returns.length ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-[12.5px] text-[#9fb0c4]">
                      Belum ada retur pada rentang ini.
                    </td>
                  </tr>
                ) : (
                  returns.map((rt) => (
                    <tr key={rt.id} className="bg-white transition hover:bg-[#f6f9fd]">
                      <td className="td font-mono text-[12px] font-semibold text-[#35485c]">{rt.retur_no}</td>
                      <td className="td font-mono text-[12px] text-[#5b6b80]">{rt.invoice_no}</td>
                      <td className="td text-[#5b6b80]">{tanggalWaktu(rt.created_at)}</td>
                      <td className="td text-[#5b6b80]">{rt.cashier_name || '-'}</td>
                      <td className="td tnum text-right font-bold text-[#e03131]">-{rupiah(rt.total)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ------------- omzet per kasir & riwayat shift -------------- */}
        <div className="mt-2.5 grid gap-2.5 lg:grid-cols-2">
          <div className="card overflow-hidden">
            <div className="panel-head">
              <h3 className="panel-title">Laporan per Kasir</h3>
            </div>
            <div className="max-h-[220px] overflow-auto">
              <table className="w-full border-collapse">
                <thead className="sticky top-0 bg-[#f6f9fd]">
                  <tr>
                    <th className="th w-[120px]">Kasir</th>
                    <th className="th w-[70px] text-right">Trx</th>
                    <th className="th w-[110px] text-right">Omzet</th>
                    <th className="th w-[110px] text-right">Laba</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#eef2f7]">
                  {!cashiers.length ? (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-[12.5px] text-[#9fb0c4]">
                        Belum ada transaksi pada rentang ini.
                      </td>
                    </tr>
                  ) : (
                    cashiers.map((k2) => (
                      <tr key={k2.kasir} className="bg-white transition hover:bg-[#f6f9fd]">
                        <td className="td font-semibold text-[#35485c]">{k2.kasir}</td>
                        <td className="td tnum text-right text-[#5b6b80]">{k2.transaksi}</td>
                        <td className="td tnum text-right font-bold text-[#22374b]">{rupiah(k2.omzet)}</td>
                        <td className="td tnum text-right text-[#0a7a3d]">{rupiah(k2.laba)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="panel-head">
              <h3 className="panel-title">Riwayat Shift</h3>
              <span className="text-[11.5px] text-[#7a8ba0]">
                {shifts.filter((sh2) => sh2.status === 'open').length} berjalan
              </span>
            </div>
            <div className="max-h-[220px] overflow-auto">
              <table className="w-full min-w-[460px] border-collapse">
                <thead className="sticky top-0 bg-[#f6f9fd]">
                  <tr>
                    <th className="th w-[120px]">Kode</th>
                    <th className="th w-[90px]">Kasir</th>
                    <th className="th w-[130px]">Dibuka</th>
                    <th className="th w-[130px]">Ditutup</th>
                    <th className="th w-[110px] text-right">Perkiraan</th>
                    <th className="th w-[100px] text-right">Aktual</th>
                    <th className="th w-[90px] text-right">Selisih</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#eef2f7]">
                  {!shifts.length ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-[12.5px] text-[#9fb0c4]">
                        Belum ada shift pada rentang ini.
                      </td>
                    </tr>
                  ) : (
                    shifts.map((sh) => {
                      const selisih =
                        sh.status === 'closed' && sh.closing_cash != null && sh.expected_cash != null
                          ? sh.closing_cash - sh.expected_cash
                          : null;
                      return (
                        <tr key={sh.id} className="bg-white transition hover:bg-[#f6f9fd]">
                          <td className="td font-mono text-[12px] font-semibold text-[#35485c]">{sh.shift_no}</td>
                          <td className="td text-[#5b6b80]">{sh.cashier_name}</td>
                          <td className="td text-[#5b6b80]">{tanggalWaktu(sh.opened_at)}</td>
                          <td className="td text-[#5b6b80]">
                            {sh.closed_at ? (
                              tanggalWaktu(sh.closed_at)
                            ) : (
                              <span className="font-semibold text-[#134a85]">berjalan</span>
                            )}
                          </td>
                          <td className="td tnum text-right text-[#5b6b80]">
                            {sh.expected_cash != null ? rupiah(sh.expected_cash) : '—'}
                          </td>
                          <td className="td tnum text-right text-[#5b6b80]">
                            {sh.closing_cash != null ? rupiah(sh.closing_cash) : '—'}
                          </td>
                          <td
                            className={`td tnum text-right font-bold ${
                              selisih == null
                                ? 'text-[#9fb0c4]'
                                : selisih === 0
                                  ? 'text-[#0a7a3d]'
                                  : selisih > 0
                                    ? 'text-[#b0720a]'
                                    : 'text-[#e03131]'
                            }`}
                          >
                            {selisih == null
                              ? '—'
                              : selisih === 0
                                ? '0'
                                : selisih > 0
                                  ? `+${rupiah(selisih)}`
                                  : `-${rupiah(Math.abs(selisih))}`}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* ---------------------------- detail ----------------------------- */}
      <Modal
        open={Boolean(detail)}
        title={detail ? `Transaksi ${detail.tx.invoice_no}` : ''}
        onClose={() => setDetail(null)}
      >
        {detail ? (
          <div className="space-y-2.5">
            <div className="grid grid-cols-2 gap-1.5 rounded-lg bg-[#f6f9fd] p-3 text-[12px]">
              <Info label="Waktu" value={tanggalWaktu(detail.tx.created_at)} />
              <Info label="Kasir" value={detail.tx.cashier_name || '-'} />
              <Info
                label="Pembayaran"
                value={PAYMENT_METHOD_LABEL[detail.tx.payment_method] ?? detail.tx.payment_method}
              />
              <Info label="Kembalian" value={rupiah(detail.tx.change_due)} />
            </div>

            <ul className="divide-y divide-[#eef2f7] rounded-lg border border-[#d8e0ec]">
              {detail.items.map((it, i) => (
                <li key={i} className="flex items-center justify-between px-3 py-1.5 text-[12.5px]">
                  <span className="truncate text-[#35485c]">
                    {it.qty} x {it.product_name}
                  </span>
                  <span className="tnum shrink-0 font-semibold text-[#22374b]">{rupiah(it.subtotal)}</span>
                </li>
              ))}
            </ul>

            <dl className="space-y-1 rounded-lg border border-[#d8e0ec] p-3 text-[12.5px]">
              <div className="flex justify-between">
                <dt className="text-[#5b6b80]">Subtotal</dt>
                <dd className="tnum">{rupiah(detail.tx.subtotal)}</dd>
              </div>
              {potonganDetail > 0 ? (
                <div className="flex justify-between">
                  <dt className="text-[#5b6b80]">Diskon</dt>
                  <dd className="tnum text-[#e03131]">-{rupiah(potonganDetail)}</dd>
                </div>
              ) : null}
              <div className="flex justify-between border-t border-dashed border-[#d8e0ec] pt-1 text-[14px] font-bold">
                <dt>Total</dt>
                <dd className="tnum">{rupiah(detail.tx.total)}</dd>
              </div>
            </dl>
          </div>
        ) : null}
      </Modal>

      {/* ------------------------- struk (cetak ulang) -------------------- */}
      <Modal
        open={Boolean(printData)}
        title="Struk Transaksi"
        onClose={() => setPrintData(null)}
        footer={
          <>
            <button type="button" className="btn-outline" onClick={() => setPrintData(null)}>
              Tutup
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() =>
                ui.run(async () => {
                  if (printData && (await cetakStrukBluetooth(printData))) return;
                  window.print();
                }, 'cetak-struk')
              }
              disabled={ui.locked('cetak-struk')}
            >
              <Printer className="h-4 w-4" /> Cetak Struk
            </button>
          </>
        }
      >
        {printData ? <ReceiptView data={printData} /> : null}
      </Modal>

      {/* ------------------------ retur penjualan ----------------------- */}
      <ReturModal
        open={Boolean(returSel)}
        tx={returSel?.tx ?? null}
        items={returSel?.items ?? []}
        onClose={() => setReturSel(null)}
        onSaved={() => void load()}
      />

      {/* --------------------------- void transaksi ---------------------- */}
      <Modal
        open={Boolean(voiding)}
        title="Batalkan Transaksi"
        onClose={() => setVoiding(null)}
        width="max-w-sm"
        footer={
          <>
            <button
              type="button"
              className="btn-outline"
              onClick={() => setVoiding(null)}
              disabled={voidGuard.busy}
            >
              Batal
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={() => voiding && klikBatalkan(voiding)}
              disabled={voidGuard.busy}
              data-loading={voidGuard.busy}
            >
              {voidGuard.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {voidGuard.busy ? 'Memproses…' : 'Ya, Batalkan'}
            </button>
          </>
        }
      >
        <p className="text-[13px] leading-relaxed text-[#35485c]">
          Batalkan transaksi <b className="text-[#1b3a5c]">{voiding?.invoice_no}</b> sebesar{' '}
          <b className="text-[#1b3a5c]">{rupiah(voiding?.total ?? 0)}</b>?
        </p>
        <p className="mt-2 rounded-lg bg-[#fff9db] p-2.5 text-[11.5px] text-[#a35b00]">
          Transaksi ditandai Dibatalkan dan stok produk otomatis dikembalikan. Riwayat tetap tercatat.
        </p>
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Stat({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  tone?: 'green' | 'red';
}) {
  const warna = tone === 'green' ? 'text-[#2f9e44]' : tone === 'red' ? 'text-[#c92a2a]' : 'text-[#1b3a5c]';
  return (
    <div className="card p-3.5">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#5b6b80]">
        {icon}
        {label}
      </p>
      <p className={`tnum mt-1 text-[20px] font-bold ${warna}`}>{value}</p>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-[#5b6b80]">{label}</span>
      <span className="truncate font-semibold text-[#22374b]">{value}</span>
    </div>
  );
}