'use client';

import * as React from 'react';
import { Truck, X } from 'lucide-react';

import { productsApi, purchasesApi } from '@/lib/api';
import { angka, rupiah } from '@/lib/format';
import type { Product } from '@/lib/types';

interface BarisPembelian {
  productId: string;
  name: string;
  unit: string;
  qty: number;
  cost: number;
}

/**
 * Pembelian (PO sederhana) — persis seperti kembaran Kasir:
 *   - Input "Cari Produk" dengan live search (tanpa dropdown), fokus kembali
 *     setelah tiap pilih agar siap scan berikutnya
 *   - Tabel editable: Nama | Satuan | H.Pokok | Qty | Subtotal | Hapus
 *   - Total besar di kanan bawah, tidak ada "total kecil" di dekat Shift
 */
export default function PembelianScreen() {
  const [products, setProducts] = React.useState<Product[]>([]);
  const [supplierName, setSupplierName] = React.useState('');
  const [note, setNote] = React.useState('');
  const [baris, setBaris] = React.useState<BarisPembelian[]>([]);
  const [pesan, setPesan] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  // search state
  const [kode, setKode] = React.useState('');
  const [saran, setSaran] = React.useState<Product[]>([]);
  const [saranTampil, setSaranTampil] = React.useState(false);
  const [saranIdx, setSaranIdx] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const wrapRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    void productsApi.list().then((r) => {
      if (r.ok) setProducts(r.data);
    });
  }, []);

  React.useEffect(() => {
    const q = kode.trim().toLowerCase();
    if (!q) {
      setSaran([]);
      setSaranTampil(false);
      return;
    }
    const d = products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.barcode ?? '').toLowerCase().includes(q) ||
        (p.category ?? '').toLowerCase().includes(q),
    );
    setSaran(d.slice(0, 8));
    setSaranTampil(d.length > 0);
    setSaranIdx(0);
  }, [kode, products]);

  React.useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setSaranTampil(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  function tambah(p: Product) {
    setBaris((prev) => {
      const i = prev.findIndex((b) => b.productId === p.id);
      if (i >= 0) {
        return prev.map((b, j) => (j === i ? { ...b, qty: b.qty + 1 } : b));
      }
      return [
        ...prev,
        { productId: p.id, name: p.name, unit: p.unit, qty: 1, cost: p.cost },
      ];
    });
    setKode('');
    setSaranTampil(false);
    setSaranIdx(0);
    inputRef.current?.focus();
  }

  function ubah(idx: number, patch: Partial<BarisPembelian>) {
    setBaris((prev) => prev.map((b, i) => (i === idx ? { ...b, ...patch } : b)));
  }

  const total = baris.reduce((s, b) => s + b.qty * b.cost, 0);

  async function simpan() {
    setPesan(null);
    if (!supplierName.trim()) {
      setPesan('Nama supplier wajib diisi.');
      return;
    }
    if (!baris.length) {
      setPesan('Pilih produk dulu lewat pencarian.');
      return;
    }
    setBusy(true);
    const r = await purchasesApi.create({
      supplierName: supplierName.trim(),
      items: baris.map((b) => ({
        productId: b.productId,
        name: b.name,
        qty: b.qty,
        cost: b.cost,
      })),
      note,
    });
    setBusy(false);
    if (!r.ok) {
      setPesan(r.error);
      return;
    }
    setPesan(`Pembelian disimpan — total ${rupiah(r.data.total)}. Stok sudah ditambah.`);
    setBaris([]);
    setSupplierName('');
    setNote('');
    setKode('');
    inputRef.current?.focus();
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {/* Header ala Kasir */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#d8e0ec] bg-[#f6f9fd] px-3 py-2">
        <Truck className="h-4 w-4 text-[#1b5fa8]" />
        <h1 className="text-[15px] font-bold text-[#1b3a5c]">Pembelian (PO Sederhana)</h1>

        <span className="ml-auto flex items-center gap-2 text-[11.5px] text-[#7a8ba0]">
          <b className="tnum text-[#35485c]">{baris.length}</b> baris · total{' '}
          <b className="tnum text-[#35485c]">{rupiah(total)}</b>
        </span>
        <button
          type="button"
          disabled={busy || !baris.length || !supplierName.trim()}
          onClick={simpan}
          className="rb-btn-go"
        >
          {busy ? 'Menyimpan…' : 'Simpan PO'}
        </button>
      </div>

      {/* Blok search ala Kasir */}
      <div className="shrink-0 border-b border-[#d8e0ec] bg-[#f6f9fd] px-3 py-2.5">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[220px] flex-1">
            <label className="frm-label" htmlFor="cari-supplier">
              Nama Supplier
            </label>
            <input
              id="cari-supplier"
              className="frm-key"
              placeholder="Ketik nama supplier"
              value={supplierName}
              onChange={(e) => setSupplierName(e.target.value)}
              autoComplete="off"
            />
          </div>

          <div className="relative w-full sm:w-[300px] lg:w-[340px]" ref={wrapRef}>
            <label className="frm-label" htmlFor="cari-produk">
              Cari Produk (Ketik Nama / Barcode)
            </label>
            <input
              id="cari-produk"
              ref={inputRef}
              className="frm-key"
              placeholder="Scan barcode atau ketik nama barang"
              value={kode}
              onChange={(e) => setKode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setSaranIdx((i) => Math.min(i + 1, saran.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setSaranIdx((i) => Math.max(i - 1, 0));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  if (saran[saranIdx]) tambah(saran[saranIdx]!);
                } else if (e.key === 'Escape') {
                  setSaranTampil(false);
                }
              }}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              role="combobox"
              aria-expanded={saranTampil}
              aria-autocomplete="list"
              aria-controls="saran-pembelian"
            />

            {saranTampil ? (
              <ul id="saran-pembelian" role="listbox" className="ac-panel">
                {saran.map((p, i) => (
                  <li key={p.id} role="option" aria-selected={i === saranIdx}>
                    <button
                      type="button"
                      className={`ac-item ${i === saranIdx ? 'ac-item-active' : ''}`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        tambah(p);
                      }}
                      onMouseEnter={() => setSaranIdx(i)}
                    >
                      <span className="ac-kode">{p.barcode || '—'}</span>
                      <span className="ac-nama">{p.name}</span>
                      <span className="ac-meta">Stok {angka(p.stock)}</span>
                      <span className="ac-meta">{rupiah(p.cost)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="min-w-[120px]">
            <label className="frm-label" htmlFor="catatan">
              Catatan
            </label>
            <input
              id="catatan"
              className="frm-key"
              placeholder="Faktur No."
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Tabel ala Kasir */}
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-zinc-500">
              <th className="w-8 px-2 py-2">No</th>
              <th className="px-2 py-2">Nama Item</th>
              <th className="px-2 py-2">Satuan</th>
              <th className="w-28 px-2 py-2">H. Pokok</th>
              <th className="w-20 px-2 py-2">Qty</th>
              <th className="w-28 px-2 py-2">Subtotal</th>
              <th className="w-10 px-2 py-2">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {baris.map((b, i) => (
              <tr key={b.productId + i} className="border-t border-zinc-100">
                <td className="px-2 py-2 text-zinc-400">{i + 1}</td>
                <td className="px-2 py-2 font-medium">{b.name}</td>
                <td className="px-2 py-2 text-zinc-600">{b.unit}</td>
                <td className="px-2 py-2">
                  <input
                    type="number"
                    min={0}
                    value={b.cost}
                    onChange={(e) => ubah(i, { cost: Number(e.target.value) || 0 })}
                    className="w-full rounded-lg border border-zinc-200 px-2 py-1"
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    type="number"
                    min={1}
                    value={b.qty}
                    onChange={(e) => ubah(i, { qty: Number(e.target.value) || 0 })}
                    className="w-full rounded-lg border border-zinc-200 px-2 py-1"
                  />
                </td>
                <td className="px-2 py-2 text-right font-semibold">
                  {rupiah(b.qty * b.cost)}
                </td>
                <td className="px-2 py-2">
                  <button
                    type="button"
                    className="p-1 text-zinc-400 hover:text-red-600"
                    aria-label="Hapus"
                    onClick={() => setBaris((prev) => prev.filter((_, j) => j !== i))}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
            {!baris.length ? (
              <tr>
                <td colSpan={7} className="px-2 py-6 text-center text-[12px] text-zinc-400">
                  Cari produk di atas untuk menambahkan ke pembelian.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* Total besar ala Kasir */}
      <div className="flex shrink-0 justify-end border-t border-[#d8e0ec] bg-white px-4 py-3">
        <div className="text-right">
          <p className="text-[11px] uppercase text-zinc-400">Total Pembelian</p>
          <p className="text-[26px] font-extrabold text-[#1b3a5c]">{rupiah(total)}</p>
        </div>
      </div>

      {pesan ? <p className="shrink-0 bg-zinc-100 p-3 text-sm">{pesan}</p> : null}
    </div>
  );
}
