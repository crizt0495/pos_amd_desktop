'use client';

import * as React from 'react';

/**
 * Penjaga tombol global: mencegah klik ganda mengirim request/API berulang.
 *
 * Aturan:
 * 1. Selama `busy` = true, klik berikutnya diabaikan (dan `onBlocked` dipanggil
 *    supaya pemanggil bisa memunculkan toast "Mohon tunggu…").
 * 2. Setelah aksi selesai — sukses maupun gagal — tombol tetap dikunci selama
 *    `cooldown` ms (default 1500) agar user tak bisa sengaja klik lagi buru-buru.
 * 3. Kunci selalu dilepas di `finally`, jadi error tidak menyebabkan tombol
 *    macet selamanya. Error juga diteruskan ke `onError` bila ada.
 *
 * Pemakaian:
 * ```tsx
 * const { busy, guard } = useButtonGuard();
 * <button disabled={busy} data-loading={busy} onClick={() => {
 *   if (busy) return toast.info('Mohon tunggu…');
 *   void guard(simpan, { onBlocked: () => toast.info('Mohon tunggu…') });
 * }}>
 *   {busy ? <><Spinner />Memproses…</> : 'Simpan'}
 * </button>
 * ```
 *
 * `guard` mengembalikan `true` bila aksi benar-benar dijalankan dan `false`
 * bila ditolak karena sedang terkunci.
 */
export function useButtonGuard(cooldown = 1500) {
  const [busy, setBusy] = React.useState(false);
  const lockRef = React.useRef(false);
  const timerRef = React.useRef<number | null>(null);
  const aliveRef = React.useRef(true);

  React.useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  const guard = React.useCallback(
    async <T,>(
      aksi: () => T | Promise<T>,
      opts?: {
        /** Pesan singkat yang ditampilkan While busy (untuk toast). */
        pesanTunggu?: string;
        /** Dipanggil saat aksi ditolak karena sedang terkunci. */
        onBlocked?: (pesan: string) => void;
        /** Dipanggil kalau aksi melempar error. */
        onError?: (e: unknown) => void;
        /** Lama kunci setelah aksi selesai (ms). Default = `cooldown`. */
        cooldownMs?: number;
      },
    ): Promise<boolean> => {
      if (lockRef.current) {
        opts?.onBlocked?.(opts.pesanTunggu ?? 'Mohon tunggu… aksi sebelumnya sedang diproses.');
        return false;
      }
      lockRef.current = true;
      setBusy(true);
      try {
        await aksi();
        return true;
      } catch (e) {
        opts?.onError?.(e);
        return false;
      } finally {
        const ms = opts?.cooldownMs ?? cooldown;
        timerRef.current = window.setTimeout(() => {
          lockRef.current = false;
          if (aliveRef.current) setBusy(false);
        }, ms);
      }
    },
    [cooldown],
  );

  /** Lepas kunci seketika (mis. setelah sukses lalu form ditutup). */
  const reset = React.useCallback(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    lockRef.current = false;
    if (aliveRef.current) setBusy(false);
  }, []);

  return { busy, guard, reset };
}

/**
 * Kunci klik tanpa status visual — untuk tombol yang aksinya lokal (buka/tutup
 * modal, hapus baris keranjang, ganti metode bayar). Tetap tidak bisa diklik
 * dua kali dalam 1,5 detik, tapi tidak menampilkan spinner.
 *
 * Kunci bersifat **per tombol** lewat `key`, jadi klik "Tambah Barang" lalu
 * "Tambah Kategori" dalam 1 detik tetap keduanya bekerja — yang terkunci hanya
 * klik kedua pada tombol yang sama.
 *
 * ```tsx
 * const ui = useClickCooldown();
 * <button disabled={ui.locked('buka-modal')} onClick={() => ui.run(() => setOpen(true), 'buka-modal')}>
 *   Tambah Barang
 * </button>
 * ```
 */
export function useClickCooldown(delayMs = 1500) {
  const [tick, setTick] = React.useState(0);
  /** key -> timestamp (ms) kapan kunci lepas. */
  const locks = React.useRef(new Map<string, number>());
  const aliveRef = React.useRef(true);
  const timerRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  /** Sisa waktu kunci untuk `key` (ms); 0 = bebas diklik. */
  const remaining = React.useCallback(
    (key: string) => Math.max(0, (locks.current.get(key) ?? 0) - Date.now()),
    [],
  );

  const locked = React.useCallback((key: string) => remaining(key) > 0, [remaining]);

  /** Jadwalkan re-render ulang tepat saat kunci yang paling awal lepas. */
  const scheduleTick = React.useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    let soonest = Infinity;
    for (const expiry of locks.current.values()) {
      if (expiry > Date.now() && expiry < soonest) soonest = expiry;
    }
    if (!Number.isFinite(soonest)) return;
    timerRef.current = window.setTimeout(() => {
      if (aliveRef.current) setTick((t) => t + 1);
      scheduleTick();
    }, Math.max(0, soonest - Date.now()) + 20);
  }, []);

  const run = React.useCallback(
    (aksi: () => void, key = 'default'): boolean => {
      if (remaining(key) > 0) return false;
      locks.current.set(key, Date.now() + delayMs);
      aksi();
      // `aksi` boleh menutup modal / memuat ulang daftar; tick dulu supaya
      // `disabled` tombol ikut ter-update di render yang sama.
      if (aliveRef.current) setTick((t) => t + 1);
      scheduleTick();
      return true;
    },
    [delayMs, remaining, scheduleTick],
  );

  // `tick` sengaja dibaca supaya komponen ikut re-render saat kunci berubah.
  void tick;

  return { locked, run };
}
