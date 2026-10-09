'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { History, ListChecks, PackageSearch, Pencil, Plus, RotateCcw, Sparkles, Truck, X } from 'lucide-react';

import { productsApi, purchasesApi, satuanApi, suppliersApi } from '@/lib/api';
import { angka, rupiah, satuanOptions } from '@/lib/format';
import { RupiahInput } from '@/components/RupiahInput';
import { Modal } from '@/components/Modal';
import { TeleponInput } from '@/components/TeleponInput';
import { useToast } from '@/components/Toast';
import { useButtonGuard } from '@/lib/useButtonGuard';
import type { Product, PurchaseItemRecord, PurchaseRecord, PurchaseStatus, Supplier } from '@/lib/types';

interface BarisPembelian {
  productId: string;
  name: string;
  unit: string;
  /** Pilihan kolom SATUAN baris ini — satuan yang sudah di-link ke produk. */
  opsi: string[];
  qty: number;
  cost: number;
}

/**
 * Pembelian (PO sederhana) — full width, 2 panel:
 *   KIRI  : search produk + 8 produk "Sering Beli"
 *   KANAN : tabel PO + supplier + catatan + total + simpan
 * Tombol cepat: Riwayat Beli Terakhir, Sering Beli, tambah barang baru.
 */
export default function PembelianScreen() {
  const toast = useToast();
  const router = useRouter();
  const [products, setProducts] = React.useState<Product[]>([]);
  const [supplierName, setSupplierName] = React.useState('');
  const [supplierId, setSupplierId] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<PurchaseStatus>('lunas');
  const [note, setNote] = React.useState('');
  const [baris, setBaris] = React.useState<BarisPembelian[]>([]);
  const [pesan, setPesan] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  // Mode Edit: id + no faktur PO yang sedang diedit (null = mode PO baru).
  const [editId, setEditId] = React.useState<string | null>(null);
  const [editInvoice, setEditInvoice] = React.useState<string | null>(null);
  const editDariUrl = React.useRef<string | null>(null);
  const editSudahMulai = React.useRef(false);

  // Daftar supplier (dropdown) + modal "Supplier Baru".
  const [suppliers, setSuppliers] = React.useState<Supplier[]>([]);
  const [supplierOpen, setSupplierOpen] = React.useState(false);
  const [supplierBaru, setSupplierBaru] = React.useState({ name: '', phone: '', address: '' });
  const supplierGuard = useButtonGuard();

  // search state
  const [kode, setKode] = React.useState('');
  const [saran, setSaran] = React.useState<Product[]>([]);
  const [saranTampil, setSaranTampil] = React.useState(false);
  const [saranIdx, setSaranIdx] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const wrapRef = React.useRef<HTMLDivElement>(null);

  // data cepat beli
  const [sering, setSering] = React.useState<PurchaseItemRecord[]>([]);
  const [riwayatOpen, setRiwayatOpen] = React.useState(false);
  const [riwayat, setRiwayat] = React.useState<PurchaseRecord[]>([]);
  const [riwayatLoading, setRiwayatLoading] = React.useState(false);
  const [barangBaruOpen, setBarangBaruOpen] = React.useState(false);
  const [baru, setBaru] = React.useState({ name: '', category: 'Umum', unit: 'Pcs', price: '', cost: '', stock: '' });

  // supplier history (map productId -> last cost)
  const [supplierCostMap, setSupplierCostMap] = React.useState<Map<string, number>>(new Map());

  // Master satuan: pilihan kolom SATUAN & modal "Barang Baru".
  const [opsiSatuan, setOpsiSatuan] = React.useState<string[]>([]);

  React.useEffect(() => {
    void satuanApi.list().then((r) => {
      if (r.ok) setOpsiSatuan(r.data.map((s) => s.nama));
    });
  }, []);

  // Daftar supplier untuk dropdown + tombol [+] di panel kiri.
  const muatSuppliers = React.useCallback(async () => {
    const r = await suppliersApi.list();
    if (r.ok) setSuppliers(r.data);
  }, []);

  React.useEffect(() => {
    void muatSuppliers();
  }, [muatSuppliers]);

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

  // Load "sering beli" sekali setiap products ada
  React.useEffect(() => {
    void purchasesApi.frequent(8).then((r) => {
      if (r.ok) setSering(r.data);
    });
  }, []);

  // Saat supplier berubah, load map last-cost
  React.useEffect(() => {
    const s = supplierName.trim();
    if (!s) {
      setSupplierCostMap(new Map());
      return;
    }
    let batalkan = false;
    void purchasesApi.lastCostBySupplier(s).then((r) => {
      if (!batalkan && r.ok) setSupplierCostMap(r.data);
    });
    return () => {
      batalkan = true;
    };
  }, [supplierName]);

  // Shortcut F2 fokus search, Esc tutup saran
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function tambah(p: Product) {
    const lastCost = supplierCostMap.get(p.id);
    setBaris((prev) => {
      const i = prev.findIndex((b) => b.productId === p.id);
      if (i >= 0) {
        return prev.map((b, j) => (j === i ? { ...b, qty: b.qty + 1 } : b));
      }
      // Kolom SATUAN hanya menampilkan satuan yang sudah di-link ke produk ini
      // (satuan dasar + turunan `variants`), bukan semua master satuan.
      const opsi = satuanOptions(p, opsiSatuan);
      return [
        ...prev,
        {
          productId: p.id,
          name: p.name,
          unit: p.unit && opsi.includes(p.unit) ? p.unit : (opsi[0] ?? p.unit),
          opsi,
          qty: 1,
          cost: lastCost ?? p.cost,
        },
      ];
    });
    setKode('');
    setSaranTampil(false);
    setSaranIdx(0);
    inputRef.current?.focus();
  }

  function tambahDariSering(it: PurchaseItemRecord) {
    const found = products.find(
      (p) => (it.product_id && p.id === it.product_id) || p.name.toLowerCase() === it.product_name.toLowerCase(),
    );
    if (found) {
      tambah(found);
    } else {
      toast.info('Produk tidak ditemukan', 'Tambahkan lewat "Produk Baru" dulu.');
    }
  }

  async function muatRiwayat() {
    setRiwayatLoading(true);
    const r = await purchasesApi.listRecent(10);
    if (r.ok) setRiwayat(r.data);
    setRiwayatLoading(false);
  }

  /** Isi form Pembelian dari sebuah PO dan aktifkan Mode Edit. */
  function terapkanKeForm(p: PurchaseRecord, items: PurchaseItemRecord[]) {
    setEditId(p.id);
    setEditInvoice(p.invoice_no);
    setSupplierName(p.supplier_name);
    setSupplierId(p.supplier_id ?? suppliers.find((s) => s.name === p.supplier_name)?.id ?? null);
    setStatus(p.status);
    setNote(p.note ?? '');
    setPesan(null);
    setBaris(
      items.map((it) => {
        // Cari dulu produk aslinya supaya pilihan SATUAN ikut ke-filter.
        const prod =
          products.find((x) => it.product_id && x.id === it.product_id) ??
          products.find((x) => x.name.toLowerCase() === it.product_name.toLowerCase());
        const opsi = prod ? satuanOptions(prod, opsiSatuan) : opsiSatuan;
        const unit = prod
          ? prod.unit && opsi.includes(prod.unit)
            ? prod.unit
            : (opsi[0] ?? '')
          : (opsi[0] ?? '');
        return {
          productId: it.product_id ?? '',
          name: it.product_name,
          unit,
          opsi: opsi.length ? opsi : opsiSatuan,
          qty: Number(it.qty) || 1,
          cost: Number(it.cost) || 0,
        };
      }),
    );
  }

  /** Muat PO berdasarkan id lalu masuk Mode Edit (dipakai dari ?edit=<id>). */
  async function mulaiEdit(id: string) {
    setRiwayatLoading(true);
    const [pr, it] = await Promise.all([purchasesApi.get(id), purchasesApi.items(id)]);
    setRiwayatLoading(false);
    if (!pr.ok) {
      toast.error('Gagal memuat PO', pr.error);
      return;
    }
    if (!pr.data) {
      toast.error('PO tidak ditemukan', 'Data pembelian ini tidak tersedia.');
      return;
    }
    if (!it.ok || !it.data.length) {
      toast.info('Tidak ada item', 'PO ini tidak punya item yang bisa diedit.');
      return;
    }
    terapkanKeForm(pr.data, it.data);
    toast.ok('Mode edit PO', `Edit PO — ${pr.data.invoice_no ?? pr.data.id.slice(0, 8)}`);
  }

  // Buka Mode Edit bila datang dari ikon Pensil di Riwayat (?edit=<id>).
  React.useEffect(() => {
    editDariUrl.current = new URLSearchParams(window.location.search).get('edit');
  }, []);

  React.useEffect(() => {
    const id = editDariUrl.current;
    if (!id || editSudahMulai.current || !products.length) return;
    editSudahMulai.current = true;
    void mulaiEdit(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products]);

  /** Isi form lama untuk diedit (dipanggil dari popup "Riwayat Beli Terakhir"). */
  async function pilihRiwayat(p: PurchaseRecord) {
    setRiwayatLoading(true);
    const r = await purchasesApi.items(p.id);
    setRiwayatLoading(false);
    if (!r.ok || !r.data.length) {
      toast.info('Tidak ada item', 'PO ini tidak punya item yang bisa dimuat.');
      return;
    }
    terapkanKeForm(p, r.data);
    setRiwayatOpen(false);
    toast.ok('Mode edit PO', `Edit PO — ${p.invoice_no ?? p.id.slice(0, 8)}`);
  }

  function ubah(idx: number, patch: Partial<BarisPembelian>) {
    setBaris((prev) => prev.map((b, i) => (i === idx ? { ...b, ...patch } : b)));
  }

  const total = baris.reduce((s, b) => s + b.qty * b.cost, 0);

  /** Kosongkan form & keluar dari Mode Edit. */
  function resetForm() {
    setEditId(null);
    setEditInvoice(null);
    setBaris([]);
    setSupplierName('');
    setSupplierId(null);
    setStatus('lunas');
    setNote('');
    setKode('');
    setPesan(null);
    editSudahMulai.current = true;
    if (window.location.search.includes('edit=')) router.replace('/pembelian');
    inputRef.current?.focus();
  }

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
    const payload = {
      supplierName: supplierName.trim(),
      supplierId,
      status,
      items: baris.map((b) => ({
        productId: b.productId || null,
        name: b.name,
        qty: b.qty,
        cost: b.cost,
        unit: b.unit,
      })),
      note,
    };
    const r = editId
      ? await purchasesApi.update({ id: editId, ...payload })
      : await purchasesApi.create(payload);
    setBusy(false);
    if (!r.ok) {
      setPesan(r.error);
      return;
    }
    setPesan(
      editId
        ? `PO ${r.data.invoice_no ?? ''} diperbarui — total ${rupiah(r.data.total)}. Stok sudah disesuaikan dengan selisihnya.`
        : `Pembelian ${r.data.invoice_no ?? ''} disimpan — total ${rupiah(r.data.total)} (${r.data.status === 'hutang' ? 'Hutang' : 'Lunas'}). Stok sudah ditambah.`,
    );
    resetForm();
  }

  async function simpanBarangBaru() {
    if (!baru.name.trim()) {
      toast.error('Nama wajib', 'Isi nama barang dulu.');
      return;
    }
    const r = await productsApi.create({
      name: baru.name.trim(),
      category: baru.category.trim() || 'Umum',
      unit: baru.unit.trim() || 'Pcs',
      price: Number(baru.price) || 0,
      cost: Number(baru.cost) || 0,
      stock: Number(baru.stock) || 0,
      min_stock: 0,
      variants: [
        {
          satuan: baru.unit.trim() || 'Pcs',
          harga_beli: Number(baru.cost) || 0,
          harga_jual: Number(baru.price) || 0,
          konversi: 1,
        },
      ],
    });
    if (!r.ok) {
      toast.error('Gagal menambah barang', r.error);
      return;
    }
    setProducts((prev) => [...prev, r.data]);
    setBarangBaruOpen(false);
    setBaru({ name: '', category: 'Umum', unit: 'Pcs', price: '', cost: '', stock: '' });
    tambah(r.data);
    toast.ok('Barang ditambahkan', r.data.name);
  }

  /** Simpan supplier baru dari modal +, lalu langsung pilih di form. */
  async function simpanSupplier() {
    const name = supplierBaru.name.trim();
    if (!name) {
      toast.error('Nama wajib', 'Isi nama supplier dulu.');
      return;
    }
    await supplierGuard.guard(
      async () => {
        const r = await suppliersApi.create({
          name,
          phone: supplierBaru.phone,
          address: supplierBaru.address,
        });
        if (!r.ok) {
          toast.error('Gagal menambah supplier', r.error);
          return;
        }
        setSuppliers((prev) =>
          [...prev, r.data].sort((a, b) => a.name.localeCompare(b.name)),
        );
        setSupplierName(r.data.name);
        setSupplierId(r.data.id);
        setSupplierBaru({ name: '', phone: '', address: '' });
        setSupplierOpen(false);
        toast.ok('Supplier ditambahkan', r.data.name);
      },
      { pesanTunggu: 'Menyimpan supplier…' },
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {/* Header */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#d8e0ec] bg-[#f6f9fd] px-3 py-2">
        <Truck className="h-4 w-4 text-[#1b5fa8]" />
        <h1 className="text-[15px] font-bold text-[#1b3a5c]">
          {editId ? `Edit PO - ${editInvoice ?? editId.slice(0, 8)}` : 'Pembelian (PO Sederhana)'}
        </h1>
        <Link href="/pembelian/riwayat" className="rb-btn ml-1">
          <History className="h-3.5 w-3.5" /> Riwayat
        </Link>
        {editId ? (
          <span className="rounded-full bg-[#fff3bf] px-2 py-0.5 text-[10.5px] font-bold uppercase text-[#8a6d00]">
            Mode Edit
          </span>
        ) : null}

        <span className="ml-auto flex items-center gap-2 text-[11.5px] text-[#7a8ba0]">
          <b className="tnum text-[#35485c]">{baris.length}</b> baris · total{' '}
          <b className="tnum text-[#35485c]">{rupiah(total)}</b>
        </span>
        {editId ? (
          <button type="button" className="rb-btn" onClick={resetForm} disabled={busy}>
            <X className="h-3.5 w-3.5" /> Batal Edit
          </button>
        ) : null}
        <button
          type="button"
          disabled={busy || !baris.length || !supplierName.trim()}
          onClick={simpan}
          className="rb-btn-go"
          data-loading={busy}
        >
          {busy ? (editId ? 'Memperbarui…' : 'Menyimpan…') : editId ? 'Update PO' : 'Simpan PO'}
        </button>
      </div>

      {/* 2 panel: Kiri Search+SeringBeli | Kanan PO */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 md:flex-row">
        {/* KIRI */}
        <div className="flex min-w-0 flex-col gap-3 md:w-[380px] md:shrink-0">
          {/* Supplier */}
          <div className="rounded-md border border-[#d8e0ec] bg-white p-3">
            <label className="frm-label" htmlFor="cari-supplier">
              Supplier
            </label>
            <div className="flex gap-1.5">
              <select
                id="cari-supplier"
                className="frm-key min-w-0 flex-1 cursor-pointer"
                value={supplierName}
                onChange={(e) => {
                  const n = e.target.value;
                  setSupplierName(n);
                  setSupplierId(suppliers.find((s) => s.name === n)?.id ?? null);
                }}
              >
                <option value="">— pilih supplier —</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.name}>
                    {s.name}
                  </option>
                ))}
                {supplierName && !suppliers.some((s) => s.name === supplierName) ? (
                  <option value={supplierName}>{supplierName}</option>
                ) : null}
              </select>
              <button
                type="button"
                onClick={() => {
                  setSupplierBaru({ name: '', phone: '', address: '' });
                  setSupplierOpen(true);
                }}
                title="Tambah supplier baru"
                aria-label="Tambah supplier baru"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-[#cdd8e6] bg-white text-[15px] font-bold leading-none text-[#1b5fa8] transition hover:bg-[#e8f1fa]"
              >
                +
              </button>
            </div>
            {supplierName.trim() ? (
              <p className="mt-1 text-[10.5px] text-[#7a8ba0]">
                Harga modal utama diisi otomatis dari pembelian terakhir ke supplier ini.
              </p>
            ) : null}
          </div>

          {/* Search produk */}
          <div className="rounded-md border border-[#d8e0ec] bg-white p-3" ref={wrapRef}>
            <div className="mb-2 flex items-center justify-between">
              <label className="frm-label" htmlFor="cari-produk">
                Scan Barcode / Ketik Nama Barang
              </label>
              <span className="text-[10px] text-[#9fb0c4]">F2</span>
            </div>
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
              autoComplete="off"
              spellCheck={false}
              role="combobox"
              aria-expanded={saranTampil}
              aria-autocomplete="list"
              aria-controls="saran-pembelian"
            />

            {saranTampil ? (
              <ul id="saran-pembelian" role="listbox" className="ac-panel !static !max-h-[280px] !mt-2 !rounded-md !shadow-none">
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
                      <span className="ac-meta">
                        {supplierCostMap.has(p.id) ? rupiah(supplierCostMap.get(p.id)!) : rupiah(p.cost)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          {/* Tombol cepat */}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setRiwayatOpen(true);
                void muatRiwayat();
              }}
              className="rb-btn"
            >
              <ListChecks className="h-3.5 w-3.5" /> Riwayat Beli Terakhir
            </button>
            <button
              type="button"
              onClick={() => setBarangBaruOpen(true)}
              className="rb-btn"
            >
              <Sparkles className="h-3.5 w-3.5" /> + Tambah Barang Baru
            </button>
          </div>

          {/* Sering Beli */}
          {sering.length ? (
            <div className="rounded-md border border-[#d8e0ec] bg-white p-3">
              <h3 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-[#5b6b80]">
                Sering Beli
              </h3>
              <ul className="divide-y divide-[#eef2f7]">
                {sering.map((it, i) => (
                  <li key={`${it.product_id ?? it.product_name}-${i}`}>
                    <button
                      type="button"
                      onClick={() => tambahDariSering(it)}
                      className="flex w-full items-center justify-between px-2 py-2 text-left hover:bg-[#f6f9fd]"
                    >
                      <span className="flex items-center gap-2 truncate text-[13px]">
                        <PackageSearch className="h-4 w-4 text-zinc-400" />
                        <span className="truncate">{it.product_name}</span>
                      </span>
                      <span className="tnum text-[12px] text-[#5b6b80]">
                        {angka(it.qty)} · {rupiah(it.cost)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        {/* KANAN */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-auto rounded-md border border-[#d8e0ec] bg-white">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-[#f6f9fd]">
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
                {baris.map((b, i) => {
                  // Pilihan SATUAN di-filter ke satuan yang sudah di-link ke
                  // produk ini; kalau produknya tak dikenal, pakai master penuh.
                  const opsi = b.opsi.length ? b.opsi : opsiSatuan;
                  const nilai = opsi.includes(b.unit) ? b.unit : b.unit || opsi[0] || '';
                  return (
                  <tr key={b.productId + i} className="border-t border-zinc-100">
                    <td className="px-2 py-2 text-zinc-400">{i + 1}</td>
                    <td className="px-2 py-2 font-medium">{b.name}</td>
                    <td className="px-2 py-1">
                      <select
                        className="w-full cursor-pointer rounded-md border border-transparent bg-transparent px-1.5 py-1 text-zinc-600 transition hover:border-zinc-300 focus:border-[#1b5fa8] focus:bg-white"
                        value={nilai}
                        aria-label={`Satuan ${b.name}`}
                        onChange={(e) => ubah(i, { unit: e.target.value })}
                      >
                        {nilai && !opsi.includes(nilai) ? (
                          <option value={nilai}>{nilai}</option>
                        ) : null}
                        {opsi.map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-2">
                      <RupiahInput
                        value={b.cost}
                        onChange={(v) => ubah(i, { cost: Number(v) || 0 })}
                        ariaLabel={`Harga pokok ${b.name}`}
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
                  );
                })}
                {!baris.length ? (
                  <tr>
                    <td colSpan={7} className="px-2 py-6 text-center text-[12px] text-zinc-400">
                      Cari produk di kiri, atau pilih "Sering Beli" untuk menambah.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          {/* Footer kanan: Catatan + Total */}
          <div className="shrink-0 border-t border-[#d8e0ec] bg-white px-4 py-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="w-[150px] shrink-0">
                <label className="frm-label" htmlFor="status-bayar">
                  Pembayaran
                </label>
                <select
                  id="status-bayar"
                  className="frm-key cursor-pointer"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as PurchaseStatus)}
                >
                  <option value="lunas">Lunas</option>
                  <option value="hutang">Hutang</option>
                </select>
              </div>
              <div className="min-w-[180px] flex-1">
                <label className="frm-label" htmlFor="catatan">
                  Catatan
                </label>
                <input
                  id="catatan"
                  className="frm-key"
                  placeholder="Catatan / keterangan (opsional)"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
              <div className="text-right">
                <p className="text-[11px] uppercase text-zinc-400">Total Pembelian</p>
                <p className="text-[28px] font-extrabold text-[#1b3a5c]">{rupiah(total)}</p>
              </div>
            </div>
            {pesan ? <p className="mt-2 rounded-md bg-zinc-100 p-2 text-sm">{pesan}</p> : null}
          </div>
        </div>
      </div>

      {/* Modal Riwayat Beli Terakhir */}
      <Modal open={riwayatOpen} onClose={() => setRiwayatOpen(false)} title="Riwayat Beli Terakhir" width="max-w-2xl">
        {riwayatLoading ? (
          <p className="text-sm text-zinc-500">Memuat riwayat…</p>
        ) : riwayat.length === 0 ? (
          <p className="text-sm text-zinc-500">Belum ada riwayat pembelian.</p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {riwayat.map((p) => (
              <li key={p.id} className="flex items-center justify-between py-2">
                <div>
                  <p className="font-medium text-[13px]">{new Date(p.created_at).toLocaleString('id-ID')}</p>
                  <p className="text-[12px] text-zinc-500">{p.supplier_name} {p.note ? `· ${p.note}` : ''}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="tnum text-[13px] font-semibold">{rupiah(Number(p.total))}</span>
                  <button
                    type="button"
                    className="rb-btn"
                    onClick={() => pilihRiwayat(p)}
                  >
                    <RotateCcw className="h-3 w-3" /> Muat
                  </button>
                  <button
                    type="button"
                    className="rb-btn-primary"
                    title="Edit PO ini"
                    aria-label="Edit PO ini"
                    onClick={() => pilihRiwayat(p)}
                  >
                    <Pencil className="h-3 w-3" /> Edit
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Modal>

      {/* Modal + Tambah Barang Baru */}
      <Modal
        open={barangBaruOpen}
        onClose={() => setBarangBaruOpen(false)}
        title="Tambah Barang Baru"
        width="max-w-md"
        footer={
          <>
            <button type="button" className="btn-outline" onClick={() => setBarangBaruOpen(false)}>
              Batal
            </button>
            <button type="button" className="btn-primary" onClick={simpanBarangBaru}>
              Simpan & Masukkan
            </button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="label">Nama *</label>
            <input className="input" value={baru.name} onChange={(e) => setBaru({ ...baru, name: e.target.value })} />
          </div>
          <div>
            <label className="label">Kategori</label>
            <input className="input" value={baru.category} onChange={(e) => setBaru({ ...baru, category: e.target.value })} />
          </div>
          <div>
            <label className="label">Satuan</label>
            <select
              className="input cursor-pointer"
              value={baru.unit}
              aria-label="Satuan"
              onChange={(e) => setBaru({ ...baru, unit: e.target.value })}
            >
              {!opsiSatuan.includes(baru.unit) && baru.unit ? (
                <option value={baru.unit}>{baru.unit}</option>
              ) : null}
              {opsiSatuan.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-zinc-400">
              Diambil dari Pengaturan &gt; Satuan; tidak bisa diketik sendiri.
            </p>
          </div>
          <div>
            <label className="label">Modal (Rp)</label>
            <RupiahInput
              value={baru.cost}
              onChange={(v) => setBaru({ ...baru, cost: String(v) })}
              ariaLabel="Modal"
            />
          </div>
          <div>
            <label className="label">Harga Jual (Rp)</label>
            <RupiahInput
              value={baru.price}
              onChange={(v) => setBaru({ ...baru, price: String(v) })}
              ariaLabel="Harga Jual"
            />
          </div>
          <div>
            <label className="label">Stok Awal</label>
            <input type="number" className="input" value={baru.stock} onChange={(e) => setBaru({ ...baru, stock: e.target.value })} />
          </div>
        </div>
      </Modal>

      {/* Modal + Supplier Baru */}
      <Modal
        open={supplierOpen}
        onClose={() => setSupplierOpen(false)}
        title="Supplier Baru"
        width="max-w-md"
        footer={
          <>
            <button
              type="button"
              className="btn-outline"
              onClick={() => setSupplierOpen(false)}
              disabled={supplierGuard.busy}
            >
              Batal
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => void simpanSupplier()}
              disabled={!supplierBaru.name.trim() || supplierGuard.busy}
              data-loading={supplierGuard.busy}
            >
              {supplierGuard.busy ? 'Menyimpan…' : 'Simpan & Pilih'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="label" htmlFor="sup-nama">
              Nama Supplier *
            </label>
            <input
              id="sup-nama"
              className="input"
              value={supplierBaru.name}
              onChange={(e) => setSupplierBaru((p) => ({ ...p, name: e.target.value }))}
              placeholder="mis. PT Sumber Makmur"
              autoFocus
            />
          </div>
          <div>
            <label className="label" htmlFor="sup-hp">
              No HP
            </label>
            <TeleponInput
              id="sup-hp"
              className="input"
              value={supplierBaru.phone}
              onChange={(v) => setSupplierBaru((p) => ({ ...p, phone: v }))}
              placeholder="08xxxxxxxxxx"
            />
          </div>
          <div>
            <label className="label" htmlFor="sup-alamat">
              Alamat
            </label>
            <input
              id="sup-alamat"
              className="input"
              value={supplierBaru.address}
              onChange={(e) => setSupplierBaru((p) => ({ ...p, address: e.target.value }))}
              placeholder="Alamat supplier (opsional)"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
