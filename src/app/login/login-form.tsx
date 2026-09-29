'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertCircle, KeyRound, Loader2, LogIn, Sparkles } from 'lucide-react';

import { useButtonGuard } from '@/lib/useButtonGuard';

function generateDeviceId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* abaikan */
  }
  return `DEV-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function readOrCreateDeviceId(): string {
  let id = '';
  try {
    id = localStorage.getItem('kpro_device_id') ?? '';
  } catch {
    /* abaikan */
  }
  if (!id) {
    id = generateDeviceId();
    try {
      localStorage.setItem('kpro_device_id', id);
    } catch {
      /* abaikan */
    }
  }
  return id;
}

/**
 * Form login POS: memasukkan SERIAL KEY (lisensi) dari KasirPro Portal.
 * Semua request memakai JSON; device id browser dikirim sebagai HWID supaya
 * 1 key = 1 perangkat (diaktifkan lewat RPC activate_license di sisi server).
 */
export function LoginForm({ next, demoKey }: { next: string; demoKey: string }) {
  const [serial, setSerial] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const guard = useButtonGuard(1500);
  const submitting = guard.busy;
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDeviceId(readOrCreateDeviceId());
  }, []);

  const serialBersih = serial.trim().toUpperCase();
  // Serial key minimal 3 karakter; tombol Masuk disabled sebelum itu.
  const serialValid = serialBersih.length >= 3;
  const serialPendek = serial.trim().length > 0 && !serialValid;

  async function doLogin(key: string) {
    if (!key) {
      setError('Serial Key wajib diisi.');
      return;
    }
    // `guard` menolak klik kedua selama cooldown 1,5 detik.
    void guard.guard(
      async () => {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            serial_key: key,
            device_id: deviceId || generateDeviceId(),
            device_name: (
              typeof navigator !== 'undefined' ? navigator.userAgent : 'Web Browser'
            ).slice(0, 120),
            app_version: '2.0.0',
            next,
          }),
        });
        const json = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
        if (res.ok && json.ok) {
          window.location.assign(next);
          return;
        }
        setError(json.message ?? 'Login gagal. Coba lagi.');
      },
      {
        cooldownMs: 1500,
        pesanTunggu: 'Lisensi sedang diperiksa…',
        // Gagal jaringan tidak boleh membuat form terkunci selamanya.
        onBlocked: (pesan) => setError(pesan),
        onError: () => setError('Tidak bisa menghubungi server. Periksa koneksi internet.'),
      },
    );
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) {
      setError('Mohon tunggu… lisensi sedang diperiksa.');
      return;
    }
    if (!serialValid) {
      setError('Serial Key minimal 3 karakter.');
      return;
    }
    void doLogin(serialBersih);
  }

  return (
    <>
      <div className="card overflow-hidden">
        <div className="border-b border-zinc-100 px-5 py-3">
          <p className="text-[13px] font-bold text-zinc-900">Masuk ke kasir</p>
        </div>

        <form className="space-y-3 px-5 py-4" onSubmit={onSubmit}>
          <div>
            <label className="label" htmlFor="serial_key">
              Serial Key / Lisensi
            </label>
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input
                ref={inputRef}
                id="serial_key"
                name="serial_key"
                className={`input h-10 pl-8 font-mono uppercase tracking-wide ${
                  serialPendek ? 'input-invalid' : ''
                }`}
                placeholder="KPRO-XXXX-XXXX-XXXX"
                value={serial}
                onChange={(e) => {
                  setSerial(e.target.value);
                  setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && submitting) {
                    e.preventDefault();
                    setError('Mohon tunggu… lisensi sedang diperiksa.');
                  }
                }}
                aria-invalid={serialPendek}
                required
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
              />
            </div>
            {serialPendek ? (
              <p className="field-error">
                <AlertCircle className="h-3 w-3" /> Serial Key minimal 3 karakter.
              </p>
            ) : (
              <p className="mt-1 text-[11px] text-zinc-400">
                Serial Key dibuat oleh toko Anda di <b>KasirPro Portal → Aktivasi</b>.
              </p>
            )}
          </div>

          {error ? (
            <p className="flex items-start gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-[12px] leading-snug text-red-700">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={!serialValid || submitting}
            data-loading={submitting}
            className="btn-primary h-10 w-full text-[14px]"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
            {submitting ? 'Memeriksa lisensi…' : 'Masuk'}
          </button>
        </form>
      </div>

      <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-4">
        <p className="flex items-center gap-1.5 text-[12px] font-bold text-zinc-800">
          <Sparkles className="h-3.5 w-3.5 text-zinc-400" /> Coba demo
        </p>
        <p className="mt-1 text-[12px] text-zinc-600">
          Serial Key demo: <b className="select-all font-mono text-zinc-900">{demoKey}</b>
        </p>
        <p className="text-[11px] text-zinc-400">Key demo tidak terkunci perangkat.</p>
        <button
          type="button"
          disabled={submitting}
          data-loading={submitting}
          onClick={() => void doLogin(demoKey)}
          className="btn-outline mt-2 h-8 w-full text-[12px]"
        >
          {submitting ? 'Memeriksa lisensi…' : 'Login dengan demo'}
        </button>
      </div>
    </>
  );
}