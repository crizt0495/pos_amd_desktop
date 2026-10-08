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
  const [summary, setSummary] = React.useState({ omzet: 0, laba: 0, transaksi: 0, diskon: 0 });
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
        });
      if (t.ok) setTop(t.data.slice(0, 5));
      if (p.ok) setKritis(p.data.filter((x) => x.stock <= x.min_stock && x.min_stock > 0).slice(0, 10));
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
    <div className="mx-auto max-w-3xl space-y-5 p-4">
      <h1 className="text-xl font-bold">Monitoring Toko — hari ini</h1>

      {/* Kartu ringkasan */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Omzet" value={rupiah(summary.omzet)} icon={<TrendingUp className="h-4 w-4" />} />
        <Stat label="Laba Kotor" value={rupiah(summary.laba)} tone="green" icon={<Wallet className="h-4 w-4" />} />
        <Stat label="Transaksi" value={angka(summary.transaksi)} />
        <Stat label="Diskon" value={rupiah(summary.diskon)} tone="red" />
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

      {/* Stok kritis */}
      <Section title="Stok Kritis (≤ min stok)">
        {muat ? (
          <p className="text-sm text-zinc-500">Memuat…</p>
        ) : kritis.length === 0 ? (
          <p className="text-sm text-emerald-600">Semua stok masih aman ✅</p>
        ) : (
          <ul className="space-y-1.5">
            {kritis.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-3 py-2"
              >
                <span className="truncate text-sm font-medium">{p.name}</span>
                <span className="flex items-center gap-1 text-sm font-bold text-amber-700">
                  <AlertTriangle className="h-4 w-4" /> {p.stock} / {p.min_stock}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Produk terlaris */}
      <Section title="Produk Terlaris Hari Ini">
        {top.length === 0 ? (
          <p className="text-sm text-zinc-500">Belum ada penjualan hari ini.</p>
        ) : (
          <ul className="space-y-1.5">
            {top.map((t, i) => (
              <li key={`${t.product_id}-${i}`} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 truncate">
                  <span className="text-zinc-400">{i + 1}.</span>
                  <Boxes className="h-4 w-4 text-zinc-400" />
                  <span className="truncate">{t.name}</span>
                </span>
                <span className="tnum text-zinc-600">{t.qty} terjual · {rupiah(t.omzet)}</span>
              </li>
            ))}
          </ul>
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
