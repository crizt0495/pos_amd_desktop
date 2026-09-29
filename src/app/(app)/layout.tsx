'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  BarChart3,
  Boxes,
  LogOut,
  Maximize2,
  Minus,
  Receipt,
  Settings,
  Store,
} from 'lucide-react';

import { ensureSeeded, settingsApi } from '@/lib/api';
import { CartProvider } from '@/lib/cart-store';
import { ToastProvider } from '@/components/Toast';
import { SettingsModal } from '@/components/SettingsModal';

/**
 * Ribbon modul — urutan & penamaan mengikuti Program Toko iPOS 5
 * (Master Data · Persediaan · Penjualan · Pembelian · Kas · Laporan · Pengaturan).
 * Modul yang belum ada di aplikasi ini disembunyikan.
 */
const MODULES = [
  { href: '/produk', label: 'Master Data', sub: 'Data Barang', Icon: Boxes },
  { href: '/kasir', label: 'Penjualan', sub: 'Penjualan Kasir', Icon: Receipt },
  { href: '/laporan', label: 'Laporan', sub: 'Laporan Penjualan', Icon: BarChart3 },
] as const;

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const [storeName, setStoreName] = React.useState('Toko');
  const [cashierName, setCashierName] = React.useState('Kasir');
  const [openSettings, setOpenSettings] = React.useState(false);
  const [clock, setClock] = React.useState('');

  React.useEffect(() => {
    void ensureSeeded();
    void settingsApi.get<string>('storeName', 'Toko').then((n) => setStoreName(n || 'Toko'));
    void settingsApi.get<string>('cashierName', 'Kasir').then((n) => setCashierName(n || 'Kasir'));

    const tick = () =>
      setClock(
        new Date().toLocaleString('id-ID', {
          weekday: 'long',
          day: '2-digit',
          month: 'long',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
      );
    tick();
    const t = window.setInterval(tick, 1000);
    return () => window.clearInterval(t);
  }, []);

  async function logout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      /* tetap logout di sisi klien */
    }
    router.replace('/login');
  }

  const active = (href: string) =>
    href === '/kasir' ? pathname === href || pathname === '/' : pathname === href;

  const isKasir = pathname === '/kasir' || pathname === '/';
  const modulAktif = MODULES.find((m) => active(m.href))?.sub ?? 'Program Toko';

  return (
    <ToastProvider>
      <CartProvider>
      <div className="flex h-screen min-h-0 flex-col bg-[#eef2f8]">
        {/* ===================== TITLE BAR (Sistem Menu) ==================== */}
        <div className="ipos-titlebar h-10">
          <span className="ipos-logo">
            <Store className="h-4 w-4" />
          </span>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-[12.5px] font-bold">Program Toko — KasirPro POS</p>
            <p className="truncate text-[10px] text-white/70">{storeName}</p>
          </div>

          <span className="ml-auto hidden text-[11px] tabular-nums text-white/75 lg:block">{clock}</span>

          <span className="hidden items-center gap-0.5 sm:flex">
            <button
              type="button"
              title="Perkecil"
              className="grid h-7 w-8 place-items-center text-white/80 hover:bg-white/15"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title="Perbesar"
              className="grid h-7 w-8 place-items-center text-white/80 hover:bg-white/15"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          </span>

          <button
            type="button"
            onClick={logout}
            title="Keluar"
            className="grid h-7 w-8 place-items-center text-white/90 hover:bg-[#c92a2a]"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>

        {/* =========================== MENU RIBBON ========================== */}
        <div className="ipos-ribbon overflow-x-auto">
          <nav className="flex items-stretch">
            {MODULES.map(({ href, label, Icon }) => (
              <Link
                key={href}
                href={href}
                className={`ribbon-tab ${active(href) ? 'ribbon-tab-active' : ''}`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            ))}
          </nav>

          <div className="ribbon-group my-1.5">
            <button type="button" className="ribbon-btn" onClick={() => setOpenSettings(true)}>
              <Settings className="h-3.5 w-3.5" />
              <span className="hidden md:inline">Pengaturan</span>
            </button>
          </div>
        </div>

        {/* ==================== KONTEN (bisa render sub-ribbon) ============ */}
        <main className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</main>

        {/* =========================== STATUS BAR =========================== */}
        <div className="ipos-statusbar h-6">
          <span className="truncate">
            <b className="font-semibold text-[#1b3a5c]">User:</b> {cashierName}
          </span>
          <span className="hidden truncate sm:inline">
            <b className="font-semibold text-[#1b3a5c]">Toko:</b> {storeName}
          </span>

          {/* Pintasan hanya relevan di form kasir — ala iPOS (status bar ikut form aktif). */}
          <span className="ml-auto hidden truncate text-[#7a8ba0] md:inline">
            {isKasir ? (
              <>
                <span className="kbd">F9</span> Transaksi Baru
                <span className="ml-3">
                  <span className="kbd">F8</span> Kode Item
                </span>
                <span className="ml-3">
                  <span className="kbd">End</span> Bayar
                </span>
                <span className="ml-3">
                  <span className="kbd">F5</span> Pending
                </span>
                <span className="ml-3">
                  <span className="kbd">Esc</span> Batal
                </span>
              </>
            ) : (
              <span className="font-semibold text-[#5b6b80]">{modulAktif}</span>
            )}
          </span>
        </div>
      </div>

      <SettingsModal
        open={openSettings}
        onClose={() => setOpenSettings(false)}
        onSaved={(n) => {
          setStoreName(n);
          void settingsApi.get<string>('cashierName', 'Kasir').then((c) => setCashierName(c || 'Kasir'));
        }}
      />
      </CartProvider>
    </ToastProvider>
  );
}
