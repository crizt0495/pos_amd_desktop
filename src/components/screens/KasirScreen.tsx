'use client';

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

import { productsApi, settingsApi, transactionsApi } from '@/lib/api';
import { gabungKeranjang, hitungKembali, hitungTotal, rupiah, setQty } from '@/lib/format';
import { buildReceiptPreview, loadStoreMeta, type StoreMeta } from '@/lib/receipt';
import { useToast } from '@/components/Toast';
import { Modal } from '@/components/Modal';
import { ReceiptView } from '@/components/Receipt';
import type { CartLine, DiscountType, PaymentMethod, Product, ReceiptData } from '@/lib/types';

const PAYMENT_LABELS: { key: PaymentMethod; label: string }[] = [
  { key: 'cash', label: 'Tunai' },
  { key: 'qris', label: 'QRIS' },
  { key: 'transfer', label: 'Transfer' },
  { key: 'debit', label: 'Debit' },
  { key: 'credit', label: 'Kredit' },
];

/** Pembulatan uang tunai ke ribuan terdekat. */
function bulatUang(n: number): number {
  if (n <= 0) return 0;
  return Math.ceil(n / 1000) * 1000;
}

export default function KasirScreen() {
  const toast = useToast();

  const [store, setStore] = React.useState<StoreMeta>({
    name: 'KasirPro',
    address: '',
    phone: '',
    cashier: 'Kasir',
  });

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
  const [success, setSuccess] = React.useState<{ receipt: ReceiptData; change: number } | null>(null);

  const searchRef = React.useRef<HTMLInputElement>(null);
  const totals = hitungTotal(cart, discountType, discountValue);
  const paid = paidInput.trim() === '' ? totals.total : Math.max(0, Number(paidInput) || 0);
  const change = hitungKembali(totals.total, paid);
  const kurang = Math.max(0, totals.total - paid);

  React.useEffect(() => {
    void loadStoreMeta('KasirPro').then(setStore);
  }, []);

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

  /* Cetak otomatis bila diaktifkan (window.print → dialog printer). */
  React.useEffect(() => {
    if (success && autoPrint) {
      const t = window.setTimeout(() => window.print(), 450);
      return () => window.clearTimeout(t);
    }
  }, [success, autoPrint]);

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
      });

      setSuccess({ receipt, change });

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

  function cetakUlang() {
    if (!success) return;
    window.print();
  }

  /* ------------------------------ render ------------------------------- */
  const visible = React.useMemo(
    () => (category === 'Semua' ? products : products.filter((p) => p.category === category)),
    [products, category],
  );

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      {/* --------------------------- katalog --------------------------- */}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <form onSubmit={onScanSubmit} className="flex gap-2 border-b border-zinc-200 bg-white p-3">
          <div className="relative flex-1">
            <ScanBarcode className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              ref={searchRef}
              className="input h-10 pl-8 text-[13px]"
              placeholder="Scan barcode atau cari nama produk, lalu Enter..."
              value={query}
              onChange={(e) => onSearchChange(e.target.value)}
              autoFocus
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <button type="submit" className="btn-primary h-10 px-4">
            <Search className="h-4 w-4" /> Cari
          </button>
        </form>

        <div className="flex gap-1.5 overflow-x-auto border-b border-zinc-200 bg-white px-3 py-2">
          {['Semua', ...categories].map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={`shrink-0 rounded-full px-3 py-1 text-[12px] font-semibold transition ${
                category === c ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {loading ? (
            <p className="py-10 text-center text-[13px] text-zinc-400">Memuat produk...</p>
          ) : visible.length === 0 ? (
            <div className="py-16 text-center">
              <ShoppingCart className="mx-auto h-8 w-8 text-zinc-300" />
              <p className="mt-2 text-[13px] text-zinc-500">
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
                    className="card flex flex-col items-start gap-1 p-2.5 text-left transition hover:border-zinc-900 disabled:opacity-45"
                  >
                    <span className="line-clamp-2 text-[12.5px] font-semibold leading-tight text-zinc-800">
                      {p.name}
                    </span>
                    <span className="tnum text-[13px] font-bold text-zinc-900">{rupiah(p.price)}</span>
                    <span
                      className={`tnum text-[10.5px] ${habis ? 'text-red-500' : 'text-zinc-400'}`}
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
      <section className="flex w-full shrink-0 flex-col border-t border-zinc-200 bg-white md:w-[368px] md:border-l md:border-t-0">
        <div className="flex items-center justify-between border-b border-zinc-100 px-3.5 py-2.5">
          <h2 className="flex items-center gap-2 text-[13px] font-bold text-zinc-800">
            <ShoppingCart className="h-4 w-4" /> Keranjang
            {cart.length ? (
              <span className="rounded-full bg-zinc-900 px-1.5 py-0.5 text-[10.5px] text-white">
                {totals.itemCount}
              </span>
            ) : null}
          </h2>
          {cart.length ? (
            <button type="button" className="btn-ghost px-1.5 py-1 text-[11.5px]" onClick={clearCart}>
              <Trash2 className="h-3.5 w-3.5" /> Kosongkan
            </button>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto md:max-h-none">
          {!cart.length ? (
            <p className="px-4 py-10 text-center text-[12.5px] text-zinc-400">
              Keranjang kosong.
              <br />
              Scan barcode atau klik produk.
            </p>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {cart.map((line, i) => (
                <li key={`${line.product_id ?? line.name}-${i}`} className="flex items-center gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-semibold text-zinc-800">{line.name}</p>
                    <p className="tnum text-[11px] text-zinc-500">
                      {rupiah(line.price)} x {line.qty} ={' '}
                      <b className="text-zinc-700">{rupiah((line.price - line.discount) * line.qty)}</b>
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      className="grid h-6 w-6 place-items-center rounded-md border border-zinc-200 text-zinc-600 transition hover:bg-zinc-50"
                      onClick={() => changeQty(i, -1)}
                    >
                      <Minus className="h-3 w-3" />
                    </button>
                    <input
                      className="tnum h-6 w-10 rounded-md border border-zinc-200 text-center text-[12px] font-semibold outline-none focus:border-zinc-900"
                      value={line.qty}
                      onChange={(e) => setCart((prev) => setQty(prev, i, Number(e.target.value) || 1))}
                    />
                    <button
                      type="button"
                      className="grid h-6 w-6 place-items-center rounded-md border border-zinc-200 text-zinc-600 transition hover:bg-zinc-50"
                      onClick={() => changeQty(i, 1)}
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      className="grid h-6 w-6 place-items-center rounded-md text-zinc-300 transition hover:bg-red-50 hover:text-red-600"
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
        <div className="space-y-2 border-t border-zinc-200 bg-zinc-50 p-3">
          <div className="flex items-center gap-2">
            <select
              className="input h-8 w-[108px] text-[12px]"
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
                className="input tnum h-8 flex-1 text-[12px]"
                type="number"
                min={0}
                value={discountValue || ''}
                placeholder="0"
                onChange={(e) => setDiscountValue(Math.max(0, Number(e.target.value) || 0))}
              />
            ) : null}
          </div>

          <dl className="space-y-1 text-[12.5px]">
            <Row label="Subtotal" value={rupiah(totals.subtotal)} />
            {totals.discountAmount > 0 ? (
              <Row label="Diskon" value={`- ${rupiah(totals.discountAmount)}`} tone="red" />
            ) : null}
            <div className="flex items-center justify-between border-t border-dashed border-zinc-300 pt-1.5">
              <dt className="text-[13px] font-bold text-zinc-700">TOTAL</dt>
              <dd className="tnum text-[19px] font-bold text-zinc-900">{rupiah(totals.total)}</dd>
            </div>
          </dl>

          <div className="flex flex-wrap gap-1">
            {PAYMENT_LABELS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setPaymentMethod(p.key)}
                className={`rounded-md px-2 py-1 text-[11.5px] font-semibold transition ${
                  paymentMethod === p.key
                    ? 'bg-zinc-900 text-white'
                    : 'bg-white text-zinc-600 ring-1 ring-zinc-200 hover:bg-zinc-50'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                className="input tnum h-9 pr-12 text-[13px]"
                type="number"
                min={0}
                value={paidInput}
                placeholder={String(totals.total)}
                onChange={(e) => setPaidInput(e.target.value)}
                onFocus={(e) => e.currentTarget.select()}
              />
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10.5px] text-zinc-400">
                uang
              </span>
            </div>
            <button
              type="button"
              className="btn-outline h-9 shrink-0 px-2.5 text-[11.5px]"
              onClick={() => setPaidInput(String(bulatUang(totals.total)))}
              title="Bulatkan ke ribuan terdekat"
            >
              Pas
            </button>
          </div>

          {kurang > 0 ? (
            <p className="text-[11.5px] font-semibold text-red-600">Kurang: {rupiah(kurang)}</p>
          ) : change > 0 ? (
            <p className="text-[11.5px] font-semibold text-emerald-700">Kembali: {rupiah(change)}</p>
          ) : null}

          <input
            className="input h-8 text-[12px]"
            value={note}
            placeholder="Catatan (opsional)"
            onChange={(e) => setNote(e.target.value)}
          />

          <label className="flex items-center gap-2 text-[11.5px] text-zinc-600">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-zinc-900"
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
            className="btn-success h-11 w-full text-[14px]"
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
        onClose={() => setSuccess(null)}
        footer={
          <>
            <button type="button" className="btn-outline" onClick={() => setSuccess(null)}>
              Selesai
            </button>
            <button type="button" className="btn-primary" onClick={cetakUlang}>
              <Printer className="h-4 w-4" /> Cetak Struk
            </button>
          </>
        }
      >
        {success ? (
          <div className="space-y-2.5">
            <div className="flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-emerald-800">
              <CheckCircle2 className="h-5 w-5 shrink-0" />
              <div>
                <p className="text-[13px] font-bold">{success.receipt.invoiceNo}</p>
                <p className="text-[11.5px]">{success.receipt.storeName}</p>
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 p-3 text-center">
              <p className="text-[11px] uppercase tracking-wide text-zinc-500">Kembalian</p>
              <p className="tnum text-[26px] font-bold text-zinc-900">{rupiah(success.change)}</p>
            </div>

            <ReceiptView data={success.receipt} />
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'red' }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-zinc-500">{label}</dt>
      <dd className={`tnum font-semibold ${tone === 'red' ? 'text-red-600' : 'text-zinc-700'}`}>{value}</dd>
    </div>
  );
}