import * as React from 'react';
import {
  CheckCircle2,
  Minus,
  Plus,
  Printer,
  ScanBarcode,
  Search,
  ShoppingCart,
  Trash2,
  X,
} from 'lucide-react';

import { printerApi, productsApi, settingsApi, transactionsApi } from '../lib/api';
import { gabungKeranjang, hitungKembali, hitungTotal, rupiah, setQty } from '../lib/format';
import { buildReceiptPreview } from '../lib/receipt';
import { useToast } from '../components/Toast';
import { Modal } from '../components/Modal';
import type { CartLine, DiscountType, PaymentMethod, Product, ReceiptData } from '../types';
import type { StoreMeta } from '../lib/receipt';

const PAYMENT_LABELS: { key: PaymentMethod; label: string }[] = [
  { key: 'cash', label: 'Tunai' },
  { key: 'qris', label: 'QRIS' },
  { key: 'transfer', label: 'Transfer' },
  { key: 'debit', label: 'Debit' },
  { key: 'credit', label: 'Kredit' },
];

/**
 * Gaya kasir klasik — spec:
 *  - bg putih / teks hitam / font-mono
 *  - TANPA rounded, semua elemen border-2 border-black
 *  - Total Box setinggi 72px
 */
const CLS_INPUT =
  'h-9 w-full border-2 border-black bg-white px-2.5 text-[13px] font-mono text-black outline-none placeholder:text-black/40';
const CLS_BTN =
  'inline-flex items-center justify-center gap-2 border-2 border-black bg-white px-3 py-2 text-[13px] font-bold text-black hover:bg-black hover:text-white disabled:pointer-events-none disabled:opacity-40';
const CLS_BTN_SOLID =
  'inline-flex items-center justify-center gap-2 border-2 border-black bg-black px-3 py-2 text-[13px] font-bold text-white hover:bg-white hover:text-black disabled:pointer-events-none disabled:opacity-40';
const CLS_QTY_BTN =
  'grid h-6 w-6 place-items-center border-2 border-black bg-white text-black hover:bg-black hover:text-white';

/** Pembulatan uang tunai ke ribuan terdekat. */
function bulatUang(n: number): number {
  if (n <= 0) return 0;
  return Math.ceil(n / 1000) * 1000;
}

