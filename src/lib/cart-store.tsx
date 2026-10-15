'use client';

import * as React from 'react';

import { draftDel, draftGet, draftSet } from './localStore';
import type { CartLine } from './types';

/**
 * Store keranjang kasir.
 *
 * Dipasang di `app/(app)/layout.tsx` sehingga tidak pernah unmount saat user
 * berpindah modul di ribbon (Master Data <-> Penjualan <-> Laporan) — keranjang
 * tidak ikut ter-reset. State juga dicerminkan ke database lokal (tabel
 * `local_kv` di file SQLite `kasir.db`) agar tetap ada setelah reload atau
 * aplikasi ditutup — BUKAN ke localStorage.
 */

const STORAGE_KEY = 'cart';

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

/** Validasi & normalisasi nilai yang dibaca dari penyimpanan draft. */
function rapikanCart(parsed: Partial<CartState> | null): CartState | null {
  if (!parsed || !Array.isArray(parsed.lines)) return null;
  return {
    lines: parsed.lines as CartLine[],
    itemQty: typeof parsed.itemQty === 'number' && parsed.itemQty >= 1 ? parsed.itemQty : 1,
    customer: typeof parsed.customer === 'string' && parsed.customer ? parsed.customer : 'Umum',
    sales: typeof parsed.sales === 'string' ? parsed.sales : '',
    keterangan: typeof parsed.keterangan === 'string' ? parsed.keterangan : '',
  };
}

async function bacaDraft(): Promise<CartState | null> {
  return rapikanCart(await draftGet<Partial<CartState>>(STORAGE_KEY));
}

function tulisDraft(state: CartState) {
  // Keranjang kosong tidak perlu disimpan.
  if (!state.lines.length && !state.keterangan && !state.sales) {
    draftDel(STORAGE_KEY);
    return;
  }
  draftSet(STORAGE_KEY, state);
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<CartState>(KOSONG);
  // Cegah menimpa draft tersimpan dengan state kosong sebelum draft dibaca.
  const siap = React.useRef(false);

  // Muat draft tersimpan (dari SQLite) sekali di mount.
  React.useEffect(() => {
    let batal = false;
    void bacaDraft().then((saved) => {
      if (batal) return;
      if (saved) setState(saved);
      siap.current = true;
    });
    return () => {
      batal = true;
    };
  }, []);

  // Cermin ke database lokal setiap perubahan (setelah draft awal dimuat).
  React.useEffect(() => {
    if (!siap.current) return;
    tulisDraft(state);
  }, [state]);

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
