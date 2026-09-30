'use client';

import * as React from 'react';
import {
  AlertTriangle,
  BookOpen,
  BookmarkPlus,
  CornerDownLeft,
  FilePlus2,
  List,
  Loader2,
  Lock,
  Pencil,
  Printer,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';

import { customersApi, nextInvoicePreview, productsApi, settingsApi, shiftsApi, transactionsApi } from '@/lib/api';
import { useCart } from '@/lib/cart-store';
import { useButtonGuard, useClickCooldown } from '@/lib/useButtonGuard';
import {
  angka,
  cariProdukByBarcodeVarian,
  cariVarian,
  gabungKeranjang,
  hitungKembali,
  hitungTotal,
  jumlahBaris,
  normalisasiVarian,
  parseRupiah,
  persenPotongan,
  potonganDariDefault,
  potonganDariPct,
  potonganEfektif,
  potonganMax,
  rupiah,
  satuanOptions,
} from '@/lib/format';
import {
  bacaDiskonPaten,
  dengarDiskonPaten,
  DISKON_PATEN_AWAL,
  labelStrukPaten,
  patenAdaNilai,
  patenBerlaku,
  ringkasanPaten,
  type DiskonPaten,
} from '@/lib/diskonPaten';
import { buildReceiptPreview, loadStoreMeta, type StoreMeta } from '@/lib/receipt';
import { useToast } from '@/components/Toast';
import { BigTotalDisplay } from '@/components/BigTotalDisplay';
import { Modal } from '@/components/Modal';
import { ModalBayar, type ShortcutBayar } from '@/components/ModalBayar';
import { ModalListBarang } from '@/components/ModalListBarang';
import { ModalPelanggan } from '@/components/ModalPelanggan';
import { ReceiptView } from '@/components/Receipt';
import { RupiahInput } from '@/components/RupiahInput';
import { ShiftModal } from '@/components/ShiftModal';
import {
  PAYMENT_METHOD_LABEL,
  type CartLine,
  type Customer,
  type CustomerInput,
  type DiscountType,
  type KasirShift,
  type PaymentMethod,
  type Product,
  type ReceiptData,
} from '@/lib/types';

/** Baris kosong sebagai penutup grid — ala iPOS. */
const KOSONG_SAMPAI = 8;

/** Maksimal saran autocomplete di bawah kolom Kode Item. */
const MAX_SARAN = 10;

/**
 * Potongan baris saat harga/qty/satuan berubah:
 * mode "%" -> diskon = min(pct,100)% dari subtotal baris baru;
 * mode "Rp" -> potongan dikunci ke harga x qty (tak pernah lebih).
 */
function potonganAuto(l: CartLine): number {
  return l.potonganPct != null ? potonganDariPct(l, l.potonganPct) : potonganEfektif(l);
}

const PENDING_KEY = 'kasirpro.pending.v1';

type Pending = {
  id: string;
  note: string;
  at: string;
  customer: string;
  lines: CartLine[];
  diskonTipe?: DiscountType;
  diskonNilai?: number;
};

/* ------------------------------ komponen ------------------------------ */

function RbBtn({
  kbd,
  label,
  onClick,
  disabled,
  tone = 'default',
  Icon,
}: {
  kbd?: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'default' | 'danger';
  Icon?: React.ElementType;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={tone === 'danger' ? 'rb-btn-danger' : 'rb-btn'}
    >
      {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
      {label}
      {kbd ? <span className="kbd">{kbd}</span> : null}
    </button>
  );
}

/* --------------------------------------------------------------------- */

export default function KasirScreen() {
  const toast = useToast();
  const cart = useCart();
  // Kunci tombol Simpan Transaksi agar satu klik = satu transaksi.
  // Cooldown 2 detik (sesuai permintaan) supaya tidak bisa diklik berulang.
  const bayarGuard = useButtonGuard(2000);
  const pendingGuard = useButtonGuard();
  // Kunci tombol UI (buka modal, pindah fokus, cetak) 1,5 detik tanpa spinner.
  const ui = useClickCooldown(1500);
  const { lines, setLines, itemQty, setItemQty, customer, setCustomer } = cart;
  const { sales, setSales, keterangan, setKeterangan } = cart;

  /* ------------------------------ header ------------------------------ */
  const [store, setStore] = React.useState<StoreMeta>({
    name: 'Toko',
    address: '',
    phone: '',
    cashier: 'Kasir',
  });
  const [cashier, setCashier] = React.useState('Kasir');
  const [tanggal, setTanggal] = React.useState('');
  const [invoiceNo, setInvoiceNo] = React.useState('INV-…');
  const [customers, setCustomers] = React.useState<Customer[]>([]);

  /* ------------------------------ item entry -------------------------- */
  const [products, setProducts] = React.useState<Product[]>([]);
  const [produkDimuat, setProdukDimuat] = React.useState(false);
  /** Resolver penanda daftar produk sudah selesai dimuat. */
  const produkSiapRef = React.useRef<(() => void) | null>(null);
  const produkSiap = React.useCallback(
    () =>
      new Promise<void>((selesai) => {
        produkSiapRef.current = selesai;
      }),
    [],
  );
  const [itemCode, setItemCode] = React.useState('');
  const [activeRow, setActiveRow] = React.useState<number | null>(null);
  const [zone, setZone] = React.useState<'header' | 'detail'>('header');

  const codeRef = React.useRef<HTMLInputElement>(null);
  const qtyRef = React.useRef<HTMLInputElement>(null);
  const wrapSaranRef = React.useRef<HTMLDivElement>(null);

  /* ------------------------------ autocomplete ------------------------ */
  const [saran, setSaran] = React.useState<Product[]>([]);
  const [saranTampil, setSaranTampil] = React.useState(false);
  const [saranIdx, setSaranIdx] = React.useState(0);

  /* ------------------------------ pembayaran -------------------------- */
  const [payOpen, setPayOpen] = React.useState(false);
  const [method, setMethod] = React.useState<PaymentMethod>('cash');
  /** Nominal yang diketik user di field Bayar (string mentah; diformat ribuan). */
  const [bayarTeks, setBayarTeks] = React.useState('');
  /** Catatan tambahan dari modal bayar (digabung ke keterangan saat simpan). */
  const [catatanModal, setCatatanModal] = React.useState('');

  /* ------------------------------ pending ----------------------------- */
  const [pending, setPending] = React.useState<Pending[]>([]);
  const [savePendOpen, setSavePendOpen] = React.useState(false);
  const [pendNote, setPendNote] = React.useState('');
  const [pendListOpen, setPendListOpen] = React.useState(false);

  /* ------------------------------ modal ------------------------------- */
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [listBarangOpen, setListBarangOpen] = React.useState(false);
  const [tambahPlgOpen, setTambahPlgOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [success, setSuccess] = React.useState<{ receipt: ReceiptData; change: number } | null>(null);
  const [autoPrint, setAutoPrint] = React.useState(true);

  /* ------------------------------ shift kasir ------------------------ */
  // Shift aktif (null = belum/tidak sedang shift). Transaksi tersimpan dicatat
  // ke shift ini (shift_id) — laporan per kasir & hitung kas saat tutup.
  const [shift, setShift] = React.useState<KasirShift | null>(null);
  const [shiftModalOpen, setShiftModalOpen] = React.useState(false);
  /** Perkiraan kas dari RPC `kasir_shift_preview` (tampil di modal tutup). */
  const [shiftExpected, setShiftExpected] = React.useState<number | null>(null);
  const shiftGuard = useButtonGuard();

  /* ------------------ diskon default (isi kolom Potongan) -------------- */
  // 'fixed' (Rp) atau 'percent' (%). Nilai ini TIDAL dipotong di level total
  // transaksi — ia hanya mengisi kolom POTONGAN tiap item yang baru masuk
  // keranjang, jadi kasir tak perlu edit manual kolom itu lagi.
  const [diskonTipe, setDiskonTipe] = React.useState<'fixed' | 'percent'>('fixed');
  const [diskonNilai, setDiskonNilai] = React.useState<number>(0);
  // Kolom POTONGAN di tabel mengikuti mode diskon header (satu toggle untuk
  // form atas & tabel), sehingga nilai yang tampil selalu dalam satuan yang
  // sedang diketik kasir.
  const modePotongan: 'rp' | 'pct' = diskonTipe === 'percent' ? 'pct' : 'rp';

  /* ------------------- diskon paten (dikunci dari Pengaturan) ----------- */
  // Owners toko bisa menetapkan diskon tetap di Pengaturan > Diskon. Kalau
  // aktif, form "Diskon Item" di bawah terkunci (badge "Paten dari Setting")
  // dan kolom Potongan tiap item baru langsung terisi nilai paten.
  const [paten, setPaten] = React.useState<DiskonPaten>(DISKON_PATEN_AWAL);
  // Ref supaya resetForm & aset tombol tak perlu bergantung pada config.
  const patenRef = React.useRef<DiskonPaten>(DISKON_PATEN_AWAL);
  patenRef.current = paten;
  /** Terapkan config paten ke form Diskon: aktif -> terkunci, nonaktif -> 0. */
  const terapkanPaten = React.useCallback((c: DiskonPaten) => {
    if (c.aktif) {
      setDiskonTipe(c.tipe === 'pct' ? 'percent' : 'fixed');
      setDiskonNilai(c.tipe === 'pct' ? Math.min(Math.max(Math.floor(c.nilai), 0), 100) : Math.max(c.nilai, 0));
    } else {
      setDiskonTipe('fixed');
      setDiskonNilai(0);
    }
  }, []);

  const flashTimer = React.useRef<number | null>(null);
  const [flashKey, setFlashKey] = React.useState<string | null>(null);

  // Baca config paten saat mount lalu ikuti perubahannya dari Pengaturan —
  // kasir tak perlu reload, dan mematikan paten langsung mengembalikan form
  // ke mode manual (nilai 0).
  React.useEffect(() => {
    const awal = bacaDiskonPaten();
    setPaten(awal);
    terapkanPaten(awal);
    return dengarDiskonPaten((c) => {
      setPaten(c);
      terapkanPaten(c);
    });
  }, [terapkanPaten]);

  /* ------------------------------ turunan ----------------------------- */
  const totals = hitungTotal(lines);
  const subtotalKotor = React.useMemo(() => lines.reduce((s, l) => s + l.price * l.qty, 0), [lines]);
  // Potongan sekarang flat per baris (bukan per satuan).
  const totalPotongan = totals.potonganBaris;
  const totalTagihan = totals.total;
  // Ada baris dengan potongan > harga x qty (ketikan terakhir belum dikunci)
  // atau persen potongan > 100 (mode %). Saat begini: border merah + helper
  // "Max: …", dan Simpan Transaksi dikunci.
  const potonganBarisTidakSah = React.useMemo(
    () =>
      lines.some(
        (l) =>
          (Number(l.discount) || 0) > potonganMax(l) ||
          (l.potonganPct != null && l.potonganPct > 100),
      ),
    [lines],
  );
  // Ringkasan diskon default yang sedang aktif, buat info di bawah input.
  const labelDiskonDefault =
    diskonNilai > 0
      ? diskonTipe === 'percent'
        ? `${Math.min(Math.floor(diskonNilai), 100)}% per item baru`
        : `${rupiah(diskonNilai)} per item baru`
      : '';
  // Paten aktif = form Diskon terkunci; teks badge di bawah input.
  const patenHidup = paten.aktif;
  const ringkasanPatenHeader = patenHidup ? ringkasanPaten(paten) : '';
  const diskonTidakSah = potonganBarisTidakSah;
  const isTunai = method === 'cash';
  const bayarNominal = parseRupiah(bayarTeks) || 0;
  // Tunai: Kembalian = Bayar - Total (Bayar boleh lebih/tepat).
  // Transfer/QRIS: Bayar otomatis = Total, Kembalian selalu 0.
  const { kurang, kembalian, bayarAkhir } = React.useMemo(() => {
    if (!isTunai) return { kurang: 0, kembalian: 0, bayarAkhir: totalTagihan };
    const kurang = Math.max(0, totalTagihan - bayarNominal);
    return { kurang, kembalian: hitungKembali(totalTagihan, bayarNominal), bayarAkhir: bayarNominal };
  }, [isTunai, totalTagihan, bayarNominal]);
  const rugiLines = lines.filter((l) => l.price < l.cost);

  /* ------------------------------ memuat data ------------------------- */
  React.useEffect(() => {
    setTanggal(new Date().toISOString().slice(0, 10));
    void (async () => {
      const [storeRes, pRes, cRes, invRes] = await Promise.all([
        loadStoreMeta('Toko'),
        productsApi.list(''),
        customersApi.list(),
        nextInvoicePreview(),
      ]);
      setStore(storeRes);
      setCashier(storeRes.cashier || 'Kasir');
      if (pRes.ok) setProducts(pRes.data);
      setProdukDimuat(true);
      produkSiapRef.current?.();
      produkSiapRef.current = null;
      if (cRes.ok && cRes.data.length) setCustomers(cRes.data);
      setInvoiceNo(invRes);
    })();
    void settingsApi.get<boolean>('autoPrint', true).then((v) => setAutoPrint(v !== false));
    // Shift aktif (jika ada) ikut dimuat saat halaman kasir dibuka.
    void shiftsApi.active().then((res) => {
      if (res.ok) setShift(res.data);
    });
  }, []);

  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PENDING_KEY);
      if (raw) setPending(JSON.parse(raw) as Pending[]);
    } catch {
      /* abaikan pending yang rusak */
    }
  }, []);

  const simpanPending = React.useCallback((list: Pending[]) => {
    setPending(list);
    try {
      window.localStorage.setItem(PENDING_KEY, JSON.stringify(list));
    } catch {
      /* penyimpanan penuh / diblokir */
    }
  }, []);

  React.useEffect(() => {
    if (success && autoPrint) {
      const t = window.setTimeout(() => window.print(), 450);
      return () => window.clearTimeout(t);
    }
  }, [success, autoPrint]);

  /* ------------------------------ aksi item --------------------------- */
  const fokusKode = React.useCallback(() => {
    setZone('header');
    setSaranTampil(false);
    codeRef.current?.focus();
    codeRef.current?.select();
  }, []);

  const kilat = React.useCallback((id: string) => {
    setFlashKey(id);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlashKey(null), 700);
  }, []);

  React.useEffect(() => () => {
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
  }, []);

  /**
   * Masukkan satu produk ke keranjang.
   * `satuanAwal` dipakai saat barcode yang dipindai milik satuan non-dasar
   * (mis. barcode Dus) supaya baris langsung memakai harga varian itu.
   *
   * Potongan baris langsung diisi dari "Diskon" form header: Rp 500 -> setiap
   * item baru masuk dengan Potongan 500, % 10 -> 10% dari harga x qty. Nilai
   * dibatasi ke harga x qty sehingga baris tak pernah jadi minus. Baris yang
   * SUDAH ada di tabel tidak ikut berubah saat kasir mengubah diskon header.
   *
   * Kalau Diskon Paten aktif, cakupannya yang menentukan: produk di luar
   * cakupan (mis. kategori lain) masuk dengan Potongan 0.
   */
  function masukkanProduk(p: Product, qty?: number, satuanAwal?: string) {
    const units = satuanOptions(p);
    const varian = normalisasiVarian(p.variants);
    const v0 = satuanAwal ? cariVarian(varian, satuanAwal) : varian[0];
    const satuan = satuanAwal && units.some((u) => u.toLowerCase() === satuanAwal.toLowerCase())
      ? satuanAwal
      : (v0?.satuan ?? units[0] ?? p.unit);
    const harga = v0 ?? { harga_jual: p.price, harga_beli: p.cost };
    const q = Math.max(1, Math.floor(qty ?? itemQty) || 1);
    const nilaiBaris = { price: harga.harga_jual, qty: q };

    // Diskon Paten: kalau produk ini di luar cakupan, baris masuk tanpa
    // potongan (nilai 0) walau form diskonnya terisi.
    const dariPaten = patenAdaNilai(paten) && patenBerlaku(paten, p);
    const nilaiSeed = dariPaten ? diskonNilai : 0;

    setLines((prev) =>
      gabungKeranjang(prev, {
        product_id: p.id,
        barcode: p.barcode,
        name: p.name,
        price: harga.harga_jual,
        cost: harga.harga_beli,
        qty: q,
        discount: potonganDariDefault(nilaiBaris, diskonTipe, nilaiSeed),
        // Mode %: simpan persennya supaya kolom tabel menampilkan satuan yang
        // sama (dan tetap ikut terhitung ulang saat qty/harga berubah).
        potonganPct:
          dariPaten && modePotongan === 'pct' && nilaiSeed > 0
            ? Math.min(100, Math.max(0, Math.floor(diskonNilai)))
            : null,
        // Struk item ini menulis label paten, bukan "Pot/Diskon" biasa.
        potonganLabel: dariPaten ? labelStrukPaten(paten) : null,
        unit: satuan,
        satuanList: units,
        variants: varian,
        stock: p.stock,
      }),
    );
    kilat(p.id);
  }

  /** Tambah satu baris dari Kode Item. true = sukses. */
  /** Cari produk berdasarkan kode/barcode/nama. null = tidak ditemukan. */
  async function cariProduk(code: string): Promise<Product | undefined> {
    const q = code.trim();
    if (!q) return undefined;
    const lower = q.toLowerCase();

    // Daftar produk masih dimuat? Tunggu dulu — tanpa itu barcode satuan
    // (mis. barcode Dus) tidak akan ketemu karena hanya ada di tabel varian.
    if (!produkDimuat && products.length === 0) await produkSiap();

    // 1. Barcode produk (paling sering: scanner).
    let p = products.find((x) => (x.barcode ?? '').toLowerCase() === lower);

    // 2. Barcode satuan dari tabel varian (mis. barcode Dus).
    if (!p) {
      const owner = cariProdukByBarcodeVarian(products, q);
      if (owner) p = products.find((x) => x.id === owner);
    }

    // 3. Tanya server (produk belum dimuat / barcode satuan).
    if (!p) {
      const byBarcode = await productsApi.findByBarcode(q);
      if (byBarcode.ok && byBarcode.data) p = byBarcode.data;
    }

    // 4. Nama persis, lalu nama memuat kata kunci.
    if (!p) {
      const byName = products.filter((x) => x.name.toLowerCase() === lower);
      if (byName.length === 1) p = byName[0];
    }
    if (!p) {
      const cocok = products.filter(
        (x) => x.name.toLowerCase().includes(lower) || (x.barcode ?? '').toLowerCase().includes(lower),
      );
      if (cocok.length === 1) p = cocok[0];
    }

    return p;
  }

  async function tambahBaris(): Promise<boolean> {
    const code = itemCode.trim();
    if (!code) return false;

    const qty = Math.max(1, Math.floor(Number(itemQty) || 1));

    const p = await cariProduk(code);
    if (!p) {
      toast.info('Item tidak ditemukan', `"${code}" tidak ada di master barang. Tekan F10 untuk Cari Barang.`);
      return false;
    }

    // Barcode yang dipindai boleh milik satuan non-dasar: tetapkan satuan itu.
    const varianScan = normalisasiVarian(p.variants).find(
      (v) => (v.barcode ?? '').toLowerCase() === code.toLowerCase(),
    );
    masukkanProduk(p, qty, varianScan?.satuan);
    setItemCode('');
    setSaran([]);
    setSaranTampil(false);
    return true;
  }

  /* ------------------------- autocomplete (debounce) ------------------ */
  React.useEffect(() => {
    const key = itemCode.trim().toLowerCase();
    if (!key) {
      setSaran([]);
      setSaranTampil(false);
      return;
    }
    // Saran hanya bila belum ada hasil scan barcode persis (scan tidak perlu saran).
    const exact = products.some((x) => (x.barcode ?? '').toLowerCase() === key);
    if (exact) {
      setSaran([]);
      setSaranTampil(false);
      return;
    }
    const t = window.setTimeout(() => {
      const hasil = products
        .filter(
          (p) =>
            p.is_active !== false &&
            (p.name.toLowerCase().includes(key) || (p.barcode ?? '').toLowerCase().includes(key)),
        )
        .slice(0, MAX_SARAN);
      setSaran(hasil);
      setSaranIdx(0);
      setSaranTampil(hasil.length > 0);
    }, 200);
    return () => window.clearTimeout(t);
  }, [itemCode, products]);

  // Klik di luar menutup daftar saran.
  React.useEffect(() => {
    if (!saranTampil) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapSaranRef.current?.contains(e.target as Node)) setSaranTampil(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [saranTampil]);

  function pilihSaran(p: Product) {
    masukkanProduk(p);
    setItemCode('');
    setSaran([]);
    setSaranTampil(false);
    setItemQty(1);
    codeRef.current?.focus();
  }

  /** Enter di Kode Item: kosong -> pindah ke Jumlah (alur iPOS). */
  async function onKodeEnter(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown' && saranTampil) {
      e.preventDefault();
      setSaranIdx((i) => Math.min(i + 1, saran.length - 1));
      return;
    }
    if (e.key === 'ArrowUp' && saranTampil) {
      e.preventDefault();
      setSaranIdx((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Escape' && saranTampil) {
      e.preventDefault();
      setSaranTampil(false);
      return;
    }
    if (e.key !== 'Enter') return; // jangan bekuk ketikan huruf/barcode
    e.preventDefault();

    if (!itemCode.trim()) {
      setZone('detail');
      qtyRef.current?.focus();
      qtyRef.current?.select();
      return;
    }
    // Enter saat ada saran: ambil yang sedang disorot.
    if (saranTampil && saran[saranIdx]) {
      pilihSaran(saran[saranIdx]!);
      return;
    }
    if (await tambahBaris()) {
      setItemQty(1);
      setZone('header');
      codeRef.current?.focus();
    }
  }

  function onQtyEnter(e: React.KeyboardEvent) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    setZone('header');
    codeRef.current?.focus();
  }

  function onItemChange(e: React.ChangeEvent<HTMLInputElement>) {
    setItemCode(e.target.value);
  }

  /* ------------------------------ edit baris -------------------------- */
  const ubahQty = React.useCallback((i: number, qty: number) => {
    setLines((prev) => {
      const l = prev[i];
      if (!l) return prev;
      const copy = [...prev];
      const next = Math.max(1, Math.floor(Number(qty) || 1));
      const q = typeof l.stock === 'number' ? Math.min(next, Math.max(1, l.stock)) : next;
      // Qty mengecil -> potongan ikut dibatasi ke harga x qty baru (atau tetap %).
      copy[i] = { ...l, qty: q, discount: potonganAuto({ ...l, qty: q }) };
      return copy;
    });
  }, []);

  const ubah = React.useCallback((i: number, patch: Partial<CartLine>) => {
    setLines((prev) => {
      const l = prev[i];
      if (!l) return prev;
      const next = { ...l, ...patch };
      // Harga berubah -> potongan otomatis dibatasi ke harga x qty baru (atau tetap %).
      if ('price' in patch) next.discount = potonganAuto(next);
      const copy = [...prev];
      copy[i] = next;
      return copy;
    });
  }, []);

  /**
   * Ketik Potongan di tabel keranjang (mode Rp).
   * Nilai mentah disimpan dulu (supaya border merah + helper "Max: …" muncul
   * saat melebihi harga x qty), lalu dikunci jadi nilai sah saat blur/Enter.
   * `potonganPct` dibuang: nominal yang diketik kasir yang berlaku, sehingga
   * perubahan qty/harga berikutnya tidak ikut memakai persen lama.
   */
  const ubahPotongan = React.useCallback(
    (i: number, diskon: number) => {
      const l = lines[i];
      if (!l) return;
      const d = Math.max(0, Number(diskon) || 0);
      const max = potonganMax(l);
      // Toast sekali saja saat baru MELEWATI batas, bukan tiap ketikan.
      if (d > max && (Number(l.discount) || 0) <= max) {
        toast.error('Potongan melebihi subtotal item', `${l.name}: maksimal Rp ${rupiah(max)}`);
      }
      setLines((prev) => {
        const cur = prev[i];
        if (!cur) return prev;
        const copy = [...prev];
        copy[i] = { ...cur, discount: d, potonganPct: null };
        return copy;
      });
    },
    [lines, toast],
  );

  /** Kunci potongan ke nilai sah (min(discount, harga x qty)) saat blur. */
  const komitPotongan = React.useCallback((i: number) => {
    setLines((prev) => {
      const cur = prev[i];
      if (!cur) return prev;
      const d = potonganEfektif(cur);
      if (d === cur.discount) return prev;
      const copy = [...prev];
      copy[i] = { ...cur, discount: d };
      return copy;
    });
  }, []);

  /**
   * Ketik Potongan % (mode %): simpan mentah + diskon = min(pct,100)% dari subtotal.
   */
  const ubahPotonganPct = React.useCallback(
    (i: number, pct: number) => {
      const l = lines[i];
      if (!l) return;
      const p = Math.max(0, Number(pct) || 0);
      // Toast sekali saat baru MELEWATI 100%, bukan tiap ketikan.
      if (p > 100 && (l.potonganPct ?? 0) <= 100) {
        toast.error('Potongan maksimal 100%', `${l.name}: potongan per item tak boleh lebih dari 100%.`);
      }
      setLines((prev) => {
        const cur = prev[i];
        if (!cur) return prev;
        const copy = [...prev];
        copy[i] = { ...cur, potonganPct: p, discount: potonganDariPct(cur, p) };
        return copy;
      });
    },
    [lines, toast],
  );

  /**
   * Kunci % ke 0..100 saat blur/Enter (diskon ikut dikunci ke 100% maksimum).
   * Baris yang potongannya masih nominal (diisi dari diskon Rp / hasil scan)
   * belum punya `potonganPct`; persen yang ditampilkan di layar diturunkan dari
   * nominal itu, jadi blur tanpa mengetik TIDAK boleh menghapus potongannya.
   */
  const komitPotonganPct = React.useCallback((i: number) => {
    setLines((prev) => {
      const cur = prev[i];
      if (!cur) return prev;
      const dariPct = cur.potonganPct != null;
      const pct = Math.min(
        Math.max(0, Math.floor(cur.potonganPct ?? persenPotongan(cur) ?? 0)),
        100,
      );
      const next = {
        ...cur,
        potonganPct: pct || null,
        // Nominal yang sudah ada dipertahankan (bukan dibulatkan ulang dari
        // persen) supaya blur tidak mengubah uang yang dipotong.
        discount: dariPct ? potonganDariPct(cur, pct) : cur.discount,
      };
      if (next.potonganPct === cur.potonganPct && next.discount === cur.discount) return prev;
      const copy = [...prev];
      copy[i] = next;
      return copy;
    });
  }, []);

  /**
   * Ganti mode diskon (Rp / %) pada form header. Sekaligus mengganti satuan
   * kolom POTONGAN di tabel, karena keduanya satu toggle. Nilai direset ke 0
   * supaya tidak salah baca sisa nominal jadi persen.
   * Baris yang sudah ada di tabel TIDAK diubah — nominalnya tetap.
   */
  const pilihDiskonTipe = React.useCallback((t: 'fixed' | 'percent') => {
    setDiskonTipe(t);
    setDiskonNilai(0);
  }, []);

  /**
   * Kunci nilai diskon saat blur/Enter: minimal 0, persen maksimal 100.
   * Nominal TIDAK dibatasi ke subtotal keranjang — diskon sering diketik dulu
   * (sebelum barang di-scan) dan otomatis dipotong ke harga x qty per baris.
   */
  const komitDiskonDefault = React.useCallback(() => {
    setDiskonNilai((prev) => {
      const v = Math.max(0, Math.floor(Number(prev) || 0));
      return diskonTipe === 'percent' ? Math.min(v, 100) : v;
    });
  }, [diskonTipe]);

  /** Ganti satuan: H. Jual & H. Pokok ikut berubah sesuai varian satuan itu. */
  const ubahSatuan = React.useCallback((i: number, satuan: string) => {
    setLines((prev) => {
      const l = prev[i];
      if (!l) return prev;
      const v = cariVarian(l.variants, satuan);
      const copy = [...prev];
      copy[i] = v
        ? {
            ...l,
            unit: v.satuan,
            price: v.harga_jual,
            cost: v.harga_beli,
            barcode: v.barcode || l.barcode,
            discount: potonganAuto({ ...l, price: v.harga_jual, qty: l.qty }),
          }
        : { ...l, unit: satuan };
      return copy;
    });
  }, []);

  const hapusBaris = React.useCallback((i: number) => {
    setLines((prev) => prev.filter((_, x) => x !== i));
  }, []);

  /* ------------------------------ transaksi --------------------------- */
  const { resetCart } = cart;
  const resetForm = React.useCallback(() => {
    resetCart();
    setItemCode('');
    setItemQty(1);
    setActiveRow(null);
    setSaran([]);
    setSaranTampil(false);
    setPayOpen(false);
    setMethod('cash');
    setBayarTeks('');
    setCatatanModal('');
    // Transaksi selesai -> diskon manual kembali 0, TAPI kalau Diskon Paten
    // aktif nilainya langsung dipasang lagi (bukan 0) supaya kasir tak perlu
    // menyetel ulang tiap pelanggan.
    terapkanPaten(patenRef.current);
    void nextInvoicePreview().then(setInvoiceNo);
    setTimeout(fokusKode, 30);
  }, [resetCart, fokusKode, terapkanPaten]);

  function simpanPendingSekarang() {
    if (!lines.length) return;
    if (pendingGuard.busy) {
      toast.info('Mohon tunggu…', 'Sedang menyimpan pending.');
      return;
    }
    void pendingGuard.guard(
      () => {
        const p: Pending = {
          id: `${Date.now()}`,
          note: pendNote.trim() || `${totals.itemCount} item — ${rupiah(totals.total)}`,
          at: new Date().toLocaleString('id-ID'),
          customer,
          lines,
          diskonTipe,
          diskonNilai,
        };
        simpanPending([p, ...pending]);
        setSavePendOpen(false);
        setPendNote('');
        resetForm();
        toast.ok('Disimpan sebagai pending', p.note);
        return true;
      },
      {
        cooldownMs: 1500,
        pesanTunggu: 'Sedang menyimpan pending…',
        onBlocked: (pesan) => toast.info('Mohon tunggu…', pesan),
      },
    );
  }

  function lanjutPending(p: Pending) {
    setLines(p.lines);
    setCustomer(p.customer);
    // Paten adalah aturan toko yang terkunci — kalau aktif, Snapshot diskon
    // pending tak boleh menimpanya (formnya terkunci, jadi tak bisa diubah).
    if (!patenRef.current.aktif) {
      if (p.diskonTipe === 'percent' || p.diskonTipe === 'fixed') setDiskonTipe(p.diskonTipe);
      if (typeof p.diskonNilai === 'number') setDiskonNilai(p.diskonNilai);
    }
    setPendListOpen(false);
    setTimeout(fokusKode, 30);
    toast.info('Pending dilanjutkan', p.note);
  }

  function hapusPending(id: string) {
    simpanPending(pending.filter((p) => p.id !== id));
  }

  /** Buka modal pembayaran. State disetel ulang tiap kali dibuka. */
  function bukaBayar() {
    if (!lines.length) return;
    if (bayarGuard.busy || saving) {
      toast.info('Mohon tunggu…', 'Transaksi sedang diproses.');
      return;
    }
    setMethod('cash');
    setBayarTeks('');
    setCatatanModal('');
    setPayOpen(true);
  }

  /** Pilih kartu metode: Tunai, Transfer, atau QRIS. */
  function pilihMetode(m: PaymentMethod) {
    setMethod(m);
    // Transfer / QRIS: Bayar otomatis = total tagihan (kembalian 0).
    if (m !== 'cash') setBayarTeks(String(totalTagihan));
    else setBayarTeks('');
  }

  /** Tombol pintasan nominal Bayar: Uang Pas / 50rb / 100rb / +10rb / +50rb. */
  function shortcutBayar(s: ShortcutBayar) {
    switch (s) {
      case 'pas':
        setBayarTeks(String(totalTagihan));
        break;
      case '50':
        setBayarTeks('50000');
        break;
      case '100':
        setBayarTeks('100000');
        break;
      case '+10':
        setBayarTeks(String(bayarNominal + 10000));
        break;
      case '+50':
        setBayarTeks(String(bayarNominal + 50000));
        break;
    }
  }

  /** Tombol Simpan Transaksi: tolak klik ganda, kurang, keranjang kosong, potongan liar. */
  function klikSimpanTransaksi() {
    if (!lines.length) return;
    if (bayarGuard.busy) {
      toast.info('Mohon tunggu…', 'Transaksi sedang diproses.');
      return;
    }
    if (diskonTidakSah) {
      toast.error(
        'Diskon tidak boleh melebihi subtotal',
        'Periksa kolom Diskon/Potongan, lalu tekan Tab/Enter agar nilainya dikunci.',
      );
      return;
    }
    if (kurang > 0) {
      toast.error('Pembayaran belum lunas', `Kurang ${rupiah(kurang)}.`);
      return;
    }
    void bayarGuard.guard(bayar, {
      cooldownMs: 2000,
      pesanTunggu: 'Transaksi sedang diproses…',
      onBlocked: (pesan) => toast.info('Mohon tunggu…', pesan),
    });
  }

  async function bayar() {
    if (!lines.length) return;
    if (diskonTidakSah) {
      toast.error(
        'Diskon tidak boleh melebihi subtotal',
        'Periksa kolom Diskon/Potongan di tabel keranjang.',
      );
      return;
    }
    if (kurang > 0) {
      toast.error('Pembayaran belum lunas', `Kurang ${rupiah(kurang)}.`);
      return;
    }

    setSaving(true);
    try {
      // API tidak punya kolom sales, jadi digabung ke keterangan
      // (ala iPOS: Sales & Keterangan) + Catatan dari modal bayar.
      const catatan = [
        sales.trim() ? `Sales: ${sales.trim()}` : '',
        keterangan.trim(),
        catatanModal.trim(),
      ]
        .filter(Boolean)
        .join(' — ');

      // Jaga-jaga: potongan tiap baris dikunci ke nilai sah (harga x qty)
      // agar tidak ada baris bernilai minus yang tersimpan ke database.
      // Field UI potonganPct (mode %) & potonganLabel (Diskon Paten) dibuang
      // sebelum dikirim ke API/RPC — keduanya tidak ada kolomnya di database.
      const linesAman = lines.map((l) => {
        const { potonganPct: _pct, potonganLabel: _label, ...rest } = l;
        return { ...rest, discount: potonganEfektif(l) };
      });

      const res = await transactionsApi.create({
        lines: linesAman,
        // Diskon sudah dipotong per baris (kolom POTONGAN), jadi transaksi
        // ini tidak punya diskon level transaksi — supaya tidak terpotong dua
        // kali. Nominal potongannya tersimpan di tiap item.
        discountType: 'none',
        discountValue: 0,
        paymentMethod: method,
        paid: bayarAkhir,
        note: catatan || null,
        cashierName: cashier,
        customerName: customer,
        shiftId: shift?.id,
      });

      if (!res.ok) {
        toast.error('Transaksi gagal', res.error);
        return;
      }

      const tx = res.data.transaction;
      const receipt = buildReceiptPreview({
        invoiceNo: tx.invoice_no,
        store,
        // Struk memakai keranjang asli (bukan `linesAman`) supaya persen
        // potongan mode % ikut terbawa — `linesAman` sudah dibuang field itu.
        lines,
        subtotal: totals.subtotal,
        discountAmount: totalPotongan,
        total: totalTagihan,
        paid: bayarAkhir,
        changeDue: kembalian,
        paymentMethod: PAYMENT_METHOD_LABEL[method],
        note: catatan || null,
      });

      setSuccess({ receipt, change: kembalian });
      resetForm();

      const pRes = await productsApi.list('');
      if (pRes.ok) setProducts(pRes.data);
      setProdukDimuat(true);
      produkSiapRef.current?.();
      produkSiapRef.current = null;
      setInvoiceNo(await nextInvoicePreview());
    } finally {
      setSaving(false);
    }
  }

  async function simpanPelanggan(input: CustomerInput) {
    const res = await customersApi.add(input);
    if (!res.ok) throw new Error(res.error);
    const list = await customersApi.list();
    if (list.ok) setCustomers(list.data);
    setCustomer(res.data.name);
    toast.ok('Pelanggan ditambahkan', res.data.name);
  }

  /* ------------------------------ shift kasir ------------------------ */
  /** Buka modal shift; saat ada shift aktif, ambil dulu perkiraan kasnya. */
  function bukaShiftModal() {
    setShiftExpected(null);
    setShiftModalOpen(true);
    if (shift) {
      void shiftsApi.preview(shift.id).then((res) => {
        if (res.ok) setShiftExpected(res.data.expected);
      });
    }
  }

  /** Konfirmasi buka shift (modal awal > 0). */
  function bukaShift(openingCash: number) {
    void shiftGuard.guard(
      async () => {
        const res = await shiftsApi.open(cashier, openingCash);
        if (!res.ok) {
          toast.error('Gagal buka shift', res.error);
          return;
        }
        setShift(res.data);
        setShiftModalOpen(false);
        toast.ok('Shift dibuka', `${res.data.shift_no} — kasir ${res.data.cashier_name}`);
      },
      { pesanTunggu: 'Membuka shift…' },
    );
  }

  /** Konfirmasi tutup shift (uang aktual di laci). */
  function tutupShift(actualCash: number) {
    void shiftGuard.guard(
      async () => {
        if (!shift) return;
        const res = await shiftsApi.close(shift.id, actualCash);
        if (!res.ok) {
          toast.error('Gagal tutup shift', res.error);
          return;
        }
        const s = res.data.selisih;
        const kata = s === 0 ? 'kas pas' : s > 0 ? `lebih ${rupiah(s)}` : `kurang ${rupiah(Math.abs(s))}`;
        setShift(null);
        setShiftModalOpen(false);
        toast.ok(
          'Shift ditutup',
          `${res.data.shift.shift_no} — perkiraan ${rupiah(res.data.expected)} (${kata})`,
        );
      },
      { pesanTunggu: 'Menutup shift…' },
    );
  }

  /* ------------------------------ hotkey ------------------------------ */
  /**
   * `bukaBayar` / `klikSimpanTransaksi` membaca `lines` / `kurang` yang berubah
   * tiap render, tapi listener global sengaja tidak didaftarkan ulang tiap
   * ketikan. Simpan closure terbaru di ref supaya tombol End selalu memakai
   * data terkini dan tetap lewat penjaga klik-ganda yang sama dengan tombolnya.
   */
  const hotkeyRef = React.useRef({ lines: 0, bayar: bukaBayar, simpan: klikSimpanTransaksi });
  React.useEffect(() => {
    hotkeyRef.current = { lines: lines.length, bayar: bukaBayar, simpan: klikSimpanTransaksi };
  });

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Saat modal pembayaran terbuka: hanya Esc (ditutup oleh ModalBayar)
      // dan End (Simpan Transaksi) yang bermakna; F-key/Delete lain dinonaktifkan
      // supaya tidak menimpa data bayar yang sedang diisi.
      if (payOpen) {
        if (e.key === 'Escape') return; // ModalBayar punya penutup Esc sendiri
        if (e.key === 'End') {
          e.preventDefault();
          hotkeyRef.current.simpan();
        }
        return;
      }

      const el = e.target as HTMLElement | null;
      const tag = el?.tagName ?? '';
      const editable = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || el?.isContentEditable;
      const adaModal =
        cancelOpen || savePendOpen || pendListOpen || listBarangOpen || tambahPlgOpen || Boolean(success);

      if (e.key === 'Escape') {
        if (adaModal) return; // Modal punya penutup Esc sendiri
        if (lines.length) {
          e.preventDefault();
          setCancelOpen(true);
        }
        return;
      }

      // F-key & navigasi tetap aktif meski sedang mengetik
      if (e.key === 'F5') {
        e.preventDefault();
        if (lines.length) setSavePendOpen(true);
        return;
      }
      if (e.key === 'F6') {
        e.preventDefault();
        setPendListOpen(true);
        return;
      }
      if (e.key === 'F8') {
        e.preventDefault();
        fokusKode();
        return;
      }
      // F10 = List Barang (bukan lagi fokus Kode Item).
      if (e.key === 'F10') {
        e.preventDefault();
        setListBarangOpen(true);
        return;
      }
      if (e.key === 'F9') {
        e.preventDefault();
        if (!lines.length) fokusKode();
        else if (window.confirm('Mulai transaksi baru? Keranjang akan dikosongkan.')) resetForm();
        return;
      }
      if (e.key === 'End') {
        if (!hotkeyRef.current.lines) return;
        e.preventDefault();
        hotkeyRef.current.bayar();
        return;
      }
      if (e.key === 'PageDown' || e.key === 'PageUp') {
        e.preventDefault();
        if (e.key === 'PageUp' || zone === 'detail') fokusKode();
        else {
          setZone('detail');
          setActiveRow(0);
          const el2 = document.querySelector<HTMLInputElement>('[data-cell="qty"]');
          el2?.focus();
          el2?.select();
        }
        return;
      }

      const isNum = tag === 'INPUT' && (el as HTMLInputElement).type === 'number';
      if (isNum || tag === 'SELECT') return;

      if (e.key === 'Delete' && !editable && lines.length) {
        e.preventDefault();
        resetForm();
      }
    };

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [
    payOpen,
    lines.length,
    zone,
    cancelOpen,
    savePendOpen,
    pendListOpen,
    listBarangOpen,
    tambahPlgOpen,
    success,
    fokusKode,
    resetForm,
  ]);

  /* ------------------------------ render ------------------------------ */
  const barisKosong = Math.max(0, KOSONG_SAMPAI - lines.length);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ========================= SUB-RIBBON ========================== */}
      <div className="sub-ribbon">
        <span className="rb-label">Penjualan Kasir</span>
        <RbBtn
          kbd="F9"
          label="Baru"
          Icon={FilePlus2}
          onClick={() => ui.run(resetForm, 'kasir-baru')}
          disabled={ui.locked('kasir-baru')}
        />
        <RbBtn
          kbd="F5"
          label="Simpan Pending"
          Icon={BookmarkPlus}
          onClick={() => ui.run(() => setSavePendOpen(true), 'kasir-f5')}
          disabled={!lines.length || pendingGuard.busy || ui.locked('kasir-f5')}
        />
        <RbBtn
          kbd="F6"
          label="Daftar Pending"
          Icon={BookOpen}
          onClick={() => ui.run(() => setPendListOpen(true), 'kasir-f6')}
          disabled={ui.locked('kasir-f6')}
        />
        <RbBtn
          kbd="F8"
          label="Kode Item"
          Icon={CornerDownLeft}
          onClick={() => ui.run(fokusKode, 'kasir-f8')}
          disabled={ui.locked('kasir-f8')}
        />
        <RbBtn
          kbd="F10"
          label="Cari Barang"
          Icon={List}
          onClick={() => ui.run(() => setListBarangOpen(true), 'kasir-f10')}
          disabled={ui.locked('kasir-f10')}
        />

        <button
          type="button"
          onClick={() => ui.run(bukaShiftModal, 'kasir-shift')}
          disabled={shiftGuard.busy || ui.locked('kasir-shift')}
          data-loading={shiftGuard.busy}
          aria-label="Shift kasir"
          className={`flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-[11.5px] font-semibold transition ${
            shift
              ? 'bg-[#e8f1fa] text-[#134a85] hover:bg-[#dbe9f7]'
              : 'bg-[#fff4e5] text-[#b0720a] hover:bg-[#ffe9c4]'
          }`}
        >
          <Wallet className="h-3.5 w-3.5" />
          {shift ? `Shift ${shift.shift_no.slice(-4)}` : 'Buka Shift'}
        </button>

        <span className="rb-sep" />

        <button
          type="button"
          onClick={bukaBayar}
          disabled={!lines.length || bayarGuard.busy || saving}
          data-loading={bayarGuard.busy}
          className="rb-btn-go"
        >
          {bayarGuard.busy || saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Bayar
          <span className="kbd !border-white/40 !bg-white/20 !text-white">End</span>
        </button>
        <RbBtn
          label="Cetak"
          Icon={Printer}
          onClick={() => ui.run(() => window.print(), 'kasir-cetak')}
          disabled={!success || ui.locked('kasir-cetak')}
        />
        <RbBtn
          kbd="Esc"
          label="Batal"
          Icon={X}
          tone="danger"
          onClick={() => ui.run(() => setCancelOpen(true), 'kasir-batal')}
          disabled={!lines.length || ui.locked('kasir-batal')}
        />

        <span className="ml-auto hidden shrink-0 items-center gap-2 pr-1 text-[11.5px] text-[#7a8ba0] sm:flex">
          <span className="kbd">{zone === 'header' ? 'Header' : 'Detail'}</span>
          <span>
            <b className="tnum text-[#35485c]">{totals.itemCount}</b> item ·{' '}
            <b className="tnum text-[#35485c]">{lines.length}</b> baris
          </span>
        </span>
      </div>

      {/* ==================== TOTAL BESAR UNTUK PELANGGAN =============== */}
      {/* Angka live dari keranjang; setelah transaksi tersimpan tampil 2 baris
          (Total + Kembali) sampai modal struk ditutup. */}
      <BigTotalDisplay
        total={success ? success.receipt.total : totalTagihan}
        kembali={success ? success.change : null}
      />

      {/* ====================== HEADER FORM (Kode Item) ================= */}
      <div className="shrink-0 border-b border-[#d8e0ec] bg-[#f6f9fd] px-3 py-2.5">
        <div className="flex flex-wrap items-end gap-2">
          <div className="relative w-full sm:w-[300px] lg:w-[340px]" ref={wrapSaranRef}>
            <label className="frm-label" htmlFor="kode-item">
              Kode Item / Barcode
            </label>
            <input
              id="kode-item"
              ref={codeRef}
              className="frm-key"
              placeholder="Scan barcode atau ketik nama barang"
              value={itemCode}
              onChange={onItemChange}
              onKeyDown={(e) => void onKodeEnter(e)}
              onFocus={() => itemCode.trim() && setSaranTampil(saran.length > 0)}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              role="combobox"
              aria-expanded={saranTampil}
              aria-autocomplete="list"
              aria-controls="saran-kode-item"
            />

            {saranTampil ? (
              <ul
                id="saran-kode-item"
                role="listbox"
                className="ac-panel"
                aria-label="Saran barang"
              >
                {saran.map((p, i) => (
                  <li key={p.id} role="option" aria-selected={i === saranIdx}>
                    <button
                      type="button"
                      className={`ac-item ${i === saranIdx ? 'ac-item-active' : ''}`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        pilihSaran(p);
                      }}
                      onMouseEnter={() => setSaranIdx(i)}
                    >
                      <span className="ac-kode">{p.barcode || '—'}</span>
                      <span className="ac-nama">{p.name}</span>
                      <span className="ac-meta">Stok {angka(p.stock)}</span>
                      <span className="ac-harga">{rupiah(p.price)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="w-[92px]">
            <label className="frm-label" htmlFor="item-qty">
              Jumlah
            </label>
            <input
              id="item-qty"
              ref={qtyRef}
              className="frm-input tnum h-9 text-right text-[14px] font-semibold"
              type="number"
              min={1}
              value={itemQty}
              onChange={(e) => setItemQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
              onKeyDown={onQtyEnter}
              onFocus={(e) => e.currentTarget.select()}
            />
          </div>

          <div className="w-[150px]">
            <label className="frm-label" htmlFor="tgl">
              Tanggal
            </label>
            <input
              id="tgl"
              type="date"
              className="frm-input"
              value={tanggal}
              onChange={(e) => setTanggal(e.target.value)}
            />
          </div>

          <div className="w-[168px]">
            <span className="frm-label">No. Transaksi</span>
            <p className="frm-readonly tnum font-semibold text-[#1b3a5c]">{invoiceNo}</p>
          </div>

          <div className="w-[190px]">
            <label className="frm-label" htmlFor="pelanggan">
              Pelanggan
            </label>
            <div className="flex gap-1">
              <select
                id="pelanggan"
                className="frm-input min-w-0 flex-1"
                value={customer}
                onChange={(e) => setCustomer(e.target.value)}
              >
                <option value="Umum">Umum</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
                {customer !== 'Umum' && !customers.some((c) => c.name === customer) ? (
                  <option value={customer}>{customer}</option>
                ) : null}
              </select>
              <button
                type="button"
                onClick={() => ui.run(() => setTambahPlgOpen(true), 'kasir-plg')}
                disabled={ui.locked('kasir-plg')}
                title="Tambah pelanggan"
                aria-label="Tambah pelanggan"
                className="h-8 w-8 shrink-0 rounded border border-[#cdd8e6] bg-white text-[15px] font-bold leading-none text-[#1b5fa8] transition hover:bg-[#e8f1fa]"
              >
                +
              </button>
            </div>
          </div>

          <div className="w-[168px]">
            <label className="frm-label" htmlFor="sales">
              Sales
            </label>
            <input
              id="sales"
              className="frm-input"
              placeholder="—"
              value={sales}
              onChange={(e) => setSales(e.target.value)}
            />
          </div>

          <div className="w-[264px]">
            <span className="frm-label flex items-center gap-1.5">
              Diskon Item
              {patenHidup ? (
                <span
                  title="Dikunci dari Pengaturan &gt; Diskon"
                  className="inline-flex items-center gap-1 rounded-full bg-[#fff4d6] px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wide text-[#b8770a] ring-1 ring-[#f2d99a]"
                >
                  <Lock className="h-2.5 w-2.5" />
                  Paten
                </span>
              ) : null}
            </span>
            <div className="flex items-stretch gap-1">
              <div
                className={`flex shrink-0 overflow-hidden rounded border border-[#cdd8e6] text-[11px] font-bold ${
                  patenHidup ? 'bg-[#f1f4f8]' : 'bg-white'
                }`}
              >
                {(['fixed', 'percent'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => pilihDiskonTipe(t)}
                    disabled={patenHidup}
                    aria-pressed={diskonTipe === t}
                    title={
                      patenHidup
                        ? 'Satuan potongan dikunci dari Pengaturan'
                        : t === 'fixed'
                          ? 'Potongan nominal (Rp) untuk item baru'
                          : 'Potongan persen (%) untuk item baru'
                    }
                    className={`px-2 transition ${
                      diskonTipe === t
                        ? 'bg-[#1b5fa8] text-white'
                        : 'text-[#5b6b80] hover:bg-[#eef4fb]'
                    }`}
                  >
                    {t === 'fixed' ? 'Rp' : '%'}
                  </button>
                ))}
              </div>

              {diskonTipe === 'fixed' ? (
                <RupiahInput
                  id="diskon"
                  ariaLabel="Diskon default item baru (nominal)"
                  disabled={patenHidup}
                  className="h-8 min-w-0 flex-1 rounded border border-[#cdd8e6] px-1.5 text-right text-[12px] outline-none transition focus:border-[#1b5fa8] disabled:bg-[#f1f4f8] disabled:text-[#5b6b80]"
                  value={diskonNilai}
                  onChange={(v) => setDiskonNilai(Math.max(0, v))}
                  onBlur={komitDiskonDefault}
                  onEnter={komitDiskonDefault}
                  placeholder="0"
                />
              ) : (
                <input
                  id="diskon"
                  aria-label="Diskon default item baru (persen)"
                  type="number"
                  min={0}
                  max={100}
                  disabled={patenHidup}
                  className="h-8 min-w-0 flex-1 rounded border border-[#cdd8e6] px-1.5 text-right text-[12px] outline-none transition focus:border-[#1b5fa8] disabled:bg-[#f1f4f8] disabled:text-[#5b6b80]"
                  value={diskonNilai || ''}
                  onChange={(e) => setDiskonNilai(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                  onBlur={komitDiskonDefault}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      komitDiskonDefault();
                    }
                  }}
                  onFocus={(e) => e.currentTarget.select()}
                  placeholder="0"
                />
              )}
            </div>
            {patenHidup ? (
              <p className="mt-1 text-[10.5px] font-semibold leading-tight text-[#b8770a]">
                Paten dari Pengaturan · {ringkasanPatenHeader}
              </p>
            ) : labelDiskonDefault ? (
              <p className="mt-1 text-[10.5px] font-semibold leading-tight text-[#1b5fa8]">
                {labelDiskonDefault}
              </p>
            ) : null}
          </div>

          <div className="min-w-[180px] flex-1">
            <label className="frm-label" htmlFor="ket">
              Keterangan
            </label>
            <input
              id="ket"
              className="frm-input"
              placeholder="Catatan transaksi (opsional)"
              value={keterangan}
              onChange={(e) => setKeterangan(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* ========================= DETAIL GRID ========================== */}
      {/* Wrapper bg-white + thead/th berlatar solid: kalau header tembus
          transparan, nama barang di baris yang di-scroll akan "nembus" dari
          belakang saat header ini nempel di atas. */}
      <div className="min-h-0 flex-1 overflow-auto bg-white">
        <table className="w-full min-w-[940px] border-collapse">
          <thead className="sticky top-0 z-20 bg-white shadow-[0_2px_4px_rgba(16,40,70,0.10)]">
            <tr>
              <th className="th w-[42px] bg-[#eef2ff] text-center">No</th>
              <th className="th w-[130px] bg-[#eef2ff]">Kode Item</th>
              <th className="th bg-[#eef2ff]">Nama Item</th>
              <th className="th w-[92px] bg-[#eef2ff]">Satuan</th>
              <th className="th w-[96px] bg-[#eef2ff] text-right">H. Pokok</th>
              <th className="th w-[104px] bg-[#eef2ff] text-right">H. Jual</th>
              <th className="th w-[88px] bg-[#eef2ff] text-right">Jumlah</th>
              <th className="th w-[128px] bg-[#eef2ff] text-right">
                <span className="inline-flex items-center justify-end gap-1">
                  <span>Potongan</span>
                  {/* Satu toggle untuk form Diskon di atas & kolom ini, jadi
                      satuan yang diketik kasir selalu sama di keduanya. */}
                  <span
                    className={`inline-flex overflow-hidden rounded border border-[#cdd8e6] text-[9.5px] font-bold ${
                      patenHidup ? 'bg-[#f1f4f8]' : ''
                    }`}
                  >
                    {(['rp', 'pct'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => pilihDiskonTipe(m === 'rp' ? 'fixed' : 'percent')}
                        disabled={patenHidup}
                        aria-pressed={modePotongan === m}
                        title={
                          patenHidup
                            ? 'Satuan kolom dikunci dari Pengaturan'
                            : m === 'rp'
                              ? 'Kolom Potongan nominal (Rp)'
                              : 'Kolom Potongan persen (%)'
                        }
                        className={`px-1.5 transition ${
                          modePotongan === m
                            ? 'bg-[#1b5fa8] text-white'
                            : 'text-[#5b6b80] hover:bg-[#eef4fb]'
                        }`}
                      >
                        {m === 'rp' ? 'Rp' : '%'}
                      </button>
                    ))}
                  </span>
                </span>
              </th>
              <th className="th w-[120px] bg-[#eef2ff] text-right">Jumlah Akhir</th>
              <th className="th w-[64px] bg-[#eef2ff] text-center">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-10 text-center text-[12.5px] text-[#9fb0c4]">
                  Belum ada item. Scan barcode di kolom <b>Kode Item</b> lalu tekan{' '}
                  <span className="kbd">Enter</span>
                </td>
              </tr>
            ) : null}

            {lines.map((l, i) => {
              const units = l.satuanList.length ? l.satuanList : [l.unit];
              const jumlah = jumlahBaris(l);
              const rugi = l.price < l.cost;
              const kilat = l.product_id === flashKey;
              // Persen yang tampil di mode %: pakai yang tersimpan di baris,
              // atau diturunkan dari nominal yang sudah ada (baris lama tak
              // diubah hanya karena kasir menukar Rp <-> % di form atas).
              const persen = l.potonganPct ?? persenPotongan(l);
              return (
                <tr
                  key={`${l.product_id ?? l.name}-${i}`}
                  onMouseDown={() => {
                    setZone('detail');
                    setActiveRow(i);
                  }}
                  className={`border-b border-[#eef2f7] ${
                    activeRow === i ? 'cell-row-active' : kilat ? 'bg-[#fffbeb]' : 'bg-white'
                  }`}
                >
                  <td className="td tnum text-center text-[#9fb0c4]">{i + 1}</td>
                  <td className="td font-mono text-[11.5px] text-[#7a8ba0]">{l.barcode || '—'}</td>
                  <td className="td">
                    <span className="truncate font-semibold text-[#22374b]">{l.name}</span>
                    {rugi ? (
                      <span className="ml-1.5 text-[10px] font-bold text-[#e03131]">
                        jual rugi (modal {rupiah(l.cost)})
                      </span>
                    ) : null}
                  </td>
                  <td className="td p-0">
                    <select
                      className="cell !w-[84px]"
                      value={units.includes(l.unit) ? l.unit : units[0]}
                      onChange={(e) => ubahSatuan(i, e.target.value)}
                    >
                      {units.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="td tnum text-right text-[#9fb0c4]">{rupiah(l.cost)}</td>
                  <td className="td p-0">
                    <RupiahInput
                      dataCell="price"
                      ariaLabel={`Harga jual ${l.name}`}
                      className="cell text-right"
                      value={l.price}
                      onChange={(v) => ubah(i, { price: Math.max(0, v) })}
                    />
                  </td>
                  <td className="td p-0">
                    <input
                      className="cell tnum text-right"
                      data-cell="qty"
                      type="number"
                      min={1}
                      max={typeof l.stock === 'number' ? l.stock : undefined}
                      value={l.qty}
                      onChange={(e) => ubahQty(i, Number(e.target.value))}
                      onFocus={(e) => e.currentTarget.select()}
                    />
                  </td>
                  <td className="td p-0">
                    {modePotongan === 'pct' ? (
                      <>
                        <div className="relative">
                          <input
                            data-cell="disc"
                            aria-label={`Potongan ${l.name}`}
                            type="number"
                            min={0}
                            max={100}
                            className={`cell tnum w-full pr-6 text-right ${
                              (persen ?? 0) > 100
                                ? '!border-[1.5px] !border-[#e03131] bg-[#fff5f5] !text-[#e03131]'
                                : ''
                            }`}
                            value={persen ?? ''}
                            onChange={(e) => ubahPotonganPct(i, Number(e.target.value))}
                            onBlur={() => komitPotonganPct(i)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                komitPotonganPct(i);
                              }
                            }}
                            onFocus={(e) => e.currentTarget.select()}
                            placeholder="0"
                          />
                          <span className="pointer-events-none absolute inset-y-0 right-1.5 flex items-center text-[10.5px] font-bold text-[#93a5b9]">
                            %
                          </span>
                        </div>
                        {(persen ?? 0) > 100 ? (
                          <p className="px-2 pb-1 text-[10.5px] font-semibold leading-tight text-[#e03131]">
                            Max: 100%
                          </p>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <RupiahInput
                          dataCell="disc"
                          ariaLabel={`Potongan ${l.name}`}
                          className={`cell text-right ${
                            (Number(l.discount) || 0) > potonganMax(l)
                              ? '!border-[1.5px] !border-[#e03131] bg-[#fff5f5] !text-[#e03131]'
                              : ''
                          }`}
                          value={l.discount || 0}
                          onChange={(v) => ubahPotongan(i, v)}
                          onBlur={() => komitPotongan(i)}
                          onEnter={() => komitPotongan(i)}
                        />
                        {(Number(l.discount) || 0) > potonganMax(l) ? (
                          <p className="px-2 pb-1 text-[10.5px] font-semibold leading-tight text-[#e03131]">
                            Max: {rupiah(potonganMax(l))}
                          </p>
                        ) : null}
                      </>
                    )}
                  </td>
                  <td className="td tnum text-right font-bold text-[#1b3a5c]">{rupiah(jumlah)}</td>
                  <td className="td text-center">
                    <div className="flex items-center justify-center gap-1">
                      {activeRow === i ? (
                        <Pencil className="h-3.5 w-3.5 text-[#f08c00]" aria-label="sedang diubah" />
                      ) : null}
                      <button
                        type="button"
                        onClick={() => ui.run(() => hapusBaris(i), `hapus-baris-${i}`)}
                        disabled={ui.locked(`hapus-baris-${i}`)}
                        title="Hapus baris"
                        aria-label={`Hapus baris ${i + 1}`}
                        className="grid h-6 w-6 place-items-center rounded text-[#9fb0c4] transition hover:bg-[#ffe8e8] hover:text-[#e03131]"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}

            {Array.from({ length: barisKosong }).map((_, k) => (
              <tr key={`empty-${k}`} className="border-b border-[#f4f8fc]">
                <td className="td text-center text-[#cdd8e5]">{lines.length + k + 1}</td>
                <td colSpan={9} className="td">
                  <span className="text-[11.5px] text-[#cdd8e5]">—</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ===================== TOTAL + TOMBOL BAYAR ===================== */}
      <div className="shrink-0 border-t border-[#d8e0ec] bg-[#f6f9fd]">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2.5 px-3 py-2.5 sm:px-4">
          <dl className="flex flex-col gap-y-1 text-[12.5px]">
            <div className="flex items-center gap-2">
              <dt className="text-[#5b6b80]">Subtotal</dt>
              <dd className="tnum font-semibold text-[#35485c]">{rupiah(subtotalKotor)}</dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="text-[#5b6b80]">
                Potongan
                {labelDiskonDefault ? (
                  <span className="ml-1 text-[10px] text-[#93a5b9]">(default item baru)</span>
                ) : null}
              </dt>
              <dd className="tnum font-semibold text-[#c92a2a]">
                {totalPotongan > 0 ? `- ${rupiah(totalPotongan)}` : rupiah(0)}
              </dd>
            </div>
            {rugiLines.length > 0 ? (
              <p className="flex items-center gap-1.5 text-[11px] font-bold text-[#e03131]">
                <AlertTriangle className="h-3.5 w-3.5" />
                {rugiLines.length} barang jual rugi
              </p>
            ) : null}
            {diskonTidakSah ? (
              <p className="flex items-center gap-1.5 text-[11px] font-bold text-[#e03131]">
                <AlertTriangle className="h-3.5 w-3.5" />
                Diskon melebihi subtotal — periksa kolom Diskon/Potongan
              </p>
            ) : null}
          </dl>

          <div className="ml-auto flex items-center gap-3 sm:gap-4">
            <div className="text-right">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#5b6b80]">Total Akhir</p>
              <p className="grand-total text-[30px] leading-none sm:text-[34px]">{rupiah(totalTagihan)}</p>
            </div>
            <button
              type="button"
              onClick={bukaBayar}
              disabled={!lines.length || diskonTidakSah || bayarGuard.busy || saving}
              title={diskonTidakSah ? 'Periksa potongan yang melebihi subtotal' : undefined}
              data-loading={bayarGuard.busy}
              className="rb-btn-go !h-11 !px-6"
            >
              {bayarGuard.busy || saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Bayar
              <span className="kbd !border-white/40 !bg-white/20 !text-white">End</span>
            </button>
          </div>
        </div>
      </div>

      {/* ========================== MODAL LIST BARANG =================== */}
      <ModalListBarang
        open={listBarangOpen}
        onClose={() => setListBarangOpen(false)}
        products={products}
        onPilih={(p) => {
          masukkanProduk(p);
          // Jumlah kembali ke 1 supaya item berikutnya scan cepat lagi
          // (fokus sengaja tidak diambil: cursor masih di modal Cari Barang).
          setItemQty(1);
        }}
        jumlahItem={lines.length}
        totalKeranjang={totalTagihan}
      />

      {/* ========================= MODAL TAMBAH PELANGGAN ============== */}
      <ModalPelanggan
        open={tambahPlgOpen}
        onClose={() => setTambahPlgOpen(false)}
        onSave={simpanPelanggan}
      />

      {/* ============================ MODAL SHIFT ====================== */}
      <ShiftModal
        open={shiftModalOpen}
        shift={shift}
        expectedCash={shiftExpected}
        busy={shiftGuard.busy}
        onClose={() => setShiftModalOpen(false)}
        onOpen={bukaShift}
        onCloseShift={tutupShift}
      />

      {/* ======================= MODAL PEMBAYARAN ===================== */}
      <ModalBayar
        open={payOpen}
        total={totalTagihan}
        subtotal={subtotalKotor}
        discount={totalPotongan}
        method={method}
        onMethod={pilihMetode}
        bayar={bayarTeks}
        onBayar={setBayarTeks}
        onShortcut={shortcutBayar}
        kembalian={kembalian}
        kurang={kurang}
        note={catatanModal}
        onNote={setCatatanModal}
        busy={bayarGuard.busy || saving}
        diskonTidakSah={diskonTidakSah}
        onBatal={() => setPayOpen(false)}
        onSimpan={klikSimpanTransaksi}
      />

      {/* ====================== MODAL SIMPAN PENDING ==================== */}
      <Modal
        open={savePendOpen}
        title="Simpan Pending"
        onClose={() => setSavePendOpen(false)}
        width="max-w-sm"
        footer={
          <>
            <button
              type="button"
              className="btn-outline"
              onClick={() => setSavePendOpen(false)}
              disabled={pendingGuard.busy}
            >
              Batal
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={simpanPendingSekarang}
              disabled={pendingGuard.busy}
              data-loading={pendingGuard.busy}
            >
              {pendingGuard.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {pendingGuard.busy ? 'Menyimpan…' : 'Simpan'}
            </button>
          </>
        }
      >
        <p className="mb-3 text-[12.5px] text-[#35485c]">
          Transaksi saat ini ({totals.itemCount} item, {rupiah(totals.total)}) akan disimpan sebagai
          pending dan bisa dilanjutkan nanti.
        </p>
        <label className="frm-label" htmlFor="pend-note">
          Keterangan
        </label>
        <input
          id="pend-note"
          className="frm-input h-9"
          placeholder="mis. Nome Pak Budi"
          value={pendNote}
          onChange={(e) => setPendNote(e.target.value)}
        />
      </Modal>

      {/* ====================== MODAL DAFTAR PENDING =================== */}
      <Modal
        open={pendListOpen}
        title="Daftar Pending"
        onClose={() => setPendListOpen(false)}
        width="max-w-lg"
      >
        {pending.length === 0 ? (
          <p className="py-8 text-center text-[12.5px] text-[#9fb0c4]">
            Belum ada transaksi pending. Tekan <span className="kbd">F5</span> untuk menyimpan.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {pending.map((p) => (
              <li
                key={p.id}
                className="flex items-center gap-2 rounded border border-[#d8e0ec] bg-[#f6f9fd] px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] font-semibold text-[#22374b]">{p.note}</p>
                  <p className="tnum text-[11px] text-[#7a8ba0]">
                    {p.at} · {p.customer} · {p.lines.length} baris
                  </p>
                </div>
                <button
                  type="button"
                  className="rb-btn"
                  onClick={() => ui.run(() => lanjutPending(p), `pending-lanjut-${p.id}`)}
                  disabled={ui.locked(`pending-lanjut-${p.id}`)}
                >
                  Lanjut
                </button>
                <button
                  type="button"
                  onClick={() => ui.run(() => hapusPending(p.id), `pending-hapus-${p.id}`)}
                  disabled={ui.locked(`pending-hapus-${p.id}`)}
                  title="Hapus pending"
                  aria-label={`Hapus pending ${p.note}`}
                  className="grid h-8 w-8 place-items-center rounded border border-[#e9b3b3] bg-white text-[#c92a2a] transition hover:bg-[#fff5f5]"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Modal>

      {/* ========================== MODAL BATAL ======================== */}
      <Modal
        open={cancelOpen}
        title="Batal Transaksi?"
        onClose={() => setCancelOpen(false)}
        width="max-w-sm"
        footer={
          <>
            <button type="button" className="btn-outline" onClick={() => setCancelOpen(false)}>
              Lanjut
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={() => {
                // `ui.run` mengembalikan false bila dikunci — jadi pembatalan
                // tidak bisa terjadi dua kali dari satu klik ganda.
                if (
                  !ui.run(() => {
                    resetForm();
                    setCancelOpen(false);
                    toast.info('Transaksi dibatalkan', 'Keranjang dikosongkan.');
                  }, 'konfirmasi-batal')
                ) {
                  toast.info('Mohon tunggu…', 'Tindakan sebelumnya sedang diproses.');
                }
              }}
            >
              Ya, Batalkan
            </button>
          </>
        }
      >
        <p className="py-1 text-[13px] text-[#35485c]">
          Semua item di form kasir akan <b>dikosongkan</b>. Lanjutkan?
        </p>
      </Modal>

      {/* ===================== MODAL SUKSES + STRUK ==================== */}
      <Modal
        open={Boolean(success)}
        title="Transaksi Berhasil"
        onClose={() => setSuccess(null)}
        footer={
          <>
            <button type="button" className="btn-outline" onClick={() => setSuccess(null)}>
              Selesai
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => ui.run(() => window.print(), 'cetak-struk')}
              disabled={ui.locked('cetak-struk')}
            >
              <Printer className="h-4 w-4" /> Cetak Struk
            </button>
          </>
        }
      >
        {success ? <ReceiptView data={success.receipt} /> : null}
      </Modal>
    </div>
  );
}
