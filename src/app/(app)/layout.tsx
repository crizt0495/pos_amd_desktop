'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  AlertTriangle,
  BarChart3,
  Boxes,
  LogOut,
  Maximize2,
  Minus,
  Monitor,
  Receipt,
  RefreshCw,
  Settings,
  Store,
  Truck,
  X,
} from 'lucide-react';

import { ensureSeeded, settingsApi } from '@/lib/api';
import { bukaFolderDatabase, cekKesiapanDatabase, kontrolJendela, muatUlangAplikasi } from '@/lib/desktop';
import {
  autoSambungBluetooth,
  dengarStatusBluetooth,
  type StatusBluetooth,
} from '@/lib/bluetoothPrinter';
import { bacaPrinterSettings } from '@/lib/printerSettings';
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
  { href: '/monitoring', label: 'Monitoring', sub: 'Pemantauan Toko', Icon: Monitor },
  { href: '/pembelian', label: 'Pembelian', sub: 'PO & Supplier', Icon: Truck },
] as const;

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const [storeName, setStoreName] = React.useState('Toko');
  const [cashierName, setCashierName] = React.useState('Kasir');
  const [openSettings, setOpenSettings] = React.useState(false);
  const [clock, setClock] = React.useState('');
  const [btStatus, setBtStatus] = React.useState<StatusBluetooth>('nonaktif');
  const [btName, setBtName] = React.useState<string | null>(null);
  const [dbProblem, setDbProblem] = React.useState<{ error: string; path?: string } | null>(null);

  // Cek sekali apakah database lokal benar-benar bisa dibuka. Bila gagal,
  // seluruh layar menampilkan peringatan jujur (bukan angka 0 palsu).
  React.useEffect(() => {
    let hidup = true;
    void cekKesiapanDatabase().then((r) => {
      if (!hidup) return;
      setDbProblem(r.ok ? null : { error: r.error || 'Database lokal tidak aktif.', path: r.path });
    });
    return () => {
      hidup = false;
    };
  }, []);

  React.useEffect(() => {
    void ensureSeeded();
    void settingsApi.get<string>('storeName', 'Toko').then((n) => setStoreName(n || 'Toko'));
    void settingsApi.get<string>('cashierName', 'Kasir').then((n) => setCashierName(n || 'Kasir'));
    // Sambung otomatis printer Bluetooth yang pernah dipasang (Web Bluetooth).
    void autoSambungBluetooth();
    setBtName(bacaPrinterSettings().btDeviceName);

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
    const stopBt = dengarStatusBluetooth((s) => {
      setBtStatus(s);
      // Ikut perbarui nama perangkat (mis. setelah pasang baru / putus).
      setBtName(bacaPrinterSettings().btDeviceName);
    });
    return () => {
      window.clearInterval(t);
      stopBt();
    };
  }, []);

  async function logout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      /* tetap logout di sisi klien */
    }
    router.replace('/login');
  }

  const active = (href: string) => {
    if (href === '/kasir') return pathname === href || pathname === '/';
    return pathname === href || pathname.startsWith(`${href}/`);
  };

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

          {btName ? (
            <span
              title={`Printer Bluetooth: ${btName}`}
              className={`hidden items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold sm:flex ${
                btStatus === 'tersambung'
                  ? 'bg-[#0ca678]/25 text-[#b2f2bb]'
                  : btStatus === 'mencoba'
                    ? 'bg-white/15 text-white/80'
                    : 'bg-[#c92a2a]/35 text-[#ffc9c9]'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  btStatus === 'tersambung'
                    ? 'bg-[#51cf66]'
                    : btStatus === 'mencoba'
                      ? 'animate-pulse bg-[#ffd43b]'
                      : 'bg-[#ff6b6b]'
                }`}
              />
              {btStatus === 'tersambung'
                ? 'Printer ON'
                : btStatus === 'mencoba'
                  ? 'Menyambung…'
                  : 'Printer OFF'}
            </span>
          ) : null}

          <span className="hidden items-center gap-0.5 sm:flex">
            <button
              type="button"
              title="Perkecil"
              aria-label="Perkecil jendela"
              onClick={() => kontrolJendela('minimize')}
              className="grid h-7 w-8 place-items-center text-white/80 hover:bg-white/15"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title="Perbesar"
              aria-label="Perbesar / kembalikan jendela"
              onClick={() => kontrolJendela('maximize')}
              className="grid h-7 w-8 place-items-center text-white/80 hover:bg-white/15"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title="Tutup jendela"
              aria-label="Tutup jendela"
              onClick={() => kontrolJendela('close')}
              className="grid h-7 w-8 place-items-center text-white/80 hover:bg-[#c92a2a]"
            >
              <X className="h-3.5 w-3.5" />
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
        {dbProblem ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#f3c2c2] bg-[#fff1f1] px-3 py-2 text-[12px] text-[#a12828] sm:px-4">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span className="min-w-[220px] flex-1">
              Database gagal dibuka{dbProblem.path ? ` di ${dbProblem.path}` : ''}. {dbProblem.error} Data
              lama TIDAK dihapus — jangan mengisi data baru sebelum database tersambung.
            </span>
            <button
              type="button"
              className="btn-outline h-7 px-2 text-[11px]"
              onClick={() => void muatUlangAplikasi()}
            >
              <RefreshCw className="h-3 w-3" /> Coba Lagi
            </button>
            <button
              type="button"
              className="btn-outline h-7 px-2 text-[11px]"
              onClick={() => void bukaFolderDatabase()}
            >
              Buka Lokasi Database
            </button>
          </div>
        ) : null}
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
