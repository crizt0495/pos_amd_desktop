'use client';

import * as React from 'react';
import {
  AlertTriangle,
  Boxes,
  Minus,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';

import { productsApi } from '@/lib/api';
import { rupiah } from '@/lib/format';
import { useToast } from '@/components/Toast';
import { Modal } from '@/components/Modal';
import type { Product, ProductInput } from '@/lib/types';

type FormState = {
  barcode: string;
  name: string;
  category: string;
  price: string;
  cost: string;
  stock: string;
  min_stock: string;
  unit: string;
};

const EMPTY: FormState = {
  barcode: '',
  name: '',
  category: 'Umum',
  price: '',
  cost: '',
  stock: '',
  min_stock: '',
  unit: 'pcs',
};

const UNITS = ['pcs', 'box', 'btl', 'kg', 'gram', 'lusin', 'pak', 'sachet'];

export default function ProdukScreen() {
  const toast = useToast();

  const [products, setProducts] = React.useState<Product[]>([]);
  const [search, setSearch] = React.useState('');
  const [showInactive, setShowInactive] = React.useState(false);
  const [loading, setLoading] = React.useState(true);

  const [editing, setEditing] = React.useState<Product | null>(null);
  const [form, setForm] = React.useState<FormState>(EMPTY);
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [removing, setRemoving] = React.useState<Product | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(
    async (q = '', includeInactive = false) => {
      const res = await productsApi.list(q, includeInactive);
      if (res.ok) setProducts(res.data);
      else toast.error('Gagal memuat produk', res.error);
      return res;
    },
    [toast],
  );

  React.useEffect(() => {
    void (async () => {
      setLoading(true);
      await load('', showInactive);
      setLoading(false);
    })();
  }, [load, showInactive]);

  /* ------------------------------ form CRUD ---------------------------- */
  function openTambah() {
    setEditing(null);
    setForm(EMPTY);
    setOpen(true);
  }

  function openEdit(p: Product) {
    setEditing(p);
    setForm({
      barcode: p.barcode ?? '',
      name: p.name,
      category: p.category,
      price: String(p.price),
      cost: String(p.cost),
      stock: String(p.stock),
      min_stock: String(p.min_stock),
      unit: p.unit,
    });
    setOpen(true);
  }

  async function simpan() {
    if (!form.name.trim()) {
      toast.error('Nama produk wajib diisi');
      return;
    }
    const price = Number(form.price) || 0;
    const cost = Number(form.cost) || 0;
    const stock = Number(form.stock) || 0;
    const minStock = Number(form.min_stock) || 0;

    if (price < 0 || cost < 0 || stock < 0) {
      toast.error('Harga dan stok tidak boleh negatif');
      return;
    }

    const payload: ProductInput = {
      barcode: form.barcode.trim() || null,
      name: form.name.trim(),
      category: form.category.trim() || 'Umum',
      price,
      cost,
      stock,
      min_stock: minStock,
      unit: form.unit.trim() || 'pcs',
    };

    setSaving(true);
    try {
      const res = editing
        ? await productsApi.update(editing.id, payload)
        : await productsApi.create(payload);

      if (!res.ok) {
        toast.error('Gagal menyimpan produk', res.error);
        return;
      }

      toast.ok(editing ? 'Produk diperbarui' : 'Produk ditambahkan', res.data.name);
      setOpen(false);
      await load(search, showInactive);
    } finally {
      setSaving(false);
    }
  }

  async function hapus() {
    if (!removing) return;
    setBusy(true);
    try {
      const res = await productsApi.remove(removing.id);
      if (!res.ok) {
        toast.error('Gagal menghapus produk', res.error);
        return;
      }
      toast.ok('Produk dihapus', removing.name);
      setRemoving(null);
      await load(search, showInactive);
    } finally {
      setBusy(false);
    }
  }

  async function ubahStok(p: Product, delta: number) {
    const res = await productsApi.adjustStock(p.id, delta);
    if (!res.ok) {
      toast.error('Gagal mengubah stok', res.error);
      return;
    }
    setProducts((prev) => prev.map((x) => (x.id === p.id ? res.data : x)));
  }

  const lowStock = products.filter((p) => p.is_active && p.stock <= p.min_stock);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ------------------------- SUB-RIBBON ------------------------- */}
      <div className="sub-ribbon">
        <span className="rb-label">Master Data · Data Barang</span>
        <button type="button" className="rb-btn-primary" onClick={openTambah}>
          <Plus className="h-3.5 w-3.5" /> Tambah Barang
        </button>
        <span className="rb-sep" />
        <button type="button" className="rb-btn" onClick={() => void load(search, showInactive)}>
          <RefreshCw className="h-3.5 w-3.5" /> Muat Ulang
        </button>
        <button
          type="button"
          className="rb-btn"
          onClick={() => {
            setSearch('');
            void load('', showInactive);
          }}
        >
          <Search className="h-3.5 w-3.5" /> Bersihkan
        </button>
        <span className="ml-auto hidden shrink-0 pr-1 text-[11.5px] text-[#7a8ba0] sm:block">
          <b className="tnum text-[#35485c]">{products.length}</b> barang
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-[#d8e0ec] bg-white p-3">
        <h2 className="mr-1 flex items-center gap-1.5 text-[13px] font-bold text-[#1b3a5c]">
          <Boxes className="h-4 w-4 text-[#1b5fa8]" /> Daftar Barang
        </h2>

        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9fb0c4]" />
          <input
            className="input h-10 pl-8 text-[13px]"
            placeholder="Cari nama / barcode / kategori..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              void load(e.target.value, showInactive);
            }}
          />
        </div>

        <label className="flex shrink-0 items-center gap-1.5 text-[12px] text-[#4a5b70]">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 accent-[#1b5fa8]"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Tampilkan non-aktif
        </label>
      </div>

      {lowStock.length ? (
        <div className="flex items-center gap-2 border-b border-[#ffe0b2] bg-[#fff9db] px-4 py-1.5 text-[12px] text-[#a35b00]">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">
            Stok menipis: {lowStock.map((p) => `${p.name} (${p.stock})`).join(', ')}
          </span>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto p-3">
        <div className="card overflow-hidden">
          <div className="panel-head">
            <span className="panel-title">
              <Boxes className="h-4 w-4 text-[#1b5fa8]" /> Daftar Produk
            </span>
            <span className="text-[11.5px] text-[#7a8ba0]">{products.length} produk</span>
          </div>

          <table className="w-full min-w-[820px] border-collapse">
            <thead className="bg-[#f6f9fd]">
              <tr>
                <th className="th w-[220px]">Produk</th>
                <th className="th w-[150px]">Barcode</th>
                <th className="th w-[110px]">Kategori</th>
                <th className="th w-[110px] text-right">Harga Jual</th>
                <th className="th w-[110px] text-right">Modal</th>
                <th className="th w-[120px] text-right">Stok</th>
                <th className="th w-[120px] text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#eef2f7]">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-[13px] text-[#9fb0c4]">
                    Memuat produk...
                  </td>
                </tr>
              ) : products.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-16 text-center">
                    <Boxes className="mx-auto h-8 w-8 text-[#c9d6e5]" />
                    <p className="mt-2 text-[13px] text-[#5b6b80]">
                      Belum ada produk. Klik &quot;Tambah Produk&quot; untuk memulai.
                    </p>
                  </td>
                </tr>
              ) : (
                products.map((p) => {
                  const tipis = p.stock <= p.min_stock;
                  return (
                    <tr key={p.id} className="bg-white transition hover:bg-[#f6f9fd]">
                      <td className="td">
                        <p className="truncate font-semibold text-[#22374b]">{p.name}</p>
                        {!p.is_active ? (
                          <span className="text-[10.5px] text-[#9fb0c4]">non-aktif</span>
                        ) : null}
                      </td>
                      <td className="td font-mono text-[12px] text-[#7a8ba0]">{p.barcode || '-'}</td>
                      <td className="td">
                        <span className="chip !py-0.5 !text-[11px]">{p.category}</span>
                      </td>
                      <td className="td tnum text-right font-bold text-accent-600">{rupiah(p.price)}</td>
                      <td className="td tnum text-right text-[#5b6b80]">{rupiah(p.cost)}</td>
                      <td className="td text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            className="grid h-6 w-6 place-items-center rounded border border-[#cdd8e6] text-[#5b6b80] transition hover:border-[#1b5fa8] hover:bg-[#e8f1fa] hover:text-[#1b5fa8]"
                            onClick={() => void ubahStok(p, -1)}
                            aria-label="Kurangi stok"
                          >
                            <Minus className="h-3 w-3" />
                          </button>
                          <span
                            className={`tnum w-10 text-center font-semibold ${tipis ? 'text-[#e03131]' : 'text-[#22374b]'}`}
                          >
                            {p.stock}
                          </span>
                          <button
                            type="button"
                            className="grid h-6 w-6 place-items-center rounded border border-[#cdd8e6] text-[#5b6b80] transition hover:border-[#1b5fa8] hover:bg-[#e8f1fa] hover:text-[#1b5fa8]"
                            onClick={() => void ubahStok(p, 1)}
                            aria-label="Tambah stok"
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                        </div>
                      </td>
                      <td className="td">
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            className="btn-outline px-2 py-1 text-[11.5px]"
                            onClick={() => openEdit(p)}
                          >
                            <Pencil className="h-3.5 w-3.5" /> Ubah
                          </button>
                          <button
                            type="button"
                            className="btn-ghost px-2 py-1 text-[11.5px] text-[#e03131] hover:bg-[#fff5f5]"
                            onClick={() => setRemoving(p)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ------------------------- form tambah/ubah ---------------------- */}
      <Modal
        open={open}
        title={editing ? 'Ubah Produk' : 'Tambah Produk'}
        onClose={() => setOpen(false)}
        width="max-w-lg"
        footer={
          <>
            <button type="button" className="btn-outline" onClick={() => setOpen(false)}>
              Batal
            </button>
            <button type="button" className="btn-primary" onClick={() => void simpan()} disabled={saving}>
              {saving ? 'Menyimpan...' : 'Simpan'}
            </button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="label" htmlFor="p-name">
              Nama Produk *
            </label>
            <input
              id="p-name"
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Contoh: Indomie Goreng"
            />
          </div>

          <div>
            <label className="label" htmlFor="p-barcode">
              Barcode
            </label>
            <input
              id="p-barcode"
              className="input font-mono"
              value={form.barcode}
              onChange={(e) => setForm({ ...form, barcode: e.target.value })}
              placeholder="8991002101015"
            />
          </div>

          <div>
            <label className="label" htmlFor="p-category">
              Kategori
            </label>
            <input
              id="p-category"
              className="input"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              placeholder="Makanan"
            />
          </div>

          <div>
            <label className="label" htmlFor="p-price">
              Harga Jual (Rp) *
            </label>
            <input
              id="p-price"
              className="input tnum"
              type="number"
              min={0}
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
              placeholder="3500"
            />
          </div>

          <div>
            <label className="label" htmlFor="p-cost">
              Harga Modal (Rp)
            </label>
            <input
              id="p-cost"
              className="input tnum"
              type="number"
              min={0}
              value={form.cost}
              onChange={(e) => setForm({ ...form, cost: e.target.value })}
              placeholder="3000"
            />
          </div>

          <div>
            <label className="label" htmlFor="p-stock">
              Stok
            </label>
            <input
              id="p-stock"
              className="input tnum"
              type="number"
              min={0}
              value={form.stock}
              onChange={(e) => setForm({ ...form, stock: e.target.value })}
              placeholder="0"
            />
          </div>

          <div>
            <label className="label" htmlFor="p-min">
              Stok Minimum
            </label>
            <input
              id="p-min"
              className="input tnum"
              type="number"
              min={0}
              value={form.min_stock}
              onChange={(e) => setForm({ ...form, min_stock: e.target.value })}
              placeholder="0"
            />
          </div>

          <div className="col-span-2">
            <label className="label" htmlFor="p-unit">
              Satuan
            </label>
            <select
              id="p-unit"
              className="input"
              value={form.unit}
              onChange={(e) => setForm({ ...form, unit: e.target.value })}
            >
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>

          {editing ? (
            <div className="col-span-2 flex items-center gap-2 rounded-lg bg-[#f6f9fd] p-2.5 text-[11.5px] text-[#4a5b70]">
              <Package className="h-3.5 w-3.5 shrink-0" />
              <span>
                Stok saat ini {editing.stock} {editing.unit}. Transaksi yang sudah tersimpan tidak ikut
                berubah.
              </span>
            </div>
          ) : null}
        </div>
      </Modal>

      {/* -------------------------- konfirmasi hapus --------------------- */}
      <Modal
        open={Boolean(removing)}
        title="Hapus Produk"
        onClose={() => setRemoving(null)}
        width="max-w-sm"
        footer={
          <>
            <button type="button" className="btn-outline" onClick={() => setRemoving(null)}>
              Batal
            </button>
            <button type="button" className="btn-danger" onClick={() => void hapus()} disabled={busy}>
              {busy ? 'Menghapus...' : 'Ya, Hapus'}
            </button>
          </>
        }
      >
        <p className="text-[13px] leading-relaxed text-[#35485c]">
          Hapus <b className="text-[#1b3a5c]">{removing?.name}</b> dari daftar produk?
        </p>
        <p className="mt-2 rounded-lg bg-[#f6f9fd] p-2.5 text-[11.5px] text-[#5b6b80]">
          Nama produk pada struk yang sudah tercetak tidak ikut berubah.
        </p>
      </Modal>
    </div>
  );
}