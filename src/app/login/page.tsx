import type { Metadata } from 'next';
import { AlertCircle, Store } from 'lucide-react';

import { DEMO_SERIAL } from '@/lib/license';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Masuk — KasirPro POS' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const next = sp.next && sp.next.startsWith('/') && !sp.next.startsWith('//') ? sp.next : '/kasir';

  let error: string | null = null;
  if (sp.error) {
    try {
      error = decodeURIComponent(sp.error);
    } catch {
      error = sp.error;
    }
  }

  return (
    <main className="grid min-h-[100dvh] place-items-center bg-gradient-to-b from-[#134a85] via-[#1b5fa8] to-[#0f3a69] px-4 py-10">
      <div className="w-full max-w-[420px]">
        <div className="mb-5 flex items-center justify-center gap-3 text-white">
          <span className="grid h-12 w-12 place-items-center rounded-xl bg-white/15 ring-1 ring-white/30">
            <Store className="h-6 w-6" />
          </span>
          <div>
            <p className="text-[20px] font-bold leading-tight">KasirPro POS</p>
            <p className="text-[12px] text-white/70">Program Kasir — Penjualan &amp; Stok</p>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl bg-white shadow-[0_24px_60px_rgba(0,0,0,0.35)]">
          <div className="bg-gradient-to-r from-[#2470c0] to-[#134a85] px-5 py-2.5">
            <h1 className="text-[14px] font-bold text-white">Masuk ke Kasir</h1>
          </div>

          <div className="p-5">
            {error ? (
              <div className="mb-4 rounded-lg border border-[#ffc9c9] bg-[#fff5f5] px-3.5 py-2.5">
                <p className="flex items-start gap-1.5 text-[12px] leading-snug text-[#a51d1d]">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {error}
                </p>
              </div>
            ) : null}

            <LoginForm next={next} demoKey={DEMO_SERIAL} />
          </div>
        </div>

        <p className="mt-5 text-center text-[11px] leading-relaxed text-white/60">
          Memasuki POS mewajibkan lisensi aktif dari <b className="text-white/80">KasirPro Portal</b>. Data
          kasir aman dan khusus untuk toko pemegang lisensi.
        </p>
      </div>
    </main>
  );
}
