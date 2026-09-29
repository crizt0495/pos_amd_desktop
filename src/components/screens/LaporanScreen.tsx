'use client';

import * as React from 'react';
import { Ban, BarChart3, Eye, Printer, RefreshCw, TrendingUp } from 'lucide-react';

import { reportsApi, transactionsApi } from '@/lib/api';
import { angka, isoHariIni, isoHariLalu, rupiah, tanggalWaktu } from '@/lib/format';
import { buildReceiptFromTx, loadStoreMeta, type StoreMeta } from '@/lib/receipt';
import { useToast } from '@/components/Toast';
import { Modal } from '@/components/Modal';
import { ReceiptView } from '@/components/Receipt';
import { PAYMENT_METHOD_LABEL } from '@/lib/types';
import type {
  DailyReport,
  PaymentReport,
  ReceiptData,
  ReportSummary,
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
  const [busy, setBusy] = React.useState(false);

  const range = preset === 'all' ? {} : { from, to };

  const load = React.useCallback(async () => {
    if (!ready) return;
    setLoading(true);
    const [s, t, d, p, l] = await Promise.all([
      reportsApi.summary(range),
      reportsApi.topProducts(range),
      reportsApi.daily(range),
      reportsApi.byPayment(range),
      transactionsApi.list({ ...range, limit: 200 }),
    ]);

    if (s.ok) setSummary(s.data);
    if (t.ok) setTop(t.data);
    if (d.ok) setDaily(d.data);
    if (p.ok) setByPayment(p.data);
    if (l.ok) setList(l.data);
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

  async function cetak(tx: Transaction) {
    setBusy(true);
    try {
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
    } finally {
      setBusy(false);
    }
  }

  async function batalkan(tx: Transaction) {
    setBusy(true);
    try {
      const res = await transactionsApi.void(tx.id);
      if (!res.ok) {
        toast.error('Gagal membatalkan transaksi', res.error);
        return;
      }
      toast.ok('Transaksi dibatalkan', 'Stok produk sudah dikembalikan.');
      setVoiding(null);
      onVoid?.(tx.invoice_no);
      await load();
    } finally {
      setBusy(false);
    }
  }

  const omzetMax = Math.max(1, ...daily.map((d) => d.omzet));

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ------------------------------ filter ---------------------------- */}
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 bg-white p-3">
        <div className="flex gap-1">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => pilihPreset(p)}
              className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold transition ${
                preset === p.key ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

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
          <span className="text-[12px] text-zinc-400">s/d</span>
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

        <button type="button" className="btn-outline h-8 px-3" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Muat Ulang
        </button>

        <span className="ml-auto text-[11.5px] text-zinc-400">
          {preset === 'all' ? 'Semua transaksi' : `${from} s/d ${to}`}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {/* ---------------------------- summary -------------------------- */}
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <Stat label="Omzet" value={rupiah(summary?.total_omzet ?? 0)} icon={<TrendingUp className="h-3.5 w-3.5" />} />
          <Stat label="Laba Kotor" value={rupiah(summary?.total_laba ?? 0)} tone="green" />
          <Stat label="Transaksi" value={angka(summary?.jumlah_transaksi ?? 0)} />
          <Stat label="Item Terjual" value={angka(summary?.total_item ?? 0)} />
        </div>

        <div className="mt-2.5 grid gap-2.5 lg:grid-cols-[1.35fr_1fr]">
          {/* ------------------------- grafik harian ------------------- */}
          <div className="card p-3.5">
            <h3 className="mb-2.5 flex items-center gap-2 text-[13px] font-bold text-zinc-800">
              <BarChart3 className="h-4 w-4" /> Omzet Harian
            </h3>
            {!daily.length ? (
              <p className="py-8 text-center text-[12.5px] text-zinc-400">Belum ada transaksi pada rentang ini.</p>
            ) : (
              <>
                <div className="flex h-32 items-end gap-1">
                  {daily.map((d) => (
                    <div key={d.tanggal} className="group flex flex-1 flex-col items-center gap-1">
                      <div className="relative flex w-full flex-1 items-end">
                        <div
                          className="w-full rounded-t bg-zinc-900/85 transition group-hover:bg-zinc-900"
                          style={{ height: `${Math.max(3, (d.omzet / omzetMax) * 100)}%` }}
                          title={`${d.tanggal}: ${rupiah(d.omzet)} (${d.transaksi} transaksi)`}
                        />
                      </div>
                      <span className="truncate text-[9.5px] text-zinc-400">
                        {d.tanggal.slice(8)}/{d.tanggal.slice(5, 7)}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-2.5 space-y-1 border-t border-dashed border-zinc-200 pt-2 text-[11.5px]">
                  {daily.slice(-5).reverse().map((d) => (
                    <div key={d.tanggal} className="flex items-center justify-between">
                      <span className="text-zinc-500">{d.tanggal}</span>
                      <span className="flex items-center gap-3">
                        <span className="tnum text-zinc-500">{d.transaksi} trx</span>
                        <span className="tnum w-24 text-right font-semibold text-zinc-800">{rupiah(d.omzet)}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* ---------------------- produk terlaris -------------------- */}
          <div className="card p-3.5">
            <h3 className="mb-2.5 text-[13px] font-bold text-zinc-800">Produk Terlaris</h3>
            {!top.length ? (
              <p className="py-8 text-center text-[12.5px] text-zinc-400">Belum ada penjualan.</p>
            ) : (
              <ol className="space-y-1.5">
                {top.map((p, i) => (
                  <li key={`${p.name}-${i}`} className="flex items-center gap-2.5">
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-zinc-100 text-[10.5px] font-bold text-zinc-500">
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-zinc-700">{p.name}</span>
                    <span className="tnum shrink-0 text-[11.5px] text-zinc-500">{angka(p.qty)}</span>
                    <span className="tnum w-24 shrink-0 text-right text-[12px] font-semibold text-zinc-800">
                      {rupiah(p.omzet)}
                    </span>
                  </li>
                ))}
              </ol>
            )}

            {byPayment.length ? (
              <>
                <h3 className="mb-1.5 mt-3.5 border-t border-dashed border-zinc-200 pt-3 text-[13px] font-bold text-zinc-800">
                  Metode Pembayaran
                </h3>
                <ul className="space-y-1">
                  {byPayment.map((p) => (
                    <li key={p.metode} className="flex items-center justify-between text-[12px]">
                      <span className="text-zinc-600">{PAYMENT_METHOD_LABEL[p.metode] ?? p.metode}</span>
                      <span className="flex items-center gap-3">
                        <span className="tnum text-zinc-400">{p.n} trx</span>
                        <span className="tnum w-24 text-right font-semibold text-zinc-800">{rupiah(p.omzet)}</span>
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
          <div className="flex items-center justify-between border-b border-zinc-100 px-3.5 py-2.5">
            <h3 className="text-[13px] font-bold text-zinc-800">Riwayat Transaksi</h3>
            <span className="text-[11.5px] text-zinc-400">{list.length} transaksi terbaru</span>
          </div>

          <div className="max-h-[320px] overflow-auto">
            <table className="w-full min-w-[760px] border-collapse">
              <thead className="sticky top-0 bg-white shadow-[0_1px_0_#e4e4e7]">
                <tr>
                  <th className="th w-[150px]">Invoice</th>
                  <th className="th w-[150px]">Waktu</th>
                  <th className="th w-[90px]">Metode</th>
                  <th className="th w-[110px] text-right">Total</th>
                  <th className="th w-[100px]">Status</th>
                  <th className="th w-[150px] text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {!list.length && !loading ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-[12.5px] text-zinc-400">
                      Belum ada transaksi pada rentang ini.
                    </td>
                  </tr>
                ) : (
                  list.map((tx) => (
                    <tr key={tx.id} className="bg-white transition hover:bg-zinc-50">
                      <td className="td font-mono text-[12px] font-semibold text-zinc-700">{tx.invoice_no}</td>
                      <td className="td text-zinc-500">{tanggalWaktu(tx.created_at)}</td>
                      <td className="td text-zinc-500">{PAYMENT_METHOD_LABEL[tx.payment_method] ?? tx.payment_method}</td>
                      <td className="td tnum text-right font-semibold">{rupiah(tx.total)}</td>
                      <td className="td">
                        {tx.status === 'void' ? (
                          <span className="rounded-md bg-red-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-red-600">
                            Dibatalkan
                          </span>
                        ) : (
                          <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-emerald-700">
                            Selesai
                          </span>
                        )}
                      </td>
                      <td className="td">
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            className="btn-ghost px-2 py-1 text-[11.5px]"
                            onClick={() => void lihat(tx)}
                          >
                            <Eye className="h-3.5 w-3.5" /> Detail
                          </button>
                          <button
                            type="button"
                            className="btn-ghost px-2 py-1 text-[11.5px]"
                            onClick={() => void cetak(tx)}
                            disabled={busy || tx.status === 'void'}
                          >
                            <Printer className="h-3.5 w-3.5" />
                          </button>
                          {tx.status !== 'void' ? (
                            <button
                              type="button"
                              className="btn-ghost px-2 py-1 text-[11.5px] text-red-600 hover:bg-red-50"
                              onClick={() => setVoiding(tx)}
                            >
                              <Ban className="h-3.5 w-3.5" />
                            </button>
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
      </div>

      {/* ---------------------------- detail ----------------------------- */}
      <Modal
        open={Boolean(detail)}
        title={detail ? `Transaksi ${detail.tx.invoice_no}` : ''}
        onClose={() => setDetail(null)}
      >
        {detail ? (
          <div className="space-y-2.5">
            <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-zinc-50 p-3 text-[12px]">
              <Info label="Waktu" value={tanggalWaktu(detail.tx.created_at)} />
              <Info label="Kasir" value={detail.tx.cashier_name || '-'} />
              <Info
                label="Pembayaran"
                value={PAYMENT_METHOD_LABEL[detail.tx.payment_method] ?? detail.tx.payment_method}
              />
              <Info label="Kembalian" value={rupiah(detail.tx.change_due)} />
            </div>

            <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200">
              {detail.items.map((it, i) => (
                <li key={i} className="flex items-center justify-between px-3 py-1.5 text-[12.5px]">
                  <span className="truncate text-zinc-700">
                    {it.qty} x {it.product_name}
                  </span>
                  <span className="tnum shrink-0 font-semibold text-zinc-800">{rupiah(it.subtotal)}</span>
                </li>
              ))}
            </ul>

            <dl className="space-y-1 rounded-xl border border-zinc-200 p-3 text-[12.5px]">
              <div className="flex justify-between">
                <dt className="text-zinc-500">Subtotal</dt>
                <dd className="tnum">{rupiah(detail.tx.subtotal)}</dd>
              </div>
              {detail.tx.discount_amount > 0 ? (
                <div className="flex justify-between">
                  <dt className="text-zinc-500">Diskon</dt>
                  <dd className="tnum text-red-600">-{rupiah(detail.tx.discount_amount)}</dd>
                </div>
              ) : null}
              <div className="flex justify-between border-t border-dashed border-zinc-200 pt-1 text-[14px] font-bold">
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
            <button type="button" className="btn-primary" onClick={() => window.print()}>
              <Printer className="h-4 w-4" /> Cetak Struk
            </button>
          </>
        }
      >
        {printData ? <ReceiptView data={printData} /> : null}
      </Modal>

      {/* --------------------------- void transaksi ---------------------- */}
      <Modal
        open={Boolean(voiding)}
        title="Batalkan Transaksi"
        onClose={() => setVoiding(null)}
        width="max-w-sm"
        footer={
          <>
            <button type="button" className="btn-outline" onClick={() => setVoiding(null)}>
              Batal
            </button>
            <button type="button" className="btn-danger" onClick={() => void batalkan(voiding!)} disabled={busy}>
              {busy ? 'Memproses...' : 'Ya, Batalkan'}
            </button>
          </>
        }
      >
        <p className="text-[13px] leading-relaxed text-zinc-600">
          Batalkan transaksi <b className="text-zinc-900">{voiding?.invoice_no}</b> sebesar{' '}
          <b className="text-zinc-900">{rupiah(voiding?.total ?? 0)}</b>?
        </p>
        <p className="mt-2 rounded-lg bg-amber-50 p-2.5 text-[11.5px] text-amber-800">
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
  tone?: 'green';
}) {
  return (
    <div className="card p-3.5">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
        {icon}
        {label}
      </p>
      <p className={`tnum mt-1 text-[20px] font-bold ${tone === 'green' ? 'text-emerald-600' : 'text-zinc-900'}`}>
        {value}
      </p>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-zinc-500">{label}</span>
      <span className="truncate font-semibold text-zinc-800">{value}</span>
    </div>
  );
}