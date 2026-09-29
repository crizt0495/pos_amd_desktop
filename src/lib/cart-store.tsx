'use client';

import * as React from 'react';

import type { CartLine } from './types';

/**
 * Store keranjang kasir.
 *
 * Dipasang di `app/(app)/layout.tsx` sehingga tidak pernah unmount saat user
 * berpindah modul di ribbon (Master Data <-> Penjualan <-> Laporan) — keranjang
 * tidak ikut ter-reset. State juga dicerminkan ke localStorage agar tetap ada
 * setelah reload atau tab ditutup.
 */

const STORAGE_KEY = 'kasirpro.cart.v1';

export interface CartState {
  lines: CartLine[];
  /** Jumlah item di form header saat baris terakhir ditambahkan. */
  itemQty: number;
  customer: string;
  sales: string;
  keterangan: string;
}

const KOSONG: CartState = {
  lines: [],
  itemQty: 1,
  customer: 'Umum',
  sales: '',
  keterangan: '',
};

interface CartContextValue extends CartState {
  setLines: React.Dispatch<React.SetStateAction<CartLine[]>>;
  setItemQty: React.Dispatch<React.SetStateAction<number>>;
  setCustomer: (v: string) => void;
  setSales: (v: string) => void;
  setKeterangan: (v: string) => void;
  /** Kosongkan keranjang (transaksi selesai / dibatalkan / F9). */
  resetCart: () => void;
}

const CartContext = React.createContext<CartContextValue | null>(null);

/** Hanya simpan field yang serializable & relevan. */
function bacaStorage(): CartState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CartState>;
    if (!Array.isArray(parsed.lines)) return null;
    return {
      lines: parsed.lines as CartLine[],
      itemQty: typeof parsed.itemQty === 'number' && parsed.itemQty >= 1 ? parsed.itemQty : 1,
      customer: typeof parsed.customer === 'string' && parsed.customer ? parsed.customer : 'Umum',
      sales: typeof parsed.sales === 'string' ? parsed.sales : '',
      keterangan: typeof parsed.keterangan === 'string' ? parsed.keterangan : '',
    };
  } catch {
    return null;
  }
}

function tulisStorage(state: CartState) {
  if (typeof window === 'undefined') return;
  try {
    // Keranjang kosong tidak perlu disimpan.
    if (!state.lines.length && !state.keterangan && !state.sales) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage penuh / diblokir (mode privat) */
  }
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  // Lazy init: baca localStorage sekali di mount supaya tidak ada hydration mismatch.
  const [state, setState] = React.useState<CartState>(KOSONG);

  React.useEffect(() => {
    const saved = bacaStorage();
    if (saved) setState(saved);
  }, []);

  // Cermin ke localStorage setiap perubahan.
  React.useEffect(() => {
    tulisStorage(state);
  }, [state]);

  // Sinkronkan antar tab: transaksi di tab lain langsung terlihat di sini.
  React.useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      const next = bacaStorage();
      if (next) setState(next);
      else setState((prev) => ({ ...prev, lines: [] }));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  /* Aksi selalu identity-stabil supaya tidak ikut memicu re-render/efek
     di pemanggil (mis. listener hotkey kasir). */
  const actions = React.useMemo(
    () => ({
      setLines: (updater: React.SetStateAction<CartLine[]>) =>
        setState((prev) => ({
          ...prev,
          lines: typeof updater === 'function' ? updater(prev.lines) : updater,
        })),
      setItemQty: (updater: React.SetStateAction<number>) =>
        setState((prev) => ({
          ...prev,
          itemQty: typeof updater === 'function' ? updater(prev.itemQty) : updater,
        })),
      setCustomer: (v: string) => setState((prev) => ({ ...prev, customer: v })),
      setSales: (v: string) => setState((prev) => ({ ...prev, sales: v })),
      setKeterangan: (v: string) => setState((prev) => ({ ...prev, keterangan: v })),
      resetCart: () =>
        setState((prev) => ({ ...prev, lines: [], itemQty: 1, keterangan: '', sales: '' })),
    }),
    [],
  );

  const value = React.useMemo<CartContextValue>(
    () => ({
      ...state,
      ...actions,
    }),
    [state, actions],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = React.useContext(CartContext);
  if (!ctx) throw new Error('useCart harus dipakai di dalam <CartProvider>.');
  return ctx;
}
