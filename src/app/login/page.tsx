import type { Metadata } from 'next';
import { AlertCircle, LogIn, Receipt, Sparkles, User } from 'lucide-react';

import { DemoFill } from './demo-fill';

export const metadata: Metadata = { title: 'Masuk — KasirPro POS' };

/** Informasi akun demo yang selalu ditampilkan di halaman login. */
const DEMO = { username: 'demo', password: 'toko12345' };

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

        <div className="card overflow-hidden">
          <div className="border-b border-zinc-100 px-5 py-3">
            <p className="text-[13px] font-bold text-zinc-900">Masuk ke kasir</p>
          </div>

          <form className="space-y-3 px-5 py-4" method="post" action="/api/auth/login">
            <input type="hidden" name="next" value={next} />

            <div>
              <label className="label" htmlFor="username">
                Username atau Email
              </label>
              <div className="relative">
                <User className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <input
                  id="username"
                  name="username"
                  className="input h-10 pl-8"
                  placeholder="demo"
                  required
                  autoComplete="username"
                />
              </div>
            </div>

            <div>
              <label className="label" htmlFor="password">
                Kata Sandi
              </label>
              <input
                id="password"
                name="password"
                type="password"
                className="input h-10"
                placeholder="••••••••"
                required
                autoComplete="current-password"
              />
            </div>

            {error ? (
              <p className="flex items-start gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-[12px] leading-snug text-red-700">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {error}
              </p>
            ) : null}

            <button type="submit" className="btn-primary h-10 w-full text-[14px]">
              <LogIn className="h-4 w-4" /> Masuk
            </button>
          </form>
        </div>

        <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-4">
          <p className="flex items-center gap-1.5 text-[12px] font-bold text-zinc-800">
            <Sparkles className="h-3.5 w-3.5 text-zinc-400" /> Akun demo
          </p>
          <div className="mt-1.5 space-y-0.5 text-[12px] text-zinc-600">
            <p>
              Username: <b className="text-zinc-900">{DEMO.username}</b>
            </p>
            <p>
              Password: <b className="text-zinc-900">{DEMO.password}</b>
            </p>
          </div>
          <p className="mt-2 text-center text-[11px] text-zinc-400">
            Akun sama dengan <b>KasirPro Portal</b> — data kasir milik toko Anda.
          </p>
          <div className="mt-2">
            <DemoFill username={DEMO.username} password={DEMO.password} />
          </div>
        </div>
      </div>
    </main>
  );
}