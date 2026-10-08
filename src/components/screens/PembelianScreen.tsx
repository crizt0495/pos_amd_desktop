'use client';

import * as React from 'react';
import { Plus, Trash2, Truck } from 'lucide-react';

import { productsApi, purchasesApi } from '@/lib/api';
import { rupiah } from '@/lib/format';
import type { Product } from '@/lib/types';

interface BarisPembelian {
  productId: string;
  qty: string;
  cost: string;
}

/**
 * Modul Pembelian sederhana (IPOS 5 ekuivalen): list produk yang dipilih,
 * dicatat sebagai pembelian + tambah stok otomatis (RPC
 * kasir_create_purchase). Supplier sederhana: satu nama per pembelian.
 */
export default function PembelianScreen() {
  const [products, setProducts] = React.useState<Product[]>([]);
  const [supplierName, setSupplierName] = React.useState('');
  const [note, setNote] = React.useState('');
  const [baris, setBaris] = React.useState<BarisPembelian[]>([
    { productId: '', qty: '1', cost: '0' },
  ]);
  const [pesan, setPesan] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    void productsApi.list().then((r) => {
      if (r.ok) setProducts(r.data);
    });
  }, []);

  const total = baris.reduce((s, b) => s + Number(b.qty || 0) * Number(b.cost || 0), 0);

  function ubah(idx: number, patch: Partial<BarisPembelian>) {
    setBaris((prev) => prev.map((b, i) => (i === idx ? { ...b, ...patch } : b)));
  }

  async function simpan() {
    setPesan(null);
    if (!supplierName.trim()) {
      setPesan('Nama supplier wajib diisi.');
      return;
    }
    const items = baris
      .filter((b) => b.productId && Number(b.qty) > 0)
      .map((b) => {
        const p = products.find((x) => x.id === b.productId)!;
        return { productId: b.productId, name: p.name, qty: Number(b.qty), cost: Number(b.cost) || 0 };
      });
    if (!items.length) {
      setPesan('Minimal satu item dengan qty > 0.');
      return;
    }
    setBusy(true);
    const r = await purchasesApi.create({ supplierName: supplierName.trim(), items, note });
    setBusy(false);
    if (!r.ok) {
      setPesan(r.error);
      return;
    }
    setPesan(`Pembelian disimpan — total ${rupiah(r.data.total)}. Stok sudah ditambah.`);
    setBaris([{ productId: '', qty: '1', cost: '0' }]);
    setSupplierName('');
    setNote('');
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <h1 className="flex items-center gap-2 text-xl font-bold">
        <Truck className="h-5 w-5" /> Pembelian (PO Sederhana)
      </h1>

      <label className="block space-y-1">
        <span className="text-[12px] font-semibold text-zinc-600">Nama Supplier</span>
        <input
          className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm"
          value={supplierName}
          onChange={(e) => setSupplierName(e.target.value)}
          placeholder="PT Sumber Jaya"
        />
      </label>

      <div className="space-y-2">
        {baris.map((b, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <select
              className="min-w-[180px] flex-1 rounded-xl border border-zinc-200 px-2 py-2 text-sm"
              value={b.productId}
              onChange={(e) => ubah(i, { productId: e.target.value })}
            >
              <option value="">— Pilih Produk —</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} (stok {p.stock})
                </option>
              ))}
            </select>
            <input
              type="number"
              min={1}
              className="w-20 rounded-xl border border-zinc-200 px-2 py-2 text-sm"
              placeholder="Qty"
              value={b.qty}
              onChange={(e) => ubah(i, { qty: e.target.value })}
            />
            <input
              type="number"
              min={0}
              className="w-28 rounded-xl border border-zinc-200 px-2 py-2 text-sm"
              placeholder="Harga Beli"
              value={b.cost}
              onChange={(e) => ubah(i, { cost: e.target.value })}
            />
            <button
              type="button"
              className="p-2 text-zinc-400 hover:text-red-600"
              onClick={() => setBaris((prev) => prev.filter((_, j) => j !== i))}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-xl border border-dashed border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-600"
          onClick={() => setBaris((prev) => [...prev, { productId: '', qty: '1', cost: '0' }])}
        >
          <Plus className="h-4 w-4" /> Tambah Baris
        </button>
      </div>

      <label className="block space-y-1">
        <span className="text-[12px] font-semibold text-zinc-600">Catatan</span>
        <input
          className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Faktur No. …"
        />
      </label>

      <div className="flex items-center justify-between">
        <span className="text-lg font-bold">Total: {rupiah(total)}</span>
        <button
          type="button"
          disabled={busy}
          onClick={simpan}
          className="rounded-xl bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          Simpan Pembelian
        </button>
      </div>

      {pesan ? <p className="rounded-xl bg-zinc-100 p-3 text-sm">{pesan}</p> : null}
    </div>
  );
}
