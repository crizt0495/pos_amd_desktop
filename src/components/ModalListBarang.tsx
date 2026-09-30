'use client';

import * as React from 'react';
import { PackageSearch } from 'lucide-react';

import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { angka, rupiah } from '@/lib/format';
import type { Product } from '@/lib/types';

/**
 * Modal List Barang (F10) — daftar semua produk untuk dipilih cepat.
 *
 * Memilih baris **tidak** menutup modal: kasir bisa menambah beberapa item
 * beruntun (klik → ketik → klik → ketik) baru menekan "Selesai". Setiap
 * penambahan memberi feedback berupa toast, baris yang ter-highlight hijau
 * sesaat, dan angka stok di tabel yang langsung turun (optimistic).
 *
 * Modal hanya menutup lewat: tombol X, tombol "Selesai", Escape, klik backdrop,
 * atau tekan F10 lagi.
 */
export function ModalListBarang({
  open,
  onClose,
  products,
  onPilih,
  jumlahItem,
  totalKeranjang,
}: {
  open: boolean;
  onClose: () => void;
  products: Product[];
  onPilih: (p: Product) => void;
  /** Jumlah baris di keranjang (untuk rekap di footer). */
  jumlahItem?: number;
  /** Total keranjang saat ini (untuk rekap di footer). */
  totalKeranjang?: number;
}) {
  const toast = useToast();
  const [q, setQ] = React.useState('');
  const [cursor, setCursor] = React.useState(0);
  const searchRef = React.useRef<HTMLInputElement>(null);
  // Kunci klik per produk (waktu terakhir dipilih) — mencegah klik-ganda pada
  // baris yang sama tanpa menahan kasir saat memilih beberapa barang berbeda.
  const lockRef = React.useRef<Record<string, number>>({});
  // Baris yang baru saja ditambahkan (disorot hijau sebentar).
  const [sorot, setSorot] = React.useState<string | null>(null);
  const sorotTimerRef = React.useRef<number | null>(null);
  // Stok yang sudah terpakai selama modal ini terbuka, per produk (optimistic).
  const [terpakai, setTerpakai] = React.useState<Record<string, number>>({});

  React.useEffect(
    () => () => {
      if (sorotTimerRef.current !== null) window.clearTimeout(sorotTimerRef.current);
    },
    [],
  );

  React.useEffect(() => {
    if (open) {
      setQ('');
      setCursor(0);
      setSorot(null);
      setTerpakai({});
      // Beri jeda supaya modal selesai mount sebelum fokus.
      const t = window.setTimeout(() => searchRef.current?.focus(), 30);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  const hasil = React.useMemo(() => {
    const key = q.trim().toLowerCase();
    const base = products.filter((p) => p.is_active !== false);
    if (!key) return base.slice(0, 200);
    return base
      .filter(
        (p) =>
          p.name.toLowerCase().includes(key) ||
          (p.barcode ?? '').toLowerCase().includes(key) ||
          p.category.toLowerCase().includes(key),
      )
      .slice(0, 200);
  }, [products, q]);

  // Jaga cursor tetap di dalam hasil.
  React.useEffect(() => {
    if (cursor >= hasil.length) setCursor(0);
  }, [hasil.length, cursor]);

  function pilih(p: Product) {
    // Kunci singkat 500 ms per barang: mencegah klik-ganda/double-click menambah
    // item dua kali, tapi kasir tetap bisa memilih barang berbeda tanpa jeda.
    const sekarang = Date.now();
    if (sekarang - (lockRef.current[p.id] ?? 0) < 500) return;
    lockRef.current[p.id] = sekarang;

    onPilih(p);

    // Stok di tabel modal langsung turun supaya efeknya kelihatan (optimistic).
    const dipakai = (terpakai[p.id] ?? 0) + 1;
    setTerpakai((prev) => ({ ...prev, [p.id]: dipakai }));

    // Baris yang baru ditambahkan disorot hijau sebentar.
    setSorot(p.id);
    if (sorotTimerRef.current !== null) window.clearTimeout(sorotTimerRef.current);
    sorotTimerRef.current = window.setTimeout(() => setSorot(null), 1000);

    const sisa = Math.max(0, p.stock - dipakai);
    toast.ok(`${p.name} ditambahkan`, `Sisa stok ${angka(sisa)} ${p.unit}`);

    // Modal tetap terbuka & fokus balik ke pencarian supaya bisa langsung ketik
    // barang berikutnya.
    searchRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, hasil.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const p = hasil[cursor];
      if (p) pilih(p);
    }
  }

  return (
    <Modal
      open={open}
      title="List Barang"
      onClose={onClose}
      width="max-w-3xl"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <p className="text-[11.5px] text-[#5b6b80]">
            Klik item untuk tambah ke keranjang, bisa pilih banyak.
            {typeof jumlahItem === 'number' ? (
              <>
                {' '}
                Keranjang: <b className="tnum">{jumlahItem}</b> item
                {typeof totalKeranjang === 'number' ? (
                  <>
                    {' · '}
                    <b className="tnum">{rupiah(totalKeranjang)}</b>
                  </>
                ) : null}
              </>
            ) : null}
          </p>
          <button type="button" className="btn-primary" onClick={onClose}>
            Selesai
            <span className="kbd">Esc</span>
          </button>
        </div>
      }
    >
      <div className="space-y-2.5">
        <div className="flex items-center gap-2">
          <PackageSearch className="h-4 w-4 shrink-0 text-[#7a8ba0]" />
          <input
            ref={searchRef}
            className="frm-key"
            placeholder="Cari nama, barcode, atau kategori…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setCursor(0);
            }}
            onKeyDown={onKeyDown}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div className="max-h-[52vh] overflow-auto rounded border border-[#d8e0ec]">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="th w-[40px] text-center">No</th>
                <th className="th w-[130px]">Kode</th>
                <th className="th">Nama Barang</th>
                <th className="th w-[86px] text-right">Stok</th>
                <th className="th w-[112px] text-right">Harga</th>
              </tr>
            </thead>
            <tbody>
              {hasil.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-10 text-center text-[12.5px] text-[#9fb0c4]">
                    {products.length === 0
                      ? 'Master barang masih kosong. Tambah produk di menu Master Data.'
                      : `Barang "${q}" tidak ditemukan.`}
                  </td>
                </tr>
              ) : null}

              {hasil.map((p, i) => {
                const baru = sorot === p.id;
                return (
                  <tr
                    key={p.id}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pilih(p);
                    }}
                    onMouseEnter={() => setCursor(i)}
                    className={`cursor-pointer border-b border-[#eef2f7] ${
                      baru ? 'bg-[#ebfbee]' : cursor === i ? 'cell-row-active' : 'bg-white'
                    }`}
                  >
                    <td className="td tnum text-center text-[#9fb0c4]">{i + 1}</td>
                    <td className="td font-mono text-[11.5px] text-[#7a8ba0]">{p.barcode || '—'}</td>
                    <td className="td">
                      <span className="font-semibold text-[#22374b]">{p.name}</span>
                      <span className="ml-1.5 text-[11px] text-[#9fb0c4]">{p.category}</span>
                    </td>
                    <td className="td tnum text-right text-[#35485c]">
                      {angka(Math.max(0, p.stock - (terpakai[p.id] ?? 0)))}
                    </td>
                    <td className="td tnum text-right font-semibold text-[#1b3a5c]">{rupiah(p.price)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="text-[11.5px] text-[#7a8ba0]">
          Klik baris atau tekan <span className="kbd">Enter</span> untuk masukkan ke keranjang ·{' '}
          <span className="kbd">↑</span> <span className="kbd">↓</span> pindah baris ·{' '}
          <span className="kbd">Esc</span> tutup
        </p>
      </div>
    </Modal>
  );
}