export default function KasirScreen({ store }: { store: StoreMeta }) {
  const toast = useToast();

  /* ------------------------------ produk ------------------------------ */
  const [products, setProducts] = React.useState<Product[]>([]);
  const [query, setQuery] = React.useState('');
  const [category, setCategory] = React.useState('Semua');
  const [categories, setCategories] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(true);

  /* ----------------------------- keranjang ---------------------------- */
  const [cart, setCart] = React.useState<CartLine[]>([]);
  const [discountType, setDiscountType] = React.useState<DiscountType>('none');
  const [discountValue, setDiscountValue] = React.useState(0);
  const [paymentMethod, setPaymentMethod] = React.useState<PaymentMethod>('cash');
  const [paidInput, setPaidInput] = React.useState('');
  const [note, setNote] = React.useState('');
  const [autoPrint, setAutoPrint] = React.useState(true);

  /* ------------------------------ transaksi --------------------------- */
  const [saving, setSaving] = React.useState(false);
  const [success, setSuccess] = React.useState<{ receipt: ReceiptData; change: number; serial: string } | null>(
    null,
  );

  const searchRef = React.useRef<HTMLInputElement>(null);
  const totals = hitungTotal(cart, discountType, discountValue);
  const paid = paidInput.trim() === '' ? totals.total : Math.max(0, Number(paidInput) || 0);
  const change = hitungKembali(totals.total, paid);
  const kurang = Math.max(0, totals.total - paid);

  /* ------------------------------ memuat data -------------------------- */
  const loadProducts = React.useCallback(async (search = '') => {
    const res = await productsApi.list(search);
    if (res.ok) setProducts(res.data);
    return res;
  }, []);

  React.useEffect(() => {
    void (async () => {
      setLoading(true);
      const [res, cats] = await Promise.all([loadProducts(''), productsApi.categories()]);
      if (cats.ok) setCategories(cats.data);
      if (!res.ok) toast.error('Gagal memuat produk', res.error);
      setLoading(false);
    })();
  }, [loadProducts, toast]);

  React.useEffect(() => {
    void settingsApi.get<boolean>('autoPrint', true).then((v) => setAutoPrint(v !== false));
  }, []);

  /* --------------------------- pencarian produk ------------------------- */
  function onSearchChange(value: string) {
    setQuery(value);
    void loadProducts(value);
  }

  /* ------------------------------ keranjang ---------------------------- */
  const addProduct = React.useCallback((p: Product, qty = 1) => {
    setCart((prev) =>
      gabungKeranjang(prev, {
        product_id: p.id,
        barcode: p.barcode,
        name: p.name,
        price: p.price,
        cost: p.cost,
        qty,
        discount: 0,
        unit: p.unit,
        stock: p.stock,
      }),
    );
    setPaidInput('');
    searchRef.current?.focus();
  }, []);

  /** Enter pada kolom scan: barcode -> produk, kalau tidak ada -> cari manual. */
  async function onScanSubmit(e: React.FormEvent) {
    e.preventDefault();
    const code = query.trim();
    if (!code) return;

    const byBarcode = await productsApi.findByBarcode(code);
    if (byBarcode.ok && byBarcode.data) {
      addProduct(byBarcode.data);
      setQuery('');
      void loadProducts('');
      return;
    }

    // bukan barcode -> cari berdasarkan nama
    const found = products.filter((p) => p.name.toLowerCase().includes(code.toLowerCase()));
    if (found.length === 1) {
      addProduct(found[0]!);
      setQuery('');
    } else {
      toast.info(`${found.length} produk cocok`, 'Klik produk untuk menambahkan ke keranjang.');
    }
  }

  const changeQty = (index: number, delta: number) => setCart((prev) => setQty(prev, index, prev[index]!.qty + delta));
  const removeLine = (index: number) => setCart((prev) => prev.filter((_, i) => i !== index));
  const clearCart = () => {
    setCart([]);
    setDiscountType('none');
    setDiscountValue(0);
    setPaidInput('');
    setNote('');
    searchRef.current?.focus();
  };

  /* -------------------------------- bayar ------------------------------ */
  async function bayar() {
    if (!cart.length) return;
    if (kurang > 0) {
      toast.error('Uang belum cukup', `Kurang ${rupiah(kurang)}.`);
      return;
    }

    setSaving(true);
    try {
      const res = await transactionsApi.create({
        lines: cart,
        discountType,
        discountValue: discountType === 'none' ? 0 : discountValue,
        paymentMethod,
        paid,
        note: note.trim() || null,
        cashierName: store.cashier,
      });

      if (!res.ok) {
        toast.error('Transaksi gagal', res.error);
        return;
      }

      const tx = res.data.transaction;
      const serial = await settingsApi.get<string | null>('serialKey', null);
      const receipt = buildReceiptPreview({
        invoiceNo: tx.invoice_no,
        store,
        lines: cart,
        subtotal: totals.subtotal,
        discountAmount: totals.discountAmount,
        total: totals.total,
        paid,
        changeDue: change,
        paymentMethod: PAYMENT_LABELS.find((p) => p.key === paymentMethod)?.label ?? 'Tunai',
        note: note.trim(),
        serialKey: serial,
      });

      setSuccess({ receipt, change, serial: serial ?? '' });

      if (autoPrint) {
        const print = await printerApi.receipt(receipt);
        if (!print.ok && print.error) toast.error('Gagal mencetak struk', print.error);
      }

      // segarkan produk (stok sudah berkurang) & simpan preferensi
      await Promise.all([
        loadProducts(query),
        settingsApi.set('autoPrint', autoPrint),
        settingsApi.set('cashierName', store.cashier),
      ]);
      clearCart();
    } finally {
      setSaving(false);
    }
  }

  async function cetakUlang() {
    if (!success) return;
    const print = await printerApi.receipt(success.receipt);
    if (print.ok) toast.ok('Struk dikirim ke printer');
    else toast.error('Gagal mencetak struk', print.error);
  }

  /* ------------------------------ render ------------------------------- */
  const visible = React.useMemo(
    () => (category === 'Semua' ? products : products.filter((p) => p.category === category)),
    [products, category],
  );

  return (
    <div className="flex h-full min-h-0 bg-white font-mono text-black">
      {/* --------------------------- katalog --------------------------- */}
      <section className="flex min-w-0 flex-1 flex-col">
        <form onSubmit={onScanSubmit} className="flex gap-2 border-b-2 border-black bg-white p-3">
          <div className="relative flex-1">
            <ScanBarcode className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-black/50" />
            <input
              ref={searchRef}
              className={`${CLS_INPUT} h-10 pl-8`}
              placeholder="Scan barcode atau cari nama produk, lalu Enter..."
              value={query}
              onChange={(e) => onSearchChange(e.target.value)}
              autoFocus
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <button type="submit" className={`${CLS_BTN_SOLID} h-10 shrink-0 px-4`}>
            <Search className="h-4 w-4" /> Cari
          </button>
        </form>

        <div className="flex gap-1.5 overflow-x-auto border-b-2 border-black bg-white px-3 py-2">
          {['Semua', ...categories].map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={`shrink-0 border-2 border-black px-3 py-1 text-[12px] font-bold transition-none ${
                category === c ? 'bg-black text-white' : 'bg-white text-black hover:bg-black hover:text-white'
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-white p-3">
          {loading ? (
            <p className="py-10 text-center text-[13px] text-black/50">Memuat produk...</p>
          ) : visible.length === 0 ? (
            <div className="py-16 text-center">
              <ShoppingCart className="mx-auto h-8 w-8 text-black/30" />
              <p className="mt-2 text-[13px] text-black/60">
                {query ? `Produk "${query}" tidak ditemukan.` : 'Belum ada produk.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
              {visible.map((p) => {
                const habis = p.stock <= 0;
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={habis}
                    onClick={() => addProduct(p)}
                    className="flex flex-col items-start gap-1 border-2 border-black bg-white p-2.5 text-left text-black hover:bg-black hover:text-white disabled:opacity-40"
                  >
                    <span className="line-clamp-2 text-[12.5px] font-bold leading-tight">{p.name}</span>
                    <span className="text-[13px] font-bold tabular-nums">{rupiah(p.price)}</span>
                    <span
                      className={`text-[10.5px] ${habis ? 'font-bold text-red-600' : 'text-black/60'}`}
                      title="Stok"
                    >
                      {habis ? 'Stok habis' : `Stok ${p.stock} ${p.unit}`}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* --------------------------- keranjang -------------------------- */}
      <section className="flex w-[368px] shrink-0 flex-col border-l-2 border-black bg-white">
        <div className="flex items-center justify-between border-b-2 border-black px-3.5 py-2.5">
          <h2 className="flex items-center gap-2 text-[13px] font-bold">
            <ShoppingCart className="h-4 w-4" /> Keranjang
            {cart.length ? (
              <span className="border-2 border-black bg-black px-1.5 py-0.5 text-[10.5px] font-bold text-white">
                {totals.itemCount}
              </span>
            ) : null}
          </h2>
          {cart.length ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 border-2 border-black bg-white px-1.5 py-1 text-[11.5px] font-bold text-black hover:bg-black hover:text-white"
              onClick={clearCart}
            >
              <Trash2 className="h-3.5 w-3.5" /> Kosongkan
            </button>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {!cart.length ? (
            <p className="px-4 py-10 text-center text-[12.5px] text-black/60">
              Keranjang kosong.
              <br />
              Scan barcode atau klik produk.
            </p>
          ) : (
            <ul className="divide-y-2 divide-black">
              {cart.map((line, i) => (
                <li key={`${line.product_id ?? line.name}-${i}`} className="flex items-center gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-bold">{line.name}</p>
                    <p className="text-[11px] text-black/70 tabular-nums">
                      {rupiah(line.price)} x {line.qty} ={' '}
                      <b className="text-black">{rupiah((line.price - line.discount) * line.qty)}</b>
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <button type="button" className={CLS_QTY_BTN} onClick={() => changeQty(i, -1)}>
                      <Minus className="h-3 w-3" />
                    </button>
                    <input
                      className="h-6 w-10 border-2 border-black bg-white text-center text-[12px] font-bold text-black outline-none tabular-nums"
                      value={line.qty}
                      onChange={(e) => setCart((prev) => setQty(prev, i, Number(e.target.value) || 1))}
                    />
                    <button type="button" className={CLS_QTY_BTN} onClick={() => changeQty(i, 1)}>
                      <Plus className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      className="grid h-6 w-6 place-items-center border-2 border-black bg-white text-black hover:bg-red-600 hover:text-white"
                      onClick={() => removeLine(i)}
                      aria-label="Hapus item"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ---------------------------- ringkasan --------------------------- */}
        <div className="space-y-2 border-t-2 border-black bg-white p-3">
          <div className="flex items-center gap-2">
            <select
              className="h-8 border-2 border-black bg-white px-1 text-[12px] font-mono font-bold text-black outline-none"
              value={discountType}
              onChange={(e) => {
                setDiscountType(e.target.value as DiscountType);
                setDiscountValue(0);
              }}
            >
              <option value="none">Tanpa diskon</option>
              <option value="percent">Diskon %</option>
              <option value="fixed">Diskon Rp</option>
            </select>
            {discountType !== 'none' ? (
              <input
                className={`${CLS_INPUT} h-8 flex-1 tabular-nums`}
                type="number"
                min={0}
                value={discountValue || ''}
                placeholder={discountType === 'percent' ? '0' : '0'}
                onChange={(e) => setDiscountValue(Math.max(0, Number(e.target.value) || 0))}
              />
            ) : null}
          </div>

          <dl className="space-y-1 text-[12.5px]">
            <Row label="Subtotal" value={rupiah(totals.subtotal)} />
            {totals.discountAmount > 0 ? (
              <Row label="Diskon" value={`- ${rupiah(totals.discountAmount)}`} tone="red" />
            ) : null}

            {/* Total Box — 72px, kotak keras sesuai spec */}
            <div className="flex h-[72px] items-center justify-between border-2 border-black bg-black px-3 text-white">
              <dt className="text-[16px] font-bold tracking-[0.2em]">TOTAL</dt>
              <dd className="text-[30px] font-bold tabular-nums">{rupiah(totals.total)}</dd>
            </div>
          </dl>

          <div className="flex flex-wrap gap-1">
            {PAYMENT_LABELS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setPaymentMethod(p.key)}
                className={`border-2 border-black px-2 py-1 text-[11.5px] font-bold transition-none ${
                  paymentMethod === p.key
                    ? 'bg-black text-white'
                    : 'bg-white text-black hover:bg-black hover:text-white'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                className={`${CLS_INPUT} h-9 pr-12 tabular-nums`}
                type="number"
                min={0}
                value={paidInput}
                placeholder={String(totals.total)}
                onChange={(e) => setPaidInput(e.target.value)}
                onFocus={(e) => e.currentTarget.select()}
              />
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10.5px] text-black/50">
                uang
              </span>
            </div>
            <button
              type="button"
              className="inline-flex h-9 shrink-0 items-center border-2 border-black bg-white px-2.5 text-[11.5px] font-bold text-black hover:bg-black hover:text-white"
              onClick={() => setPaidInput(String(bulatUang(totals.total)))}
              title="Bulatkan ke ribuan terdekat"
            >
              Pas
            </button>
          </div>

          {kurang > 0 ? (
            <p className="text-[11.5px] font-bold text-red-600">Kurang: {rupiah(kurang)}</p>
          ) : change > 0 ? (
            <p className="text-[11.5px] font-bold text-black">Kembali: {rupiah(change)}</p>
          ) : null}

          <input
            className={CLS_INPUT}
            value={note}
            placeholder="Catatan (opsional)"
            onChange={(e) => setNote(e.target.value)}
          />

          <label className="flex items-center gap-2 text-[11.5px] font-bold text-black">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-black"
              checked={autoPrint}
              onChange={(e) => {
                setAutoPrint(e.target.checked);
                void settingsApi.set('autoPrint', e.target.checked);
              }}
            />
            Cetak struk otomatis
          </label>

          <button
            type="button"
            className="inline-flex h-11 w-full items-center justify-center gap-2 border-2 border-black bg-black text-[14px] font-bold text-white hover:bg-white hover:text-black disabled:pointer-events-none disabled:opacity-40"
            onClick={() => void bayar()}
            disabled={!cart.length || saving || kurang > 0}
          >
            {saving ? (
              'Menyimpan...'
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" /> Bayar {rupiah(totals.total)}
              </>
            )}
          </button>
        </div>
      </section>

      {/* -------------------------- struk berhasil ------------------------ */}
      <Modal
        open={Boolean(success)}
        title="Transaksi Berhasil"
        flat
        onClose={() => setSuccess(null)}
        footer={
          <>
            <button type="button" className={CLS_BTN} onClick={() => setSuccess(null)}>
              Selesai
            </button>
            <button type="button" className={CLS_BTN_SOLID} onClick={() => void cetakUlang()}>
              <Printer className="h-4 w-4" /> Cetak Struk
            </button>
          </>
        }
      >
        {success ? (
          <div className="space-y-2.5 font-mono text-black">
            <div className="flex items-center gap-2 border-2 border-black bg-white p-3">
              <CheckCircle2 className="h-5 w-5 shrink-0" />
              <div>
                <p className="text-[13px] font-bold">{success.receipt.invoiceNo}</p>
                <p className="text-[11.5px]">{success.receipt.storeName}</p>
              </div>
            </div>

            <div className="border-2 border-black bg-black p-3 text-center text-white">
              <p className="text-[11px] uppercase tracking-widest">Kembalian</p>
              <p className="text-[26px] font-bold tabular-nums">{rupiah(success.change)}</p>
            </div>

            <ul className="divide-y-2 divide-black border-2 border-black bg-white">
              {success.receipt.items.map((it, i) => (
                <li key={i} className="flex items-center justify-between px-3 py-1.5 text-[12.5px]">
                  <span className="truncate">
                    {it.qty} x {it.name}
                  </span>
                  <span className="shrink-0 font-bold tabular-nums">{rupiah(it.subtotal)}</span>
                </li>
              ))}
              <li className="flex items-center justify-between bg-black px-3 py-2 text-[13px] font-bold text-white">
                <span>Total</span>
                <span className="tabular-nums">{rupiah(success.receipt.total)}</span>
              </li>
            </ul>

            {success.serial ? (
              <p className="text-center text-[10.5px] text-black/50">Lisensi: {success.serial}</p>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'red' }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-black/70">{label}</dt>
      <dd className={`font-bold tabular-nums ${tone === 'red' ? 'text-red-600' : 'text-black'}`}>{value}</dd>
    </div>
  );
}