'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { BarChart3, Boxes, ExternalLink, LogOut, Receipt, Settings } from 'lucide-react';

import { ensureSeeded, settingsApi } from '@/lib/api';
import { ToastProvider } from '@/components/Toast';
import { SettingsModal } from '@/components/SettingsModal';

const NAV = [
  { href: '/kasir', label: 'Kasir', Icon: Receipt },
  { href: '/produk', label: 'Produk', Icon: Boxes },
  { href: '/laporan', label: 'Laporan', Icon: BarChart3 },
] as const;

/** Portal KasirPro (mobile PWA) — dibuka di tab terpisah. */
const PORTAL_URL = process.env.NEXT_PUBLIC_PORTAL_URL || 'https://pos-amd.vercel.app';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const [storeName, setStoreName] = React.useState('Toko');
  const [openSettings, setOpenSettings] = React.useState(false);
  const [today, setToday] = React.useState('');

  React.useEffect(() => {
    void ensureSeeded();
    void settingsApi.get<string>('storeName', 'Toko').then((n) => setStoreName(n || 'Toko'));
    setToday(
      new Date().toLocaleDateString('id-ID', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
    );
  }, []);

  async function logout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      /* tetap logout di sisi klien */
    }
    router.replace('/login');
  }

  const active = (href: string) => (href === '/kasir' ? pathname === href || pathname === '/' : pathname === href);

  return (
    <ToastProvider>
      <div className="flex h-screen min-h-0 flex-col bg-zinc-100">
        {/* topbar */}
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-zinc-200 bg-white px-3 sm:px-4">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-zinc-900">
              <Receipt className="h-4 w-4 text-white" />
            </span>
            <div className="leading-tight">
              <p className="text-[13.5px] font-bold text-zinc-900">KasirPro POS</p>
              <p className="max-w-[140px] truncate text-[11px] text-zinc-500 sm:max-w-none">
                {storeName}
              </p>
            </div>
          </div>

          <span className="ml-auto hidden text-[12px] text-zinc-500 md:block">{today}</span>

          <button
            type="button"
            className="btn-ghost h-9 px-2 text-[12.5px] sm:px-3"
            onClick={() => setOpenSettings(true)}
          >
            <Settings className="h-4 w-4" />
            <span className="hidden sm:inline">Pengaturan</span>
          </button>

          <a
            className="btn-ghost h-9 px-2 text-[12.5px] sm:px-3"
            href={PORTAL_URL}
            target="_blank"
            rel="noreferrer"
            title="Buka KasirPro Portal (mobile)"
          >
            <ExternalLink className="h-4 w-4" />
            <span className="hidden lg:inline">Portal</span>
          </a>

          <button type="button" className="btn-ghost h-9 px-2 text-[12.5px] sm:px-3" onClick={() => void logout()}>
            <LogOut className="h-4 w-4" />
            <span className="hidden md:inline">Keluar</span>
          </button>
        </header>

        <div className="flex min-h-0 flex-1">
          {/* sidebar (desktop) */}
          <nav className="hidden w-52 shrink-0 flex-col gap-1 border-r border-zinc-200 bg-white p-2.5 md:flex">
            {NAV.map(({ href, label, Icon }) => {
              const on = active(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-[13px] font-semibold transition ${
                    on ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-100'
                  }`}
                >
                  <Icon className="h-4 w-4" /> {label}
                </Link>
              );
            })}

            <p className="mt-auto px-3 pt-4 text-[10.5px] leading-relaxed text-zinc-400">
              KasirPro POS — web
              <br />
              Data aman di Supabase (per akun).
            </p>
          </nav>

          <main className="min-h-0 min-w-0 flex-1">{children}</main>
        </div>

        {/* tab bar (mobile) */}
        <nav className="flex shrink-0 border-t border-zinc-200 bg-white md:hidden">
          {NAV.map(({ href, label, Icon }) => {
            const on = active(href);
            return (
              <Link
                key={href}
                href={href}
                className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10.5px] font-semibold transition ${
                  on ? 'text-zinc-900' : 'text-zinc-400'
                }`}
              >
                <Icon className="h-5 w-5" /> {label}
              </Link>
            );
          })}
        </nav>
      </div>

      <SettingsModal
        open={openSettings}
        onClose={() => setOpenSettings(false)}
        onSaved={(n) => setStoreName(n)}
      />
    </ToastProvider>
  );
}