'use client';

import * as React from 'react';
import { AlertTriangle, Printer, Search, ShoppingCart, Trash2, X } from 'lucide-react';

import { customersApi, nextInvoicePreview, productsApi, settingsApi, transactionsApi } from '@/lib/api';
import { gabungKeranjang, hitungKembali, hitungTotal, rupiah, satuanOptions, setQty } from '@/lib/format';
import { buildReceiptPreview, loadStoreMeta, type StoreMeta } from '@/lib/receipt';
import { useToast } from '@/components/Toast';
import { Modal } from '@/components/Modal';
import { ReceiptView } from '@/components/Receipt';
import type { CartLine, Customer, PaymentMethod, Product, ReceiptData } from '@/lib/types';

const PAYMENT_LABELS: { key: PaymentMethod; label: string }[] = [
  { key: 'cash', label: 'Tunai' },
  { key: 'qris', label: 'QRIS' },
  { key: 'transfer', label: 'Transfer' },
  { key: 'debit', label: 'Debit' },
  { key: 'credit', label: 'Kredit' },
];

const KOSONG_SAMPAI = 10;

/** Tombol shortcut bar bawah — label hotkey + aksi yang bisa diklik. */
function ShortcutButton({
  kbd,
  label,
  onClick,
  disabled,
  primary,
}: {
  kbd: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        'flex items-center gap-1.5 border-2 px-2 py-1 text-[12px] font-bold leading-none transition',
        primary ? 'border-black bg-black text-white hover:bg-zinc-800' : 'border-black bg-white hover:bg-yellow-100',
        disabled ? 'pointer-events-none opacity-40' : '',
      ].join(' ')}
    >
      <kbd className={primary ? 'text-zinc-300' : 'text-zinc-500'}>{kbd}</kbd>
      <span>{label}</span>
    </button>
  );
}

/** Tombol shortcut bar bawah — label hotkey + aksi yang bisa diklik.
 *
 *  (dipakai di footer: Batal/Bayar/Buka Laci/Cari Barang/Kosongkan)
 */
export default function KasirScreen() {
  const toast = useToast();

  /* ------------------------------ info toko ---------------------------- */
  const [store, setStore] = React.useState<StoreMeta>({
    name: 'Toko',
    address: '',
    phone: '',
    cashier: 'Kasir',
  });
  const [cashier, setCashier] = React.useState('Kasir');
  const [now, setNow] = React.useState(new Date());
  const [invoicePreview, setInvoicePreview] = React.useState('INV-…');

  /* ------------------------------ produk ------------------------------ */
  const [products, setProducts] = React.useState<Product[]>([]);
  const [customers, setCustomers] = React.useState<Customer[]>([]);
  const [customer, setCustomer] = React.useState('Umum');

  /* ------------------------------ keranjang ---------------------------- */
  const [cart, setCart] = React.useState<CartLine[]>([]);
  const [scanText, setScanText] = React.useState('');
  const [scanQty, setScanQty] = React.useState(1);

  /* ------------------------------ modal -------------------------------- */
  const [payOpen, setPayOpen] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [searchText, setSearchText] = React.useState('');
  const [searchActive, setSearchActive] = React.useState(0);
  const [paidInput, setPaidInput] = React.useState('');
  const [method, setMethod] = React.useState<PaymentMethod>('cash');

  /* ------------------------------ transaksi ---------------------------- */
  const [saving, setSaving] = React.useState(false);
  const [success, setSuccess] = React.useState<{ receipt: ReceiptData; change: number } | null>(null);
  const [autoPrint, setAutoPrint] = React.useState(true);

  const scanRef = React.useRef<HTMLInputElement>(null);
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  const totals = hitungTotal(cart, 'none', 0);
  const paid = paidInput.trim() === '' ? totals.total : Math.max(0, Number(paidInput) || 0);
  const change = hitungKembali(totals.total, paid);
  const kurang = Math.max(0, totals.total - paid);
  const rugiLines = cart.filter((l) => l.price < l.cost);

  /* ------------------------------ memuat data -------------------------- */
  React.useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);

  React.useEffect(() => {
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
      if (cRes.ok && cRes.data.length) setCustomers(cRes.data);
      setInvoicePreview(invRes);
    })();
    void settingsApi.get<boolean>('autoPrint', true).then((v) => setAutoPrint(v !== false));
  }, []);

  /* Cetak otomatis bila diaktifkan (window.print → dialog printer). */
  React.useEffect(() => {
    if (success && autoPrint) {
      const t = window.setTimeout(() => window.print(), 450);
      return () => window.clearTimeout(t);
    }
  }, [success, autoPrint]);

  /* ------------------------------ tombol atas -------------------------- */
  const focusScan = React.useCallback(() => scanRef.current?.focus(), []);

  const addProduct = React.useCallback(
    (p: Product, qty = 1) => {
      const units = satuanOptions(p);
      setCart((prev) =>
        gabungKeranjang(prev, {
          product_id: p.id,
          barcode: p.barcode,
          name: p.name,
          price: p.price,
          cost: p.cost,
          qty,
          discount: 0,
          unit: units[0] ?? p.unit,
          satuanList: units,
          stock: p.stock,
        }),
      );
      setPaidInput('');
      focusScan();
    },
    [focusScan],
  );

  const clearCart = React.useCallback(() => {
    setCart([]);
    setPaidInput('');
    setMethod('cash');
    focusScan();
  }, [focusScan]);

  const removeLine = React.useCallback((index: number) => {
    setCart((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const setLineQty = React.useCallback((index: number, qty: number) => {
    setCart((prev) => setQty(prev, index, qty));
  }, []);

  const setLinePrice = React.useCallback((index: number, price: number) => {
    setCart((prev) => {
      const line = prev[index];
      if (!line) return prev;
      const copy = [...prev];
      copy[index] = { ...line, price: Math.max(0, Number(price) || 0) };
      return copy;
    });
  }, []);

  const setLineUnit = React.useCallback((index: number, unit: string) => {
    setCart((prev) => {
      const line = prev[index];
      if (!line) return prev;
      const copy = [...prev];
      copy[index] = { ...line, unit };
      return copy;
    });
  }, []);

  /* ------------------------------ scan -------------------------------- */
  async function onScanSubmit(e: React.FormEvent) {
    e.preventDefault();
    const code = scanText.trim();
    if (!code) return;

    const byBarcode = await productsApi.findByBarcode(code);
    if (byBarcode.ok && byBarcode.data) {
      addProduct(byBarcode.data, scanQty);
      setScanText('');
      return;
    }

    // bukan barcode → cocokkan nama persis
    const found = products.filter((p) => p.name.toLowerCase() === code.toLowerCase());
    if (found.length === 1) {
      addProduct(found[0]!, scanQty);
      setScanText('');
    } else {
      toast.info('Item tidak ditemukan', `"${code}" — coba F10 untuk cari barang.`);
      setScanText('');
    }
    focusScan();
  }

  /* ------------------------------ cari (F10) --------------------------- */
  const searchResults = React.useMemo(() => {
    const s = searchText.trim().toLowerCase();
    if (!s) return products.slice(0, 30);
    return products
      .filter((p) => p.name.toLowerCase().includes(s) || (p.barcode ?? '').toLowerCase().includes(s))
      .slice(0, 30);
  }, [products, searchText]);

  React.useEffect(() => {
    setSearchActive(0);
  }, [searchText]);

  function onSearchKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSearchActive((a) => Math.min(a + 1, searchResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSearchActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && searchResults[searchActive]) {
      e.preventDefault();
      pilihDariCari(searchResults[searchActive]!);
    }
  }

  function pilihDariCari(p: Product) {
    addProduct(p, scanQty);
    setSearchOpen(false);
    setSearchText('');
    focusScan();
  }

  /* ------------------------------ bayar -------------------------------- */
  function openPay() {
    if (!cart.length) return;
    setPaidInput(String(totals.total));
    setPayOpen(true);
  }

  async function bayar() {
    if (!cart.length || saving) return;
    if (kurang > 0) {
      toast.error('Uang belum cukup', `Kurang ${rupiah(kurang)}.`);
      return;
    }

    setSaving(true);
    try {
      const res = await transactionsApi.create({
        lines: cart,
        discountType: 'none',
        discountValue: 0,
        paymentMethod: method,
        paid,
        note: null,
        cashierName: cashier,
        customerName: customer,
      });

      if (!res.ok) {
        toast.error('Transaksi gagal', res.error);
        return;
      }

      const tx = res.data.transaction;
      const receipt = buildReceiptPreview({
        invoiceNo: tx.invoice_no,
        store,
        lines: cart,
        subtotal: totals.subtotal,
        discountAmount: 0,
        total: totals.total,
        paid,
        changeDue: change,
        paymentMethod: PAYMENT_LABELS.find((p) => p.key === method)?.label ?? 'Tunai',
      });

      setSuccess({ receipt, change });
      setPayOpen(false);
      setPaidInput('');

      // segarkan produk (stok berkurang), no-nota berikutnya & preferensi
      const [pRes] = await Promise.all([
        productsApi.list(''),
        settingsApi.set('autoPrint', autoPrint),
        settingsApi.set('cashierName', cashier),
      ]);
      if (pRes.ok) setProducts(pRes.data);
      setInvoicePreview(await nextInvoicePreview());
      clearCart();
    } finally {
      setSaving(false);
    }
  }

  function cetakUlang() {
    if (!success) return;
    window.print();
  }

  async function tambahPelanggan() {
    const nama = window.prompt('Nama pelanggan baru:');
    if (!nama || !nama.trim()) return;
    const res = await customersApi.add(nama);
    if (!res.ok) {
      toast.error('Gagal menambah pelanggan', res.error);
      return;
    }
    const list = await customersApi.list();
    if (list.ok) setCustomers(list.data);
    setCustomer(res.data.name);
    toast.ok('Pelanggan ditambahkan', res.data.name);
  }

  /* ------------------------------ hotkey global ------------------------ */
  function bukaCari() {
    setSearchOpen(true);
    window.setTimeout(() => searchInputRef.current?.focus(), 50);
  }

  function bukaLaci() {
    console.log('[POS] open-drawer');
    toast.info('Buka laci', 'demo: F11 hanya log di browser.');
  }

  function kosongkanKlik() {
    clearCart();
    toast.info('Keranjang dikosongkan');
  }

  /** Tombol angka di keypad modal bayar. */
  function tekanAngkaUang(k: string) {
    setPaidInput((prev) => {
      const base = prev.trim() === '' ? '' : prev;
      if (k === '⌫') return base.slice(0, -1);
      const next = base + k;
      return next.length <= 12 ? next : base;
    });
  }

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName ?? '';
      const editable = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || el?.isContentEditable;

      if (e.key === 'F10') {
        e.preventDefault();
        if (!searchOpen) {
          setSearchOpen(true);
          window.setTimeout(() => searchInputRef.current?.focus(), 50);
        }
        return;
      }

      if (e.key === 'F11') {
        e.preventDefault();
        console.log('[POS] open-drawer');
        toast.info('Buka laci', 'demo: F11 hanya log di browser.');
        return;
      }

      // bawah: hanya jika tidak sedang mengetik di field number/select
      const isNum = tag === 'INPUT' && (el as HTMLInputElement).type === 'number';
      const modalOpen = payOpen || searchOpen || cancelOpen;

      if (e.key === 'Escape') {
        if (modalOpen) return; // Modal punya penutup Esc sendiri
        if (!editable && cart.length) setCancelOpen(true);
        return;
      }

      if (isNum || tag === 'SELECT') return;

      if (e.key === 'End') {
        if (searchOpen || cancelOpen) return;
        if (cart.length && !payOpen) {
          e.preventDefault();
          openPay();
        }
        return;
      }

      if (e.key === 'Delete') {
        if (!editable && cart.length) {
          e.preventDefault();
          clearCart();
          toast.info('Keranjang dikosongkan');
        }
      }
    };

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [cart.length, payOpen, searchOpen, cancelOpen, clearCart, toast]);

  /* ------------------------------ render ------------------------------- */
  const kosongHint = cart.length === 0;
  const emptyRows = Math.max(0, KOSONG_SAMPAI - cart.length - (kosongHint ? 1 : 0));

  return (
    <div className="flex h-full min-h-0 flex-col bg-white font-mono text-black">
      {/* ======================= 1. HEADER TOTAL ======================= */}
      <header className="flex h-[96px] shrink-0 items-center border-b-2 border-black px-4 sm:h-[112px] sm:px-5 md:h-[120px] md:px-6">
        <div className="min-w-0 flex-1 pr-3">
          <p className="truncate text-[13px] font-bold tracking-widest text-black">POS AMD</p>
          <p className="truncate text-[11px] text-zinc-500">{store.name}</p>
        </div>
        <div className="tnum shrink-0 whitespace-nowrap text-right text-3xl font-bold leading-none text-red-600 sm:text-5xl lg:text-6xl xl:text-7xl">
          {rupiah(totals.total)}
        </div>
      </header>

      {/* ===================== 2. INFO TRANSAKSI ======================== */}
      <section className="shrink-0 border-b-2 border-black text-[13px]">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_220px]">
          <div className="grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 px-4 py-2.5 leading-relaxed sm:gap-x-6 sm:px-5">
            <span className="text-zinc-500">No Nota</span>
            <span className="min-w-0 text-right">
              {invoicePreview} <span className="text-zinc-400">(auto)</span>
            </span>
            <span className="text-zinc-500">Tanggal</span>
            <span className="min-w-0 whitespace-nowrap text-right">
              {now.toLocaleDateString('id-ID', {
                weekday: 'short',
                day: '2-digit',
                month: 'short',
                year: 'numeric',
              })}{' '}
              {now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
            </span>
            <span className="text-zinc-500">Kasir</span>
            <span className="min-w-0 truncate text-right">{cashier}</span>
            <span className="text-zinc-500">Pelanggan</span>
            <span className="flex min-w-0 items-center justify-end gap-1.5">
              <select
                className="h-7 min-w-0 flex-1 border-2 border-black bg-white px-1 text-[12.5px] outline-none focus:bg-yellow-100 sm:max-w-[190px] sm:flex-none"
                value={customer}
                onChange={(e) => setCustomer(e.target.value)}
              >
                {customers.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
                {!customers.some((c) => c.name === customer) && customer ? (
                  <option value={customer}>{customer}</option>
                ) : null}
              </select>
              <button
                type="button"
                onClick={() => void tambahPelanggan()}
                className="h-7 shrink-0 border-2 border-black bg-gray-200 px-2 text-[14px] font-bold leading-none"
                title="Tambah pelanggan"
              >
                +
              </button>
            </span>
          </div>

          {/* logo / info toko (placeholder) */}
          <div className="hidden border-l-2 border-black px-4 py-2 sm:block">
            <div className="flex h-full flex-col items-center justify-center gap-0.5 text-center">
              <span className="grid h-10 w-10 place-items-center border-2 border-black text-[10px] font-bold tracking-wider">
                LOGO
              </span>
              <p className="text-[12.5px] font-bold">{store.name}</p>
              {store.address ? <p className="text-[10.5px] leading-tight text-zinc-500">{store.address}</p> : null}
              {store.phone ? <p className="text-[10.5px] text-zinc-500">Telp {store.phone}</p> : null}
            </div>
          </div>
        </div>
      </section>

      {/* ========================= 3. INPUT SCAN ========================= */}
      <form
        onSubmit={(e) => void onScanSubmit(e)}
        className="shrink-0 border-b-2 border-black text-[13px]"
      >
        <div className="flex">
          <div className="flex flex-[7] items-stretch">
            <span className="flex items-center border-r-2 border-black px-2 text-zinc-500">Scan</span>
            <input
              ref={scanRef}
              className="min-w-0 flex-1 px-3 py-2.5 text-[15px] uppercase outline-none placeholder:text-zinc-400"
              placeholder="Scan Barcode — Enter"
              value={scanText}
              onChange={(e) => setScanText(e.target.value)}
              autoFocus
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
            />
          </div>
          <div className="flex min-w-[126px] flex-[3] items-stretch">
            <span className="flex items-center border-r-2 border-black px-2 text-zinc-500">Qty</span>
            <input
              className="tnum min-w-0 flex-1 px-3 py-2.5 text-[15px] outline-none"
              type="number"
              min={1}
              value={scanQty}
              onChange={(e) => setScanQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
              onFocus={(e) => e.currentTarget.select()}
            />
          </div>
        </div>
      </form>

      {/* ==================== 4. TABEL KERANJANG (CORE) ==================== */}
      <div className="min-h-0 flex-1 overflow-auto overscroll-contain bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-black px-2.5 py-1.5 text-[12px] sm:px-3">
          <span className="flex items-center gap-1.5">
            <ShoppingCart className="h-3.5 w-3.5" /> Keranjang
            {cart.length ? <b className="tnum">({totals.itemCount} item)</b> : <b>kosong</b>}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className="flex items-center gap-1 border-2 border-black bg-white px-2 py-1 text-[11.5px] font-bold hover:bg-yellow-100 disabled:pointer-events-none disabled:opacity-40"
              onClick={clearCart}
              disabled={!cart.length}
            >
              <Trash2 className="h-3 w-3" /> Kosongkan
            </button>
            <button
              type="button"
              className="flex items-center gap-1 border-2 border-black bg-black px-2.5 py-1 text-[12px] font-bold text-white hover:bg-zinc-800 disabled:pointer-events-none disabled:opacity-40"
              onClick={openPay}
              disabled={!cart.length}
            >
              Bayar <kbd>End</kbd>
            </button>
          </div>
        </div>

        <table className="w-full min-w-[600px] border-collapse text-[12.5px]">
          <thead>
            <tr className="sticky top-0 z-10 bg-gray-100 text-[12px]">
              <th className="w-11 border-2 border-black px-1 py-1.5">No</th>
              <th className="border-2 border-black px-2 py-1.5 text-left">Barang</th>
              <th className="w-20 border-2 border-black px-1 py-1.5">Qty</th>
              <th className="w-20 border-2 border-black px-1 py-1.5">Satuan</th>
              <th className="w-32 border-2 border-black px-1 py-1.5">Harga</th>
              <th className="w-32 border-2 border-black px-2 py-1.5 text-right">Jumlah</th>
            </tr>
          </thead>
          <tbody>
            {cart.map((line, i) => {
              const rugi = line.price < line.cost;
              const jumlah = line.price * line.qty;
              const units = line.satuanList.length ? line.satuanList : [line.unit];
              return (
                <tr key={`${line.product_id ?? line.name}-${i}`} className={rugi ? 'bg-red-100' : 'bg-white'}>
                  <td className="tnum border-2 border-black px-1 py-1 text-center">{i + 1}</td>
                  <td className="border-2 border-black px-2 py-1">
                    <div className="flex items-start justify-between gap-1">
                      <div className="min-w-0">
                        <p className="truncate font-semibold leading-tight">{line.name}</p>
                        {rugi ? (
                          <p className="text-[10px] font-bold text-red-700">JUAL RUGI!</p>
                        ) : (
                          <p className="text-[10px] text-zinc-400">H.Beli {rupiah(line.cost)}</p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => removeLine(i)}
                        className="shrink-0 p-0.5 text-zinc-400 hover:text-black"
                        title="Hapus baris"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                  <td className="border-2 border-black px-1 py-1 text-center">
                    <div className="flex items-center justify-center gap-0.5">
                      <button
                        type="button"
                        aria-label="Kurangi qty"
                        title="Kurangi"
                        className="h-5 w-5 shrink-0 border-2 border-black bg-gray-100 text-[12px] font-bold leading-none hover:bg-yellow-100"
                        onClick={() => setLineQty(i, line.qty - 1)}
                      >
                        −
                      </button>
                      <input
                        className="tnum w-9 border-2 border-zinc-300 bg-white px-0.5 py-0.5 text-center outline-none focus:border-black"
                        type="number"
                        min={1}
                        value={line.qty}
                        onChange={(e) => setLineQty(i, Number(e.target.value) || 1)}
                      />
                      <button
                        type="button"
                        aria-label="Tambah qty"
                        title="Tambah"
                        className="h-5 w-5 shrink-0 border-2 border-black bg-gray-100 text-[12px] font-bold leading-none hover:bg-yellow-100"
                        onClick={() => setLineQty(i, line.qty + 1)}
                      >
                        +
                      </button>
                    </div>
                    <p className="pt-0.5 text-[9.5px] text-zinc-500">↓ Stepper / Edit</p>
                  </td>
                  <td className="border-2 border-black px-1 py-1 text-center">
                    <div className="flex flex-col items-stretch">
                      <select
                        className="h-6 w-full border-2 border-zinc-300 bg-white px-0.5 text-[11px] outline-none focus:border-black"
                        value={units.includes(line.unit) ? line.unit : units[0]}
                        onChange={(e) => setLineUnit(i, e.target.value)}
                      >
                        {units.map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </select>
                      <p className="pt-0.5 text-[9.5px] text-zinc-500">↓ Pilih</p>
                    </div>
                  </td>
                  <td className="border-2 border-black px-1 py-1">
                    <div>
                      <div className="flex items-center">
                        <span className="pr-0.5 text-[10px] text-zinc-500">Rp</span>
                        <input
                          className="tnum min-w-0 flex-1 border-2 border-zinc-300 bg-white px-0.5 py-0.5 text-right outline-none focus:border-black"
                          type="number"
                          min={0}
                          value={line.price}
                          onChange={(e) => setLinePrice(i, Number(e.target.value) || 0)}
                        />
                      </div>
                      <p className="pt-0.5 text-[9.5px] text-zinc-500">↓ Auto &amp; Edit</p>
                    </div>
                  </td>
                  <td className="tnum border-2 border-black px-2 py-1 text-right text-[13px] font-bold">
                    {rupiah(jumlah)}
                  </td>
                </tr>
              );
            })}

            {/* panduan saat kosong */}
            {kosongHint ? (
              <tr className="bg-white">
                <td
                  colSpan={6}
                  className="h-11 border-2 border-black px-2 text-center text-[11.5px] text-zinc-500"
                >
                  Keranjang kosong — scan barcode lalu <b>Enter</b>, atau tekan <b>F10</b> untuk cari barang.
                </td>
              </tr>
            ) : null}

            {/* baris kosong sampai 10 baris */}
            {Array.from({ length: emptyRows }).map((_, i) => (
              <tr key={`empty-${i}`} className="bg-white">
                <td className="h-11 border-2 border-black" />
                <td className="h-11 border-2 border-black" />
                <td className="h-11 border-2 border-black" />
                <td className="h-11 border-2 border-black" />
                <td className="h-11 border-2 border-black" />
                <td className="h-11 border-2 border-black" />
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-1.5 text-[11px] text-zinc-600">
          <span className="font-bold">H.Beli &lt; H.Jual</span>
          {rugiLines.length > 0 ? (
            <span className="flex items-center gap-1 font-bold text-red-700">
              <AlertTriangle className="h-3.5 w-3.5" />
              {rugiLines.length} barang dijual rugi — harga di bawah modal!
            </span>
          ) : (
            <span>Semua harga aman di atas modal.</span>
          )}
        </div>
      </div>

      {/* ====================== 5. FOOTER SHORTCUT ======================= */}
      <footer className="shrink-0 border-t-2 border-black bg-gray-200 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <ShortcutButton kbd="Esc" label="Batal" onClick={() => setCancelOpen(true)} disabled={!cart.length} />
          <ShortcutButton kbd="End" label="Bayar" onClick={openPay} disabled={!cart.length} primary />
          <ShortcutButton kbd="F11" label="Buka Laci" onClick={bukaLaci} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <ShortcutButton kbd="F10" label="Cari Barang" onClick={bukaCari} />
          <ShortcutButton kbd="Del" label="Kosongkan" onClick={kosongkanKlik} disabled={!cart.length} />
        </div>
      </footer>

      {/* ======================= MODAL CARI BARANG (F10) ======================= */}
      <Modal open={searchOpen} title="Cari Barang (F10)" onClose={() => setSearchOpen(false)} width="max-w-2xl">
        <div className="space-y-2.5">
          <div className="flex items-center gap-2 border-2 border-black px-2">
            <Search className="h-4 w-4 shrink-0 text-zinc-400" />
            <input
              ref={searchInputRef}
              className="min-w-0 flex-1 py-2 outline-none"
              placeholder="Cari nama / barcode — ↑↓ pilih, Enter tambah"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              onKeyDown={onSearchKeyDown}
              autoFocus
            />
            <span className="shrink-0 text-[10.5px] text-zinc-400">{searchResults.length} hasil</span>
          </div>

          {searchResults.length === 0 ? (
            <p className="py-6 text-center text-[12.5px] text-zinc-400">Tidak ada produk yang cocok.</p>
          ) : (
            <div className="max-h-[46vh] overflow-y-auto border-2 border-black">
              <table className="w-full border-collapse text-[12px]">
                <thead className="bg-gray-100">
                  <tr className="text-left">
                    <th className="border-b-2 border-black px-2 py-1">Nama</th>
                    <th className="border-b-2 border-black px-2 py-1">Barcode</th>
                    <th className="border-b-2 border-black px-2 py-1 text-right">Harga</th>
                    <th className="border-b-2 border-black px-2 py-1 text-right">Stok</th>
                  </tr>
                </thead>
                <tbody>
                  {searchResults.map((p, i) => {
                    const on = i === searchActive;
                    return (
                      <tr
                        key={p.id}
                        className={`cursor-pointer ${on ? 'bg-yellow-200' : 'bg-white'} ${p.stock <= 0 ? 'opacity-50' : ''}`}
                        onMouseEnter={() => setSearchActive(i)}
                        onClick={() => p.stock > 0 && pilihDariCari(p)}
                      >
                        <td className="border-b border-zinc-200 px-2 py-1 font-semibold">{p.name}</td>
                        <td className="border-b border-zinc-200 px-2 py-1">{p.barcode ?? '-'}</td>
                        <td className="tnum border-b border-zinc-200 px-2 py-1 text-right">
                          {p.stock <= 0 ? 'HABIS' : rupiah(p.price)}
                        </td>
                        <td className="tnum border-b border-zinc-200 px-2 py-1 text-right">
                          {p.stock} {p.unit}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-[11px] text-zinc-500">
            Gunakan tombol <b>↑ ↓</b> lalu <b>Enter</b>. Tambahan qty memakai angka di kolom Qty layar kasir.
          </p>
        </div>
      </Modal>

      {/* ======================= MODAL BAYAR (End) ======================= */}
      <Modal
        open={payOpen}
        title="Pembayaran"
        onClose={() => setPayOpen(false)}
        width="max-w-md"
        footer={
          <button
            type="button"
            className="border-2 border-black bg-black px-4 py-2 text-[13px] font-bold text-white hover:bg-zinc-800"
            onClick={() => void bayar()}
            disabled={saving || kurang > 0}
          >
            {saving ? 'Menyimpan…' : 'Simpan'}
          </button>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void bayar();
          }}
          className="space-y-3"
        >
          <dl className="space-y-1 text-[13px]">
            <div className="flex items-center justify-between">
              <dt className="text-zinc-600">Total</dt>
              <dd className="tnum text-[17px] font-bold text-red-600">{rupiah(totals.total)}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-zinc-600">Metode</dt>
              <dd>
                <div className="flex flex-wrap justify-end gap-1">
                  {PAYMENT_LABELS.map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => setMethod(p.key)}
                      className={`border-2 px-2 py-0.5 text-[11.5px] font-bold ${
                        method === p.key ? 'border-black bg-gray-200' : 'border-zinc-300 text-zinc-500'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </dd>
            </div>
          </dl>

          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-zinc-500">
              Uang bayar
            </label>
            <div className="flex items-center gap-2">
              <input
                className="tnum min-w-0 flex-1 border-2 border-black px-2 py-2 text-[16px] outline-none"
                type="number"
                min={0}
                autoFocus
                value={paidInput}
                placeholder={String(totals.total)}
                onChange={(e) => setPaidInput(e.target.value)}
                onFocus={(e) => e.currentTarget.select()}
              />
              <button
                type="button"
                className="shrink-0 border-2 border-black bg-gray-100 px-2.5 py-2 text-[12px] font-bold hover:bg-yellow-100"
                onClick={() => setPaidInput(String(totals.total))}
              >
                Pas
              </button>
            </div>

            {/* nominal cepat */}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {[
                { label: 'Uang Pas', value: totals.total },
                { label: 'Rp50.000', value: 50000 },
                { label: 'Rp100.000', value: 100000 },
                { label: 'Rp200.000', value: 200000 },
                { label: 'Rp500.000', value: 500000 },
              ].map((q) => (
                <button
                  key={q.label}
                  type="button"
                  className="border-2 border-zinc-400 bg-white px-2 py-1 text-[11.5px] font-bold hover:border-black hover:bg-yellow-100"
                  onClick={() => setPaidInput(String(q.value))}
                >
                  {q.label}
                </button>
              ))}
            </div>

            {/* keypad numerik */}
            <div className="mt-2 grid grid-cols-3 gap-1.5">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', '⌫'].map((k) => (
                <button
                  key={k}
                  type="button"
                  className="border-2 border-black bg-white py-2 text-[16px] font-bold hover:bg-gray-100 active:bg-black active:text-white"
                  onClick={() => tekanAngkaUang(k)}
                >
                  {k}
                </button>
              ))}
            </div>
          </div>

          {kurang > 0 ? (
            <p className="text-[12px] font-bold text-red-700">Uang belum cukup — kurang {rupiah(kurang)}</p>
          ) : change > 0 ? (
            <div className="flex items-center justify-between border-2 border-black bg-gray-100 px-2.5 py-1.5">
              <span className="text-[12px] font-bold">Kembalian</span>
              <span className="tnum text-[16px] font-bold">{rupiah(change)}</span>
            </div>
          ) : null}

          <p className="text-[11px] text-zinc-500">
            Tekan <b>Enter</b> / Simpan untuk memproses. Struk otomatis dicetak.
          </p>
        </form>
      </Modal>

      {/* ====================== MODAL BATAL (Esc) ======================== */}
      <Modal
        open={cancelOpen}
        title="Batal Transaksi?"
        onClose={() => setCancelOpen(false)}
        width="max-w-sm"
        footer={
          <>
            <button type="button" className="border-2 border-zinc-300 bg-white px-4 py-2 text-[13px] font-bold" onClick={() => setCancelOpen(false)}>
              Lanjut
            </button>
            <button
              type="button"
              className="border-2 border-black bg-red-600 px-4 py-2 text-[13px] font-bold text-white"
              onClick={() => {
                clearCart();
                setCancelOpen(false);
                toast.info('Transaksi dibatalkan', 'Keranjang dikosongkan.');
              }}
            >
              Ya, Batalkan
            </button>
          </>
        }
      >
        <p className="py-1 text-[13px]">
          Semua item di keranjang saat ini akan <b>dikosongkan</b>. Lanjutkan?
        </p>
      </Modal>

      {/* ===================== MODAL SUKSES + STRUK ====================== */}
      <Modal
        open={Boolean(success)}
        title="Transaksi Berhasil"
        onClose={() => setSuccess(null)}
        footer={
          <>
            <button type="button" className="border-2 border-zinc-300 bg-white px-4 py-2 text-[13px] font-bold" onClick={() => setSuccess(null)}>
              Selesai
            </button>
            <button
              type="button"
              className="border-2 border-black bg-black px-4 py-2 text-[13px] font-bold text-white"
              onClick={cetakUlang}
            >
              <Printer className="h-4 w-4" /> Cetak Struk
            </button>
          </>
        }
      >
        {success ? (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between border-2 border-black bg-emerald-50 px-3 py-2">
              <div>
                <p className="text-[13px] font-bold">{success.receipt.invoiceNo}</p>
                <p className="text-[11px]">{success.receipt.storeName}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-wide text-zinc-500">Kembalian</p>
                <p className="tnum text-[20px] font-bold text-red-600">{rupiah(success.change)}</p>
              </div>
            </div>
            <ReceiptView data={success.receipt} />
          </div>
        ) : null}
      </Modal>
    </div>
  );
}