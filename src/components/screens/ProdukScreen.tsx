'use client';

import * as React from 'react';
import {
  AlertTriangle,
  BookOpen,
  Boxes,
  Download,
  Loader2,
  Minus,
  PackagePlus,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';

import { productsApi, stockApi } from '@/lib/api';
import { exportProductsCsv, produkInputDariBaris, unduhTeks, type ParsedProdukRow } from '@/lib/csv';
import { CsvImportModal, type ImportResult } from '@/components/CsvImportModal';
import { KartuStokModal } from '@/components/KartuStokModal';
import { StokMasukModal } from '@/components/StokMasukModal';
import { normalisasiVarian, varianKeJson, validasiVarian, type VarianBaris } from '@/lib/format';
import { useToast } from '@/components/Toast';
import { Modal } from '@/components/Modal';
import { SatuanVarianTable } from '@/components/SatuanVarianTable';
import { useButtonGuard, useClickCooldown } from '@/lib/useButtonGuard';
import { angka, rupiah } from '@/lib/format';
import type { Product, ProductInput, StockLog } from '@/lib/types';

type FormState = {
  barcode: string;
  name: string;
  category: string;
  stock: string;
  min_stock: string;
  varian: VarianBaris[];
};

const EMPTY: FormState = {
  barcode: '',
  name: '',
  category: 'Umum',
  stock: '',
  min_stock: '',
  varian: [{ satuan: '', harga_beli: '', harga_jual: '', konversi: '1', barcode: '' }],
};

/** Baris satuan baru: konversi default 1, harga dikosongkan. */
const BARIS_BARU: VarianBaris = { satuan: '', harga_beli: '', harga_jual: '', konversi: '1', barcode: '' };

/** Varian -> baris form. Baris satuan dasar (konversi 1) selalu jadi baris 1. */
const varianKeBaris = (v: ReturnType<typeof normalisasiVarian>): VarianBaris[] => {
  if (!v.length) return [{ ...BARIS_BARU }];
  return v.map((x, i) => ({
    satuan: x.satuan,
    harga_beli: String(x.harga_beli),
    harga_jual: String(x.harga_jual),
    konversi: i === 0 ? '1' : String(x.konversi),
    barcode: x.barcode ?? '',
  }));
};

export default function ProdukScreen() {
  const toast = useToast();
  const simpan = useButtonGuard();
  const stok = useClickCooldown(700);
  const bukaHapus = useClickCooldown(1500);
  // Kunci tombol UI ringan (buka modal, muat ulang) agar tak terpicu dua kali.
  const ui = useClickCooldown(1500);

  const [products, setProducts] = React.useState<Product[]>([]);
  const [search, setSearch] = React.useState('');
  const [showInactive, setShowInactive] = React.useState(false);
  const [loading, setLoading] = React.useState(true);

  const [editing, setEditing] = React.useState<Product | null>(null);
  const [form, setForm] = React.useState<FormState>(EMPTY);
  const [open, setOpen] = React.useState(false);
  const [removing, setRemoving] = React.useState<Product | null>(null);
  const [hapusBusy, setHapusBusy] = React.useState(false);
  const [csvOpen, setCsvOpen] = React.useState(false);
  const [stokMasuk, setStokMasuk] = React.useState<Product | null>(null);
  const stokMasukGuard = useButtonGuard();
  const [kartu, setKartu] = React.useState<Product | null>(null);
  const [kartuLogs, setKartuLogs] = React.useState<StockLog[]>([]);
  const [kartuLoading, setKartuLoading] = React.useState(false);

  /* ------------------------- kategori baru ---------------------------- */
  const [kategoriList, setKategoriList] = React.useState<string[]>([]);
  const [kategoriModal, setKategoriModal] = React.useState(false);
  const [kategoriBaru, setKategoriBaru] = React.useState('');
  const kategori = useButtonGuard();
  const kategoriBusy = kategori.busy;

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

  // Ambil daftar kategori dari produk yang sudah ada (dropdown + modal baru).
  React.useEffect(() => {
    void (async () => {
      const res = await productsApi.categories();
      if (res.ok) setKategoriList(res.data);
    })();
  }, []);

  /* ------------------------------ form CRUD ---------------------------- */
  function openTambah() {
    setEditing(null);
    setForm({ ...EMPTY, varian: [{ ...BARIS_BARU }] });
    setOpen(true);
  }

  function openEdit(p: Product) {
    setEditing(p);
    setForm({
      barcode: p.barcode ?? '',
      name: p.name,
      category: p.category,
      stock: String(p.stock),
      min_stock: String(p.min_stock),
      varian: varianKeBaris(p.variants ?? []),
    });
    setOpen(true);
  }

  /* ------------------------------ CSV (Fitur #4) ---------------------- */
  /** Ekspor SEMUA produk (termasuk non-aktif) ke berkas CSV. */
  async function exportCsv() {
    const res = await productsApi.list('', true);
    if (!res.ok) {
      toast.error('Gagal mengekspor', res.error);
      return;
    }
    const tgl = new Date().toISOString().slice(0, 10);
    unduhTeks(`produk-${tgl}.csv`, exportProductsCsv(res.data));
    toast.ok('CSV diunduh', `${res.data.length} produk diekspor.`);
  }

  /** Impor baris CSV: upsert per barcode (barcode sama = update, baru = create). */
  async function runImport(rows: ParsedProdukRow[]): Promise<ImportResult> {
    const semua = await productsApi.list('', true);
    if (!semua.ok) return { dibuat: 0, diperbarui: 0, gagal: [{ row: 1, pesan: semua.error }] };
    const byBarcode = new Map<string, Product>();
    const byNama = new Map<string, Product>();
    for (const p of semua.data) {
      if (p.barcode) byBarcode.set(p.barcode.trim().toLowerCase(), p);
      byNama.set(p.name.trim().toLowerCase(), p);
    }

    const hasil: ImportResult = { dibuat: 0, diperbarui: 0, gagal: [] };
    for (let i = 0; i < rows.length; i++) {
      const b = rows[i];
      try {
        const kunciBarcode = b.barcode.trim().toLowerCase();
        const existing =
          (kunciBarcode ? byBarcode.get(kunciBarcode) : undefined) ??
          byNama.get(b.nama.trim().toLowerCase());
        const input = produkInputDariBaris(b, existing ?? null);
        if (existing) {
          const r = await productsApi.update(existing.id, input);
          if (!r.ok) hasil.gagal.push({ row: i + 2, pesan: r.error });
          else hasil.diperbarui++;
        } else {
          const r = await productsApi.create(input);
          if (!r.ok) hasil.gagal.push({ row: i + 2, pesan: r.error });
          else hasil.dibuat++;
        }
      } catch (e) {
        hasil.gagal.push({
          row: i + 2,
          pesan: e instanceof Error ? e.message : 'Gagal diproses.',
        });
      }
    }
    await load('', showInactive);
    return hasil;
  }

  /* --------------------------- editor varian ------------------------- */
  function tambahVarianBaris() {
    setForm((prev) => ({ ...prev, varian: [...prev.varian, { ...BARIS_BARU }] }));
  }

  /** Simpan kategori baru (hanya di memori — kategori hidup dari kolom produk). */
  function simpanKategoriBaru() {
    const nama = kategoriBaru.trim();
    if (!nama) return;
    setKategoriList((prev) => (prev.some((k) => k.toLowerCase() === nama.toLowerCase()) ? prev : [...prev, nama].sort()));
    setForm((prev) => ({ ...prev, category: nama }));
    setKategoriBaru('');
    setKategoriModal(false);
  }

  /** Tombol Simpan kategori: terkunci 1,5 detik supaya tak dobel terkirim. */
  function klikSimpanKategori() {
    if (kategoriBusy) {
      toast.info('Mohon tunggu…', 'Kategori sedang disimpan.');
      return;
    }
    void kategori.guard(
      () => {
        simpanKategoriBaru();
        return true;
      },
      {
        cooldownMs: 1200,
        pesanTunggu: 'Kategori sedang disimpan…',
        onBlocked: (pesan) => toast.info('Mohon tunggu…', pesan),
      },
    );
  }

  /* ----------------------------- validasi ------------------------------ */
  const varianErrors = React.useMemo(() => validasiVarian(form.varian), [form.varian]);
  const namaError = form.name.trim().length > 0 && form.name.trim().length < 3
    ? 'Nama minimal 3 karakter.'
    : '';
  const stokError =
    form.stock !== '' && (!Number.isFinite(Number(form.stock)) || Number(form.stock) < 0)
      ? 'Stok tidak boleh negatif.'
      : '';
  const minStokError =
    form.min_stock !== '' && (!Number.isFinite(Number(form.min_stock)) || Number(form.min_stock) < 0)
      ? 'Stok minimum tidak boleh negatif.'
      : '';

  const isFormValid = React.useMemo(() => {
    if (form.name.trim().length < 3) return false;
    if (varianErrors.length > 0) return false;
    if (stokError || minStokError) return false;
    return true;
  }, [form.name, varianErrors, stokError, minStokError]);

  /* ------------------------------ simpan ------------------------------- */
  async function aksiSimpan() {
    if (!isFormValid) return;

    const varian = varianKeJson(form.varian);
    const dasar = varian[0];
    if (!dasar) return;

    // Baris satuan dasar otomatis memakai barcode utama bila barcode satuan kosong.
    if (!dasar.barcode && form.barcode.trim()) dasar.barcode = form.barcode.trim();

    const payload: ProductInput = {
      barcode: form.barcode.trim() || null,
      name: form.name.trim(),
      category: form.category.trim() || 'Umum',
      price: dasar.harga_jual,
      cost: dasar.harga_beli,
      stock: Number(form.stock) || 0,
      min_stock: Number(form.min_stock) || 0,
      unit: dasar.satuan,
      variants: varian,
    };

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
  }

  function simpanProduk() {
    if (!isFormValid) {
      toast.error('Form belum lengkap', 'Isi nama produk dan minimal 1 satuan dengan harga yang benar.');
      return;
    }
    void simpan.guard(aksiSimpan, {
      cooldownMs: 800,
      pesanTunggu: 'Simpan sedang diproses…',
      onBlocked: (pesan) => toast.info('Mohon tunggu…', pesan),
    });
  }

  /** Konfirmasi hapus: tolak klik ganda, satu klik = satu DELETE. */
  function klikHapus() {
    if (!removing) return;
    if (hapusBusy) {
      toast.info('Mohon tunggu…', 'Penghapusan sedang diproses.');
      return;
    }
    setHapusBusy(true);
    void (async () => {
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
        setHapusBusy(false);
      }
    })();
  }

  /** Tambah/kurangi stok cepat; dikunci singkat agar tak terkirim beruntun. */
  function ubahStok(p: Product, delta: number) {
    stok.run(() => void kirimStok(p, delta), `stok-${p.id}-${delta > 0 ? 'naik' : 'turun'}`);
  }

  async function kirimStok(p: Product, delta: number) {
    const res = await productsApi.adjustStock(p.id, delta);
    if (!res.ok) {
      toast.error('Gagal mengubah stok', res.error);
      return;
    }
    setProducts((prev) => prev.map((x) => (x.id === p.id ? res.data : x)));
  }

  /** Buka konfirmasi hapus; klik ganda pada tombol Hapus tidak membuka 2 modal. */
  function bukaKonfirmasiHapus(p: Product) {
    bukaHapus.run(() => setRemoving(p), `hapus-${p.id}`);
  }

  /* --------------------------- stok & kartu stok ---------------------- */
  /** Buka modal penyesuaian stok (masuk/keluar + keterangan). */
  function bukaStokMasuk(p: Product) {
    setStokMasuk(p);
  }

  /** Simpan penyesuaian stok — atomik via RPC `kasir_adjust_stock` (tercatat
   *  di kartu stok); fallback get+update bila migrasi belum dijalankan. */
  function simpanStokMasuk(delta: number, keterangan: string) {
    if (!stokMasuk) return;
    void stokMasukGuard.guard(
      async () => {
        const res = await productsApi.adjustStock(stokMasuk.id, delta, keterangan);
        if (!res.ok) {
          toast.error('Gagal mengubah stok', res.error);
          return;
        }
        setProducts((prev) => prev.map((x) => (x.id === res.data.id ? res.data : x)));
        setStokMasuk(null);
        toast.ok(
          delta > 0 ? 'Stok masuk' : 'Stok keluar',
          `${stokMasuk.name} — ${angka(Math.abs(delta))} ${stokMasuk.unit || ''}${
            keterangan ? ` (${keterangan})` : ''
          }`,
        );
      },
      { pesanTunggu: 'Menyimpan…' },
    );
  }

  /** Buka kartu stok + muat riwayat mutasi produk. */
  function bukaKartu(p: Product) {
    setKartu(p);
    void muatKartu(p);
  }

  async function muatKartu(p?: Product) {
    const target = p ?? kartu;
    if (!target) return;
    setKartuLoading(true);
    try {
      const res = await stockApi.logs(target.id);
      if (!res.ok) {
        toast.error('Gagal memuat kartu stok', res.error);
        setKartuLogs([]);
        return;
      }
      setKartuLogs(res.data);
    } finally {
      setKartuLoading(false);
    }
  }

  const lowStock = products.filter((p) => p.is_active && p.stock <= p.min_stock);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ------------------------- SUB-RIBBON ------------------------- */}
      <div className="sub-ribbon">
        <span className="rb-label">Master Data · Data Barang</span>
        <button
          type="button"
          className="rb-btn-primary"
          onClick={() => ui.run(openTambah, 'produk-tambah')}
          disabled={ui.locked('produk-tambah')}
        >
          <Plus className="h-3.5 w-3.5" /> Tambah Barang
        </button>
        <span className="rb-sep" />
        <button
          type="button"
          className="rb-btn"
          onClick={() => ui.run(() => void load(search, showInactive), 'produk-muat')}
          disabled={ui.locked('produk-muat')}
        >
          <RefreshCw className="h-3.5 w-3.5" /> Muat Ulang
        </button>
        <button
          type="button"
          className="rb-btn"
          onClick={() =>
            ui.run(() => {
              setSearch('');
              void load('', showInactive);
            }, 'produk-bersihkan')
          }
          disabled={ui.locked('produk-bersihkan')}
        >
          <Search className="h-3.5 w-3.5" /> Bersihkan
        </button>
        <span className="rb-sep" />
        <button
          type="button"
          className="rb-btn"
          onClick={() => ui.run(() => void exportCsv(), 'produk-export')}
          disabled={ui.locked('produk-export') || loading}
        >
          <Download className="h-3.5 w-3.5" /> Export CSV
        </button>
        <button
          type="button"
          className="rb-btn"
          onClick={() => ui.run(() => setCsvOpen(true), 'produk-import')}
          disabled={ui.locked('produk-import')}
        >
          <Upload className="h-3.5 w-3.5" /> Import CSV
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
            Stok menipis: {lowStock.map((p) => `${p.name} (${angka(p.stock)})`).join(', ')}
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
                            onClick={() => ubahStok(p, -1)}
                            disabled={stok.locked(`stok-${p.id}-turun`) || p.stock <= 0}
                            aria-label="Kurangi stok"
                          >
                            <Minus className="h-3 w-3" />
                          </button>
                          <span
                            className={`tnum min-w-[44px] px-0.5 text-center font-semibold ${tipis ? 'text-[#e03131]' : 'text-[#22374b]'}`}
                          >
                            {angka(p.stock)}
                          </span>
                          <button
                            type="button"
                            className="grid h-6 w-6 place-items-center rounded border border-[#cdd8e6] text-[#5b6b80] transition hover:border-[#1b5fa8] hover:bg-[#e8f1fa] hover:text-[#1b5fa8]"
                            onClick={() => ubahStok(p, 1)}
                            disabled={stok.locked(`stok-${p.id}-naik`)}
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
                            className="btn-ghost px-2 py-1 text-[11.5px] text-[#5b6b80] hover:bg-[#e8f1fa] hover:text-[#1b5fa8]"
                            onClick={() => ui.run(() => bukaKartu(p), `kartu-${p.id}`)}
                            disabled={ui.locked(`kartu-${p.id}`)}
                            aria-label={`Kartu stok ${p.name}`}
                            title="Kartu stok (riwayat mutasi)"
                          >
                            <BookOpen className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            className="btn-ghost px-2 py-1 text-[11.5px] text-[#5b6b80] hover:bg-[#e8f1fa] hover:text-[#1b5fa8]"
                            onClick={() => ui.run(() => bukaStokMasuk(p), `stok-${p.id}`)}
                            disabled={ui.locked(`stok-${p.id}`)}
                            aria-label={`Atur stok ${p.name}`}
                            title="Stok masuk / keluar"
                          >
                            <PackagePlus className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            className="btn-outline px-2 py-1 text-[11.5px]"
                            onClick={() => ui.run(() => openEdit(p), `ubah-${p.id}`)}
                            disabled={ui.locked(`ubah-${p.id}`)}
                          >
                            <Pencil className="h-3.5 w-3.5" /> Ubah
                          </button>
                          <button
                            type="button"
                            className="btn-ghost px-2 py-1 text-[11.5px] text-[#e03131] hover:bg-[#fff5f5]"
                            onClick={() => bukaKonfirmasiHapus(p)}
                            aria-label={`Hapus ${p.name}`}
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
        onClose={() => !simpan.busy && setOpen(false)}
        width="max-w-3xl"
        footer={
          <>
            <button type="button" className="btn-outline" onClick={() => setOpen(false)} disabled={simpan.busy}>
              Batal
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={simpanProduk}
              disabled={!isFormValid || simpan.busy}
              data-loading={simpan.busy}
            >
              {simpan.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {simpan.busy ? 'Menyimpan…' : 'Simpan'}
            </button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (simpan.busy) {
              toast.info('Mohon tunggu…', 'Simpan sedang diproses.');
              return;
            }
            simpanProduk();
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="label" htmlFor="p-name">
                Nama Produk *
              </label>
              <input
                id="p-name"
                className={`input ${namaError ? 'input-invalid' : ''}`}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Contoh: Air Mineral 600ml"
                aria-invalid={Boolean(namaError)}
              />
              {namaError ? (
                <p className="field-error">
                  <AlertTriangle className="h-3 w-3" /> {namaError}
                </p>
              ) : null}
            </div>

            <div>
              <label className="label" htmlFor="p-barcode">
                Barcode Utama
              </label>
              <input
                id="p-barcode"
                className="input font-mono"
                value={form.barcode}
                onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                placeholder="8999999030001"
              />
              <p className="mt-1 text-[10.5px] text-[#9fb0c4]">Dipakai untuk satuan dasar.</p>
            </div>

            <div>
              <label className="label" htmlFor="p-category">
                Kategori
              </label>
              <div className="flex gap-1.5">
                <select
                  id="p-category"
                  className="input"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                >
                  {!kategoriList.includes(form.category) ? (
                    <option value={form.category}>{form.category || 'Umum'}</option>
                  ) : null}
                  {kategoriList.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => ui.run(() => setKategoriModal(true), 'kategori-tambah')}
                  disabled={ui.locked('kategori-tambah')}
                  title="Tambah kategori baru"
                  aria-label="Tambah kategori baru"
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-[#cdd8e6] bg-white text-[15px] font-bold leading-none text-[#1b5fa8] transition hover:bg-[#e8f1fa]"
                >
                  +
                </button>
              </div>
            </div>

            <div>
              <label className="label" htmlFor="p-stock">
                Stok
              </label>
              <input
                id="p-stock"
                className={`input tnum ${stokError ? 'input-invalid' : ''}`}
                type="number"
                min={0}
                value={form.stock}
                onChange={(e) => setForm({ ...form, stock: e.target.value })}
                placeholder="0"
              />
              {stokError ? (
                <p className="field-error">
                  <AlertTriangle className="h-3 w-3" /> {stokError}
                </p>
              ) : null}
            </div>

            <div>
              <label className="label" htmlFor="p-min">
                Stok Minimum
              </label>
              <input
                id="p-min"
                className={`input tnum ${minStokError ? 'input-invalid' : ''}`}
                type="number"
                min={0}
                value={form.min_stock}
                onChange={(e) => setForm({ ...form, min_stock: e.target.value })}
                placeholder="0"
              />
              {minStokError ? (
                <p className="field-error">
                  <AlertTriangle className="h-3 w-3" /> {minStokError}
                </p>
              ) : null}
            </div>
          </div>

          {/* ==================== TABEL VARIAN SATUAN ==================== */}
          <SatuanVarianTable
            baris={form.varian}
            onChange={(next) => setForm((prev) => ({ ...prev, varian: next }))}
            onTambah={tambahVarianBaris}
            errors={varianErrors}
          />

          {editing ? (
            <p className="mt-3 rounded-md bg-[#f6f9fd] p-2.5 text-[11.5px] text-[#4a5b70]">
              Stok saat ini {angka(editing.stock)} {editing.unit}. Transaksi yang sudah tersimpan tidak
              ikut berubah.
            </p>
          ) : null}
        </form>
      </Modal>

      {/* ---------------------- modal kategori baru ---------------------- */}
      <Modal
        open={kategoriModal}
        title="Kategori Baru"
        onClose={() => setKategoriModal(false)}
        width="max-w-xs"
        footer={
          <>
            <button type="button" className="btn-outline" onClick={() => setKategoriModal(false)}>
              Batal
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={klikSimpanKategori}
              disabled={!kategoriBaru.trim() || kategoriBusy}
              data-loading={kategoriBusy}
            >
              {kategoriBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {kategoriBusy ? 'Menyimpan…' : 'Simpan'}
            </button>
          </>
        }
      >
        <label className="label" htmlFor="kategori-baru">
          Nama Kategori
        </label>
        <input
          id="kategori-baru"
          className="input"
          value={kategoriBaru}
          onChange={(e) => setKategoriBaru(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            if (kategoriBusy) {
              toast.info('Mohon tunggu…', 'Kategori sedang disimpan.');
              return;
            }
            klikSimpanKategori();
          }}
          placeholder="mis. Minuman"
          autoFocus
        />
        <p className="mt-1.5 text-[11px] text-[#9fb0c4]">
          Kategori dipakai untuk mengelompokkan produk. Muncul otomatis setelah ada produk yang
          memakainya.
        </p>
      </Modal>

      {/* -------------------------- konfirmasi hapus --------------------- */}
      <Modal
        open={Boolean(removing)}
        title="Hapus Produk"
        onClose={() => setRemoving(null)}
        width="max-w-sm"
        footer={
          <>
            <button
              type="button"
              className="btn-outline"
              onClick={() => setRemoving(null)}
              disabled={hapusBusy}
            >
              Batal
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={klikHapus}
              disabled={hapusBusy}
              data-loading={hapusBusy}
            >
              {hapusBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {hapusBusy ? 'Menghapus…' : 'Ya, Hapus'}
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

      {/* -------------------------- impor CSV (Fitur #4) ------------------ */}
      <CsvImportModal open={csvOpen} onClose={() => setCsvOpen(false)} onImport={runImport} />

      {/* -------------------- stok masuk/keluar (Fitur #5) -------------- */}
      <StokMasukModal
        open={Boolean(stokMasuk)}
        product={stokMasuk}
        busy={stokMasukGuard.busy}
        onClose={() => setStokMasuk(null)}
        onAdjust={simpanStokMasuk}
      />

      {/* ------------------------- kartu stok (Fitur #5) ---------------- */}
      <KartuStokModal
        open={Boolean(kartu)}
        product={kartu}
        logs={kartuLogs}
        loading={kartuLoading}
        onClose={() => setKartu(null)}
        onRefresh={() => void muatKartu()}
      />
    </div>
  );
}