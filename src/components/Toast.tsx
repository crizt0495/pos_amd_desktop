'use client';

import * as React from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

export type ToastTone = 'ok' | 'error' | 'info';

export interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  detail?: string;
}

interface ToastApi {
  ok: (title: string, detail?: string) => void;
  error: (title: string, detail?: string) => void;
  info: (title: string, detail?: string) => void;
}

const ToastContext = React.createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error('useToast harus dipakai di dalam <ToastProvider>');
  return ctx;
}

const TONE = {
  ok: { cls: 'border-emerald-200 bg-emerald-50 text-emerald-800', Icon: CheckCircle2 },
  error: { cls: 'border-red-200 bg-red-50 text-red-800', Icon: AlertTriangle },
  info: { cls: 'border-zinc-200 bg-white text-zinc-800', Icon: Info },
} as const;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const seq = React.useRef(0);

  const remove = React.useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = React.useCallback(
    (tone: ToastTone, title: string, detail?: string) => {
      seq.current += 1;
      const id = seq.current;
      setItems((prev) => [...prev, { id, tone, title, detail }]);
      window.setTimeout(() => remove(id), tone === 'error' ? 6500 : 3800);
    },
    [remove],
  );

  const api = React.useMemo<ToastApi>(
    () => ({
      ok: (t, d) => push('ok' as ToastTone, t, d),
      error: (t, d) => push('error' as ToastTone, t, d),
      info: (t, d) => push('info' as ToastTone, t, d),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}

      <div className="pointer-events-none fixed inset-x-0 top-3 z-[70] flex flex-col items-center gap-2 px-4">
        {items.map((t) => {
          const cfg = TONE[t.tone];
          const Icon = cfg.Icon;
          return (
            <div
              key={t.id}
              className={`pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-xl border px-3.5 py-2.5 shadow-lg animate-fade-in ${cfg.cls}`}
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-bold leading-tight">{t.title}</p>
                {t.detail ? <p className="mt-0.5 truncate text-[11.5px] opacity-80">{t.detail}</p> : null}
              </div>
              <button
                type="button"
                onClick={() => remove(t.id)}
                aria-label="Tutup notifikasi"
                className="shrink-0 rounded-md p-0.5 opacity-70 transition hover:opacity-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}