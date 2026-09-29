import type { Metadata } from 'next';
import { AlertCircle, Receipt } from 'lucide-react';

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
    <main className="grid min-h-[100dvh] place-items-center bg-zinc-100 px-4 py-10">
      <div className="w-full max-w-[420px]">
        <div className="mb-6 flex items-center justify-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-zinc-900">
            <Receipt className="h-6 w-6 text-white" />
          </span>
          <div>
            <p className="text-[18px] font-bold leading-tight text-zinc-900">KasirPro POS</p>
            <p className="text-[12px] text-zinc-500">Aplikasi Kasir — layout desktop</p>
          </div>
        </div>

        {error ? (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
            <p className="flex items-start gap-1.5 text-[12px] leading-snug text-red-700">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {error}
            </p>
          </div>
        ) : null}

        <LoginForm next={next} demoKey={DEMO_SERIAL} />

        <p className="mt-5 text-center text-[11px] text-zinc-400">
          Memasuki POS mewajibkan lisensi aktif dari <b>KasirPro Portal</b>. Data kasir aman dan
          khusus untuk toko pemegang lisensi.
        </p>
      </div>
    </main>
  );
}