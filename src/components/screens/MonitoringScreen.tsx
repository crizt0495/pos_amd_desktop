'use client';

import * as React from 'react';
import { AlertTriangle, Boxes, TrendingUp, Wallet } from 'lucide-react';

import { productsApi, reportsApi, shiftsApi } from '@/lib/api';
import { angka, isoHariIni, rupiah } from '@/lib/format';
import type { KasirShift, Product, TopProduct } from '@/lib/types';

/**
 * Monitoring cepat untuk pemilik — versi ringkas dari Laporan yang bisa
 * dibuka langsung dari HP. Tujuan: sekali buka, lihat keadaan toko hari ini:
 * omset, laba, transaksi, produk terlaris, stok kritis, dan status shift.
 */
export default function MonitoringScreen() {
  const [summary, setSummary] = React.useState({ omzet: 0, laba: 0, transaksi: 0, diskon: 0, item: 0, rataRata: 0 });
  const [top, setTop] = React.useState<TopProduct[]>([]);
  const [kritis, setKritis] = React.useState<Product[]>([]);
  const [shift, setShift] = React.useState<KasirShift | null>(null);
  const [muat, setMuat] = React.useState(true);

  React.useEffect(() => {
    const today = isoHariIni();
    let hidup = true;
    const muat = async () => {
      const [s, t, p, sh] = await Promise.all([
        reportsApi.summary({ from: today, to: today }),
        reportsApi.topProducts({ from: today, to: today }),
        productsApi.list(),
        shiftsApi.active(),
      ]);
      if (!hidup) return;
      if (s.ok)
        setSummary({
          omzet: s.data.total_omzet,
          laba: s.data.total_laba,
          transaksi: s.data.jumlah_transaksi,
          diskon: s.data.total_diskon,
          item: s.data.total_item,
          rataRata: s.data.rata_rata,
        });
      if (t.ok) setTop(t.data.slice(0, 10));
      if (p.ok) setKritis(p.data.filter((x) => x.is_active && x.stock <= 5).slice(0, 20));
      if (sh.ok) setShift(sh.data);
      setMuat(false);
    };
    // Pemuatan pertama + auto-refresh 10 dtk
    void muat().catch(() => {
      if (hidup) setMuat(false);
    });
    const prefers = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const t = window.setInterval(() => void muat().catch(() => {}), prefers ? 30000 : 10000);
    return () => {
      hidup = false;
      window.clearInterval(t);
    };
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-5 overflow-auto p-4">
      <h1 className="text-xl font-bold">Monitoring Toko — hari ini</h1>

      {/* Kartu ringkasan — 4 yang diminta: Omset, Transaksi, Item Terjual, Rata2/Transaksi */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total Omset Hari Ini" value={rupiah(summary.omzet)} icon={<TrendingUp className="h-4 w-4" />} />
        <Stat label="Total Transaksi" value={angka(summary.transaksi)} />
        <Stat label="Total Item Terjual" value={angka(summary.item)} />
        <Stat label="Rata-rata/Transaksi" value={rupiah(summary.rataRata)} tone="green" icon={<Wallet className="h-4 w-4" />} />
      </div>

      {/* Shift */}
      <Section title="Status Shift Kasir">
        {shift ? (
          <div className="rounded-xl border border-zinc-200 bg-white p-3">
            <p className="text-sm font-semibold">
              {shift.shift_no} — {shift.cashier_name}
            </p>
            <p className="text-xs text-zinc-500">
              Dibuka {new Date(shift.opened_at).toLocaleString('id-ID')} · Kas awal{' '}
              {rupiah(shift.opening_cash)}
            </p>
          </div>
        ) : (
          <p className="text-sm text-zinc-500">Tidak ada shift kasir aktif.</p>
        )}
      </Section>

      {/* Stok menipis (<= 5) — badge merah SEGERA BELI */}
      <Section title="Stok Menipis (≤ 5) — Segera Beli">
        {muat ? (
          <p className="text-sm text-zinc-500">Memuat…</p>
        ) : kritis.length === 0 ? (
          <p className="text-sm text-emerald-600">Semua stok masih aman ✅</p>
        ) : (
          <ul className="space-y-1.5">
            {kritis.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-3 py-2"
              >
                <span className="truncate text-sm font-medium">{p.name}</span>
                <span className="flex items-center gap-2 text-sm font-bold text-red-700">
                  <AlertTriangle className="h-4 w-4" /> {p.stock} / {p.min_stock}
                  <span className="ml-1 rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                    Segera Beli
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* 10 Produk Terlaris Hari Ini — tabel (Nama | Qty | Subtotal) */}
      <Section title="10 Produk Terlaris Hari Ini">
        {top.length === 0 ? (
          <p className="text-sm text-zinc-500">Belum ada penjualan hari ini.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-zinc-500">
                <th className="px-2 py-2">No</th>
                <th className="px-2 py-2">Nama</th>
                <th className="px-2 py-2 text-right">Qty</th>
                <th className="px-2 py-2 text-right">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {top.map((t, i) => (
                <tr key={`${t.product_id}-${i}`} className="border-t border-zinc-100">
                  <td className="px-2 py-2 text-zinc-400">{i + 1}</td>
                  <td className="flex items-center gap-2 px-2 py-2">
                    <Boxes className="h-4 w-4 text-zinc-400" />
                    <span className="truncate">{t.name}</span>
                  </td>
                  <td className="tnum px-2 py-2 text-right">{angka(t.qty)}</td>
                  <td className="tnum px-2 py-2 text-right font-semibold">{rupiah(t.omzet)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
}

function Stat({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  tone?: 'default' | 'green' | 'red';
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-3">
      <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
        {icon} {label}
      </p>
      <p
        className={`mt-1 text-lg font-bold ${
          tone === 'green' ? 'text-emerald-600' : tone === 'red' ? 'text-red-600' : 'text-zinc-900'
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-2 text-[13px] font-bold text-zinc-700">{title}</h2>
      <div className="rounded-2xl border border-zinc-200 bg-white p-3">{children}</div>
    </section>
  );
}
