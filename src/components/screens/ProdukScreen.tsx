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
import { normalisasiVarian } from '@/lib/format';
import type { Product, ProductInput, ProductVariant } from '@/lib/types';

type VarianForm = {
  satuan: string;
  harga_jual: string;
  harga_pokok: string;
  konversi: string;
};

type FormState = {
  barcode: string;
  name: string;
  category: string;
  price: string;
  cost: string;
  stock: string;
  min_stock: string;
  unit: string;
  varian: VarianForm[];
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
  varian: [],
};

const EMPTY_VARIAN: VarianForm = { satuan: '', harga_jual: '', harga_pokok: '', konversi: '1' };

/** Varian -> string form; baris tanpa nama satuan diabaikan. */
const varianKeForm = (list: ProductVariant[]): VarianForm[] =>
  list.map((v) => ({
    satuan: v.satuan,
    harga_jual: String(v.harga_jual),
    harga_pokok: String(v.harga_pokok),
    konversi: String(v.konversi),
  }));

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
      varian: varianKeForm(p.variants ?? []),
    });
    setOpen(true);
  }

  /* --------------------------- editor varian ------------------------- */
  function tambahVarianBaris() {
    setForm((prev) => ({ ...prev, varian: [...prev.varian, { ...EMPTY_VARIAN }] }));
  }

  function ubahVarian(i: number, patch: Partial<VarianForm>) {
    setForm((prev) => {
      const varian = [...prev.varian];
      const cur = varian[i];
      if (!cur) return prev;
      varian[i] = { ...cur, ...patch };
      return { ...prev, varian };
    });
  }

  function hapusVarian(i: number) {
    setForm((prev) => ({ ...prev, varian: prev.varian.filter((_, x) => x !== i) }));
  }

  /** Baris varian pertama belum diisi -> isi otomatis dari harga produk. */
  function isiVarianOtomatis() {
    setForm((prev) => {
      if (prev.varian.length || !Number(prev.price)) return prev;
      return {
        ...prev,
        varian: [
          {
            satuan: 'Pcs',
            harga_jual: prev.price,
            harga_pokok: prev.cost,
            konversi: '1',
          },
        ],
      };
    });
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

    // Varian: buang baris kosong / tidak valid, dan tolak nama satuan kembar.
    const varian = normalisasiVarian(
      form.varian
        .filter((v) => v.satuan.trim())
        .map((v) => ({
          satuan: v.satuan.trim(),
          harga_jual: Number(v.harga_jual) || 0,
          harga_pokok: Number(v.harga_pokok) || 0,
          konversi: Number(v.konversi) || 1,
        })),
    );
    const duplikat = varian.find(
      (v, i) => varian.findIndex((x) => x.satuan.toLowerCase() === v.satuan.toLowerCase()) !== i,
    );
    if (duplikat) {
      toast.error('Satuan varian kembar', `"${duplikat.satuan}" dipakai lebih dari sekali.`);
      return;
    }
    if (varian.some((v) => v.harga_jual < 0 || v.harga_pokok < 0 || v.konversi <= 0)) {
      toast.error('Varian tidak valid', 'Harga harus >= 0 dan konversi harus lebih dari 0.');
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
      variants: varian,
      satuanList: varian.length ? varian.map((v) => v.satuan) : undefined,
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

        {/* ====================== VARIAN SATUAN (iPOS) ==================== */}
        <div className="mt-3 border-t border-[#e2e8f0] pt-3">
          <div className="mb-2 flex items-center gap-2">
            <Package className="h-3.5 w-3.5 text-[#1b5fa8]" />
            <p className="text-[12.5px] font-bold text-[#1b3a5c]">Varian Satuan</p>
            <button type="button" className="rb-btn ml-auto" onClick={tambahVarianBaris}>
              <Plus className="h-3.5 w-3.5" />
              Tambah Varian
            </button>
          </div>

          <p className="mb-2 rounded bg-[#f6f9fd] p-2 text-[11.5px] text-[#5b6b80]">
            Saat kasir mengubah kolom <b>Satuan</b>, <b>H. Jual</b> dan <b>H. Pokok</b> otomatis ikut
            berubah sesuai varian di bawah. Kosongkan bila semua satuan memakai harga produk yang sama.
          </p>

          {form.varian.length === 0 ? (
            <button
              type="button"
              onClick={isiVarianOtomatis}
              disabled={!Number(form.price)}
              className="w-full rounded border border-dashed border-[#cdd8e6] py-2.5 text-[12px] font-semibold text-[#7a8ba0] transition hover:border-[#1b5fa8] hover:text-[#1b5fa8] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {Number(form.price)
                ? '+ Tambahkan satuan dasar dari harga produk'
                : 'Isi Harga Jual dulu untuk membuat satuan dasar'}
            </button>
          ) : (
            <div className="space-y-1.5">
              {form.varian.map((v, i) => (
                <div key={`varian-${i}`} className="flex items-center gap-1.5">
                  <input
                    className="input h-9 flex-1"
                    placeholder="Satuan (mis. Dus/6)"
                    value={v.satuan}
                    onChange={(e) => ubahVarian(i, { satuan: e.target.value })}
                  />
                  <input
                    className="input tnum h-9 w-[112px] text-right"
                    placeholder="H. Jual"
                    inputMode="numeric"
                    value={v.harga_jual}
                    onChange={(e) => ubahVarian(i, { harga_jual: e.target.value })}
                  />
                  <input
                    className="input tnum h-9 w-[112px] text-right"
                    placeholder="H. Pokok"
                    inputMode="numeric"
                    value={v.harga_pokok}
                    onChange={(e) => ubahVarian(i, { harga_pokok: e.target.value })}
                  />
                  <input
                    className="input tnum h-9 w-[74px] text-right"
                    placeholder="Konv."
                    inputMode="numeric"
                    value={v.konversi}
                    onChange={(e) => ubahVarian(i, { konversi: e.target.value })}
                  />
                  <button
                    type="button"
                    onClick={() => hapusVarian(i)}
                    title="Hapus varian"
                    className="grid h-9 w-9 shrink-0 place-items-center rounded border border-[#e9b3b3] bg-white text-[#c92a2a] transition hover:bg-[#fff5f5]"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}

              <div className="flex items-center gap-1.5 pr-[34px] text-[11px] text-[#9fb0c4]">
                <span className="w-[112px] shrink-0 text-center">Harga Jual</span>
                <span className="w-[112px] shrink-0 text-center">Harga Pokok</span>
                <span className="w-[74px] shrink-0 text-center">Konversi</span>
              </div>
            </div>
          )}
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