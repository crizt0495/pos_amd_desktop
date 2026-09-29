'use client';

import * as React from 'react';
import {
  AlertTriangle,
  BookOpen,
  BookmarkPlus,
  CornerDownLeft,
  CreditCard,
  FilePlus2,
  Landmark,
  Pencil,
  Printer,
  QrCode,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';

import { customersApi, nextInvoicePreview, productsApi, settingsApi, transactionsApi } from '@/lib/api';
import {
  gabungKeranjang,
  hitungKembali,
  hitungTotal,
  rupiah,
  satuanOptions,
} from '@/lib/format';
import { buildReceiptPreview, loadStoreMeta, type StoreMeta } from '@/lib/receipt';
import { useToast } from '@/components/Toast';
import { Modal } from '@/components/Modal';
import { ReceiptView } from '@/components/Receipt';
import type { CartLine, Customer, PaymentMethod, Product, ReceiptData } from '@/lib/types';

/** Metode pembayaran — urut & label mengikuti kolom bayar iPOS. */
const PAY_FIELDS: { key: PaymentMethod; label: string; Icon: typeof Wallet }[] = [
  { key: 'cash', label: 'Tunai', Icon: Wallet },
  { key: 'qris', label: 'QRIS', Icon: QrCode },
  { key: 'transfer', label: 'Transfer', Icon: Landmark },
  { key: 'debit', label: 'Kartu Debit', Icon: CreditCard },
  { key: 'credit', label: 'Kredit', Icon: CreditCard },
];

/** Baris kosong sebagai penutup grid — ala iPOS. */
const KOSONG_SAMPAI = 8;

const PENDING_KEY = 'kasirpro.pending.v1';

type Pending = {
  id: string;
  note: string;
  at: string;
  customer: string;
  lines: CartLine[];
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
  const [customer, setCustomer] = React.useState('Umum');
  const [sales, setSales] = React.useState('');
  const [keterangan, setKeterangan] = React.useState('');

  /* ------------------------------ item entry -------------------------- */
  const [products, setProducts] = React.useState<Product[]>([]);
  const [lines, setLines] = React.useState<CartLine[]>([]);
  const [itemCode, setItemCode] = React.useState('');
  const [itemQty, setItemQty] = React.useState(1);
  const [activeRow, setActiveRow] = React.useState<number | null>(null);
  const [zone, setZone] = React.useState<'header' | 'detail'>('header');

  const codeRef = React.useRef<HTMLInputElement>(null);
  const qtyRef = React.useRef<HTMLInputElement>(null);

  /* ------------------------------ pembayaran -------------------------- */
  const [pay, setPay] = React.useState<Record<PaymentMethod, string>>({
    cash: '',
    qris: '',
    transfer: '',
    debit: '',
    credit: '',
  });
  const [method, setMethod] = React.useState<PaymentMethod>('cash');

  /* ------------------------------ pending ----------------------------- */
  const [pending, setPending] = React.useState<Pending[]>([]);
  const [savePendOpen, setSavePendOpen] = React.useState(false);
  const [pendNote, setPendNote] = React.useState('');
  const [pendListOpen, setPendListOpen] = React.useState(false);

  /* ------------------------------ modal ------------------------------- */
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [success, setSuccess] = React.useState<{ receipt: ReceiptData; change: number } | null>(null);
  const [autoPrint, setAutoPrint] = React.useState(true);

  const flashTimer = React.useRef<number | null>(null);
  const [flashKey, setFlashKey] = React.useState<string | null>(null);

  /* ------------------------------ turunan ----------------------------- */
  const totals = hitungTotal(lines, 'none', 0);
  const subtotalKotor = React.useMemo(
    () => lines.reduce((s, l) => s + l.price * l.qty, 0),
    [lines],
  );
  const totalPotongan = React.useMemo(
    () => lines.reduce((s, l) => s + (l.discount || 0) * l.qty, 0),
    [lines],
  );
  const totalBayar = PAY_FIELDS.reduce((s, f) => s + (Number(pay[f.key]) || 0), 0);
  const kurang = Math.max(0, totals.total - totalBayar);
  const change = hitungKembali(totals.total, totalBayar);
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
      if (cRes.ok && cRes.data.length) setCustomers(cRes.data);
      setInvoiceNo(invRes);
    })();
    void settingsApi.get<boolean>('autoPrint', true).then((v) => setAutoPrint(v !== false));
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

  function resetBayar() {
    setPay({ cash: '', qris: '', transfer: '', debit: '', credit: '' });
    setMethod('cash');
  }

  /** Tambah satu baris dari Kode Item. 1 = sukses. */
  async function tambahBaris(): Promise<boolean> {
    const code = itemCode.trim();
    if (!code) return false;

    const qty = Math.max(1, Math.floor(Number(itemQty) || 1));
    const lower = code.toLowerCase();

    let p: Product | undefined = products.find((x) => (x.barcode ?? '').toLowerCase() === lower);

    if (!p) {
      const byBarcode = await productsApi.findByBarcode(code);
      if (byBarcode.ok && byBarcode.data) p = byBarcode.data;
    }

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

    if (!p) {
      toast.info('Item tidak ditemukan', `"${code}" tidak ada di master barang.`);
      return false;
    }

    const units = satuanOptions(p);
    setLines((prev) =>
      gabungKeranjang(prev, {
        product_id: p!.id,
        barcode: p!.barcode,
        name: p!.name,
        price: p!.price,
        cost: p!.cost,
        qty,
        discount: 0,
        unit: units[0] ?? p!.unit,
        satuanList: units,
        stock: p!.stock,
      }),
    );
    kilat(p.id);
    setItemCode('');
    return true;
  }

  /** Enter di Kode Item: kosong → pindah ke Jumlah (alur iPOS). */
  async function onKodeEnter(e: React.KeyboardEvent) {
    if (e.key !== 'Enter') return; // janganbekuk ketikan huruf/barcode
    e.preventDefault();
    if (!itemCode.trim()) {
      setZone('detail');
      qtyRef.current?.focus();
      qtyRef.current?.select();
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
      copy[i] = typeof l.stock === 'number' ? { ...l, qty: Math.min(next, Math.max(1, l.stock)) } : { ...l, qty: next };
      return copy;
    });
  }, []);

  const ubah = React.useCallback((i: number, patch: Partial<CartLine>) => {
    setLines((prev) => {
      const l = prev[i];
      if (!l) return prev;
      const copy = [...prev];
      copy[i] = { ...l, ...patch };
      return copy;
    });
  }, []);

  const hapusBaris = React.useCallback((i: number) => {
    setLines((prev) => prev.filter((_, x) => x !== i));
  }, []);

  /* ------------------------------ transaksi --------------------------- */
  const resetForm = React.useCallback(() => {
    setLines([]);
    setItemCode('');
    setItemQty(1);
    setKeterangan('');
    setActiveRow(null);
    resetBayar();
    void nextInvoicePreview().then(setInvoiceNo);
    setTimeout(fokusKode, 30);
  }, [fokusKode]);

  function simpanPendingSekarang() {
    if (!lines.length) return;
    const p: Pending = {
      id: `${Date.now()}`,
      note: pendNote.trim() || `${totals.itemCount} item — ${rupiah(totals.total)}`,
      at: new Date().toLocaleString('id-ID'),
      customer,
      lines,
    };
    simpanPending([p, ...pending]);
    setSavePendOpen(false);
    setPendNote('');
    resetForm();
    toast.ok('Disimpan sebagai pending', p.note);
  }

  function lanjutPending(p: Pending) {
    setLines(p.lines);
    setCustomer(p.customer);
    setPendListOpen(false);
    setTimeout(fokusKode, 30);
    toast.info('Pending dilanjutkan', p.note);
  }

  function hapusPending(id: string) {
    simpanPending(pending.filter((p) => p.id !== id));
  }

  /** Cash register untuk isi otomatis Tunai (sisa hutang). */
  function setTunaiOtomatis() {
    setPay((prev) => ({ ...prev, cash: String(totals.total) }));
    setMethod('cash');
  }

  async function bayar() {
    if (!lines.length || saving) return;
    if (kurang > 0) {
      toast.error('Pembayaran belum lunas', `Kurang ${rupiah(kurang)}.`);
      return;
    }

    setSaving(true);
    try {
      // API tidak punya kolom sales, jadi digabung ke keterangan (ala iPOS: Sales & Keterangan).
      const catatan = [
        sales.trim() ? `Sales: ${sales.trim()}` : '',
        keterangan.trim(),
      ]
        .filter(Boolean)
        .join(' — ');

      const res = await transactionsApi.create({
        lines,
        discountType: 'none',
        discountValue: 0,
        paymentMethod: method,
        paid: totalBayar,
        note: catatan || null,
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
        lines,
        subtotal: totals.subtotal,
        discountAmount: 0,
        total: totals.total,
        paid: totalBayar,
        changeDue: change,
        paymentMethod: PAY_FIELDS.find((p) => p.key === method)?.label ?? 'Tunai',
      });

      setSuccess({ receipt, change });
      resetForm();

      const pRes = await productsApi.list('');
      if (pRes.ok) setProducts(pRes.data);
      setInvoiceNo(await nextInvoicePreview());
    } finally {
      setSaving(false);
    }
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

  /* ------------------------------ hotkey ------------------------------ */
  /**
   * `bayar` membaca `lines` / `pay` / `kurang` yang berubah tiap render, tapi
   * listener global sengaja tidak didaftarkan ulang tiap ketikan. Simpan
   * closure terbaru di ref supaya tombol End selalu memakai data terkini.
   */
  const hotkeyRef = React.useRef({ lines: 0, bayar });
  React.useEffect(() => {
    hotkeyRef.current = { lines: lines.length, bayar };
  });

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName ?? '';
      const editable = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || el?.isContentEditable;
      const adaModal =
        cancelOpen || savePendOpen || pendListOpen || Boolean(success);

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
      if (e.key === 'F8' || e.key === 'F10') {
        e.preventDefault();
        fokusKode();
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
        void hotkeyRef.current.bayar();
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
    lines.length,
    zone,
    cancelOpen,
    savePendOpen,
    pendListOpen,
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
        <RbBtn kbd="F9" label="Baru" Icon={FilePlus2} onClick={resetForm} />
        <RbBtn
          kbd="F5"
          label="Pending"
          Icon={BookmarkPlus}
          onClick={() => setSavePendOpen(true)}
          disabled={!lines.length}
        />
        <RbBtn
          kbd="F6"
          label="Daftar Pending"
          Icon={BookOpen}
          onClick={() => setPendListOpen(true)}
        />
        <RbBtn kbd="F8" label="Kode Item" Icon={CornerDownLeft} onClick={fokusKode} />

        <span className="rb-sep" />

        <button
          type="button"
          onClick={() => void bayar()}
          disabled={!lines.length || saving}
          className="rb-btn-go"
        >
          Bayar
          <span className="kbd !border-white/40 !bg-white/20 !text-white">End</span>
        </button>
        <RbBtn
          label="Cetak"
          Icon={Printer}
          onClick={() => window.print()}
          disabled={!success}
        />
        <RbBtn
          kbd="Esc"
          label="Batal"
          Icon={X}
          tone="danger"
          onClick={() => setCancelOpen(true)}
          disabled={!lines.length}
        />

        <span className="ml-auto hidden shrink-0 items-center gap-2 pr-1 text-[11.5px] text-[#7a8ba0] sm:flex">
          <span className="kbd">{zone === 'header' ? 'Header' : 'Detail'}</span>
          <span>
            <b className="tnum text-[#35485c]">{totals.itemCount}</b> item ·{' '}
            <b className="tnum text-[#35485c]">{lines.length}</b> baris
          </span>
        </span>
      </div>

      {/* ====================== HEADER FORM (Kode Item) ================= */}
      <div className="shrink-0 border-b border-[#d8e0ec] bg-[#f6f9fd] px-3 py-2.5">
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-full sm:w-[300px] lg:w-[340px]">
            <label className="frm-label" htmlFor="kode-item">
              Kode Item / Barcode
            </label>
            <input
              id="kode-item"
              ref={codeRef}
              className="frm-key"
              placeholder="Scan barcode atau ketik nama, lalu Enter…"
              value={itemCode}
              onChange={onItemChange}
              onKeyDown={(e) => void onKodeEnter(e)}
              autoFocus
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
            />
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
                {customers.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
                {!customers.some((c) => c.name === customer) ? (
                  <option value={customer}>{customer}</option>
                ) : null}
              </select>
              <button
                type="button"
                onClick={() => void tambahPelanggan()}
                title="Tambah pelanggan"
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
      <div className="min-h-0 flex-1 overflow-auto bg-white">
        <table className="w-full min-w-[900px] border-collapse">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="th w-[42px] text-center">No</th>
              <th className="th w-[130px]">Kode Item</th>
              <th className="th">Nama Item</th>
              <th className="th w-[92px]">Satuan</th>
              <th className="th w-[96px] text-right">H. Pokok</th>
              <th className="th w-[104px] text-right">H. Jual</th>
              <th className="th w-[88px] text-right">Jumlah</th>
              <th className="th w-[96px] text-right">Potongan</th>
              <th className="th w-[112px] text-right">Jumlah</th>
              <th className="th w-[64px] text-center">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-10 text-center text-[12.5px] text-[#9fb0c4]">
                  Belum ada item. Scan barcode di kolom <b>Kode Item</b> lalu tekan{' '}
                  <span className="kbd">Enter</span>.
                </td>
              </tr>
            ) : null}

            {lines.map((l, i) => {
              const units = l.satuanList.length ? l.satuanList : [l.unit];
              const jumlah = (l.price - (l.discount || 0)) * l.qty;
              const rugi = l.price < l.cost;
              const kilat = l.product_id === flashKey;
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
                      onChange={(e) => ubah(i, { unit: e.target.value })}
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
                    <input
                      className="cell tnum text-right"
                      data-cell="price"
                      type="number"
                      min={0}
                      value={l.price}
                      onChange={(e) => ubah(i, { price: Math.max(0, Number(e.target.value) || 0) })}
                      onFocus={(e) => e.currentTarget.select()}
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
                    <input
                      className="cell tnum text-right"
                      data-cell="disc"
                      type="number"
                      min={0}
                      value={l.discount || 0}
                      onChange={(e) => ubah(i, { discount: Math.max(0, Number(e.target.value) || 0) })}
                      onFocus={(e) => e.currentTarget.select()}
                    />
                  </td>
                  <td className="td tnum text-right font-bold text-[#1b3a5c]">{rupiah(jumlah)}</td>
                  <td className="td text-center">
                    <div className="flex items-center justify-center gap-1">
                      {activeRow === i ? (
                        <Pencil className="h-3.5 w-3.5 text-[#f08c00]" aria-label="sedang diubah" />
                      ) : null}
                      <button
                        type="button"
                        onClick={() => hapusBaris(i)}
                        title="Hapus baris"
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

      {/* ===================== TOTAL + PEMBAYARAN ====================== */}
      <div className="shrink-0 border-t border-[#d8e0ec] bg-[#f6f9fd]">
        <div className="grid items-end gap-3 px-3 py-2.5 lg:grid-cols-[1fr_auto]">
          {/* ringkasan */}
          <dl className="space-y-1 text-[12.5px]">
            <div className="flex items-center gap-6">
              <dt className="text-[#5b6b80]">Subtotal</dt>
              <dd className="tnum w-32 font-semibold text-[#35485c]">{rupiah(subtotalKotor)}</dd>
            </div>
            <div className="flex items-center gap-6">
              <dt className="text-[#5b6b80]">Potongan</dt>
              <dd className="tnum w-32 font-semibold text-[#c92a2a]">
                {totalPotongan > 0 ? `- ${rupiah(totalPotongan)}` : rupiah(0)}
              </dd>
            </div>
            {rugiLines.length > 0 ? (
              <p className="flex items-center gap-1.5 text-[11px] font-bold text-[#e03131]">
                <AlertTriangle className="h-3.5 w-3.5" />
                {rugiLines.length} barang dijual di bawah harga pokok
              </p>
            ) : null}
          </dl>

          {/* grand total */}
          <div className="text-right">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#5b6b80]">Total</p>
            <p className="grand-total text-[34px]">{rupiah(totals.total)}</p>
          </div>
        </div>

        {/* kotak pembayaran ala iPOS */}
        <div className="flex flex-wrap items-end gap-2 px-3 pb-2">
          {PAY_FIELDS.map(({ key, label, Icon }) => {
            const aktif = method === key;
            return (
              <div key={key} className={`pay-box ${aktif ? 'pay-box-active' : ''}`}>
                <label
                  className="mb-0.5 flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-wide text-[#5b6b80]"
                  htmlFor={`pay-${key}`}
                >
                  <Icon className="h-3 w-3" />
                  {label}
                </label>
                <input
                  id={`pay-${key}`}
                  className="tnum h-7 w-full rounded border border-transparent bg-[#f6f9fd] px-1.5 text-right text-[13px] font-semibold text-[#22374b] outline-none focus:border-[#1b5fa8] focus:bg-white"
                  type="number"
                  min={0}
                  value={pay[key]}
                  placeholder="0"
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => {
                    const v = e.target.value;
                    setPay((prev) => ({ ...prev, [key]: v }));
                    if (Number(v) > 0) setMethod(key);
                  }}
                />
              </div>
            );
          })}

          <div className="flex min-w-[150px] flex-col rounded border border-[#cdd8e6] bg-white px-2 py-1.5">
            <span className="mb-0.5 text-[9.5px] font-bold uppercase tracking-wide text-[#5b6b80]">
              Kembalian
            </span>
            <span
              className={`tnum text-right text-[13px] font-bold leading-7 ${
                kurang > 0 ? 'text-[#e03131]' : 'text-[#2f9e44]'
              }`}
            >
              {kurang > 0 ? `Kurang ${rupiah(kurang)}` : rupiah(change)}
            </span>
          </div>

          <div className="flex gap-1.5">
            <button type="button" className="rb-btn h-11" onClick={setTunaiOtomatis} disabled={!lines.length}>
              Uang Pas
            </button>
            <button
              type="button"
              className="rb-btn h-11"
              onClick={resetBayar}
              disabled={totalBayar === 0}
            >
              Kosongkan
            </button>
            <button
              type="button"
              className="rb-btn-go !h-11 !px-6"
              onClick={() => void bayar()}
              disabled={!lines.length || saving || kurang > 0}
            >
              {saving ? 'Menyimpan…' : 'Simpan & Bayar'}
            </button>
          </div>
        </div>
      </div>

      {/* ====================== MODAL SIMPAN PENDING ==================== */}
      <Modal
        open={savePendOpen}
        title="Simpan Pending"
        onClose={() => setSavePendOpen(false)}
        width="max-w-sm"
        footer={
          <>
            <button type="button" className="btn-outline" onClick={() => setSavePendOpen(false)}>
              Batal
            </button>
            <button type="button" className="btn-primary" onClick={simpanPendingSekarang}>
              Simpan
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
                <button type="button" className="rb-btn" onClick={() => lanjutPending(p)}>
                  Lanjut
                </button>
                <button
                  type="button"
                  onClick={() => hapusPending(p.id)}
                  title="Hapus pending"
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
                resetForm();
                setCancelOpen(false);
                toast.info('Transaksi dibatalkan', 'Keranjang dikosongkan.');
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
            <button type="button" className="btn-primary" onClick={() => window.print()}>
              <Printer className="h-4 w-4" /> Cetak Struk
            </button>
          </>
        }
      >
        {success ? (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between rounded-lg border border-[#b7e0c1] bg-[#ebfbee] px-3 py-2">
              <div>
                <p className="tnum text-[13px] font-bold text-[#1b3a5c]">{success.receipt.invoiceNo}</p>
                <p className="text-[11px] text-[#4a5b70]">{success.receipt.storeName}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-wide text-[#7a8ba0]">Kembalian</p>
                <p className="tnum text-[20px] font-bold text-accent-600">{rupiah(success.change)}</p>
              </div>
            </div>
            <ReceiptView data={success.receipt} />
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
