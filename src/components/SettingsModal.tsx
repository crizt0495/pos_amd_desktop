'use client';

import * as React from 'react';
import { BadgePercent, Eye, Loader2, Monitor, Printer as PrinterIcon, Store } from 'lucide-react';

import { productsApi, settingsApi } from '@/lib/api';
import { useButtonGuard } from '@/lib/useButtonGuard';
import {
  bacaTampilan,
  dengarTampilan,
  setTampilan,
  ukuranFont,
  OPSI_POSISI,
  OPSI_UKURAN,
  TAMPILAN_AWAL,
  type PreferensiTampilan,
} from '@/lib/tampilan';
import {
  bacaDiskonPaten,
  contohPotonganPaten,
  dengarDiskonPaten,
  DISKON_PATEN_AWAL,
  LABEL_PATEN_DEFAULT,
  ringkasanPaten,
  setDiskonPaten,
  type DiskonPaten,
} from '@/lib/diskonPaten';
import { bacaPrinterSettings, setPrinterSettings, type PreferensiPrinter, type UkuranPrinter } from '@/lib/printerSettings';
import {
  didukungBluetooth,
  dengarStatusBluetooth,
  pasangkanBluetooth,
  putusBluetooth,
  type StatusBluetooth,
} from '@/lib/bluetoothPrinter';
import { rupiah } from '@/lib/format';
import { bersihkanTelepon } from '@/lib/telepon';
import { Modal } from './Modal';
import { RupiahInput } from './RupiahInput';
import { TeleponInput } from './TeleponInput';
import { useToast } from './Toast';

type Form = {
  storeName: string;
  storeAddress: string;
  storePhone: string;
  cashierName: string;
};

type Tab = 'toko' | 'diskon' | 'tampilan' | 'printer';

/** Pengaturan toko (tersimpan per akun) + preferensi tampilan layar kasir. */
export function SettingsModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved?: (storeName: string) => void;
}) {
  const toast = useToast();
  const [tab, setTab] = React.useState<Tab>('toko');
  const [form, setForm] = React.useState<Form>({
    storeName: '',
    storeAddress: '',
    storePhone: '',
    cashierName: '',
  });
  const simpanGuard = useButtonGuard();
  const saving = simpanGuard.busy;

  React.useEffect(() => {
    if (!open) return;
    setTab('toko');
    void (async () => {
      const [storeName, storeAddress, storePhone, cashierName] = await Promise.all([
        settingsApi.get<string>('storeName', ''),
        settingsApi.get<string>('storeAddress', ''),
        settingsApi.get<string>('storePhone', ''),
        settingsApi.get<string>('cashierName', ''),
      ]);
      // Nilai lama bisa berisi tanda hubung/spasi (mis. "0812-3456-7890"). Bersihkan
      // saat dibaca supaya yang tampil di input — lalu ikut tersimpan — angka murni.
      setForm({ storeName, storeAddress, storePhone: bersihkanTelepon(storePhone), cashierName });
    })();
  }, [open]);

  /** Simpan pengaturan: satu klik = satu set; klik kedua ditolak 1,5 detik. */
  function klikSimpan() {
    if (saving) {
      toast.info('Mohon tunggu…', 'Pengaturan sedang disimpan.');
      return;
    }
    void simpanGuard.guard(kirim, {
      cooldownMs: 1500,
      pesanTunggu: 'Pengaturan sedang disimpan…',
      onBlocked: (pesan) => toast.info('Mohon tunggu…', pesan),
    });
  }

  async function kirim() {
    const res = [];
    res.push(await settingsApi.set('storeName', form.storeName.trim() || 'Toko Saya'));
    res.push(await settingsApi.set('storeAddress', form.storeAddress.trim()));
    res.push(await settingsApi.set('storePhone', bersihkanTelepon(form.storePhone)));
    res.push(await settingsApi.set('cashierName', form.cashierName.trim() || 'Kasir'));
    const failed = res.filter((r) => !r.ok);
    if (failed.length) {
      toast.error('Gagal menyimpan pengaturan', failed[0]?.error ?? '');
      return;
    }
    toast.ok('Pengaturan disimpan');
    setForm((f) => ({ ...f, storeName: f.storeName.trim() || 'Toko Saya' }));
    onSaved?.(form.storeName.trim() || 'Toko Saya');
    onClose();
  }

  /* -------------------- tab Printer (struk) ---------------------- */
  const [printer, setPrinter] = React.useState<PreferensiPrinter>(bacaPrinterSettings());
  React.useEffect(() => {
    setPrinter(bacaPrinterSettings());
  }, []);
  function ubahPrinter(patch: Partial<PreferensiPrinter>) {
    setPrinter((prev) => {
      const next = { ...prev, ...patch };
      setPrinterSettings(next);
      return next;
    });
  }
  const [btStatus, setBtStatus] = React.useState<StatusBluetooth>('nonaktif');
  const [btBusy, setBtBusy] = React.useState(false);
  React.useEffect(() => dengarStatusBluetooth(setBtStatus), []);
  const btLabel: Record<StatusBluetooth, string> = {
    'tidak-didukung': 'Tidak didukung browser',
    nonaktif: 'Belum dipasangkan',
    mencoba: 'Menyambung…',
    tersambung: 'Tersambung',
    gagal: 'Gagal tersambung',
  };
  async function klikPasangBt() {
    setBtBusy(true);
    const r = await pasangkanBluetooth();
    setBtBusy(false);
    if (r.ok) toast.ok('Printer Bluetooth', r.pesan);
    else toast.error('Printer Bluetooth', r.pesan);
    setPrinter(bacaPrinterSettings());
  }

  /* ---------------------- tab Tampilan (display total) ---------------- */
  // Preferensi tampilan perangkat: langsung berlaku tanpa tombol Simpan.
  const [tampilan, setTampilanView] = React.useState<PreferensiTampilan>(TAMPILAN_AWAL);

  React.useEffect(() => {
    if (!open) return;
    setTampilanView(bacaTampilan());
    return dengarTampilan(setTampilanView);
  }, [open]);

  function ubahTampilan(patch: Partial<PreferensiTampilan>) {
    setTampilanView(setTampilan(patch));
  }

  /** Preset posisi = snap balik ke tengah/atas/bawah, koordinat bebas dibuang. */
  function ubahPosisi(v: string) {
    const posisi = v as PreferensiTampilan['posisi'];
    ubahTampilan(posisi === 'floating' ? { posisi } : { posisi, x: null, y: null });
  }

  const idxUkuran = Math.max(
    0,
    OPSI_UKURAN.findIndex((o) => o.value === tampilan.ukuran),
  );

  /* ------------------------- tab Diskon (diskon paten) ------------------- */
  // Config perangkat (bukan per akun), tapi tetap pakai tombol Simpan: kasir
  // bisa lihat pratinjau struk dulu, baru 저장annya mengunci form Diskon.
  const [paten, setPaten] = React.useState<DiskonPaten>(DISKON_PATEN_AWAL);

  React.useEffect(() => {
    if (!open) return;
    setPaten(bacaDiskonPaten());
    // Kalau diubah dari tab/jendela lain, ikut sinkron (draft belum disimpan).
    return dengarDiskonPaten(setPaten);
  }, [open]);

  function ubahPaten(patch: Partial<DiskonPaten>) {
    setPaten((p) => ({ ...p, ...patch }));
  }

  /** Simpan config paten ke localStorage perangkat ini. */
  function simpanPaten() {
    if (paten.aktif && !(paten.nilai > 0)) {
      toast.error(
        'Nilai diskon belum diisi',
        'Isi nominal atau persennya dulu, atau matikan paten.',
      );
      return;
    }
    if (paten.aktif && paten.cakupan === 'kategori' && !paten.kategori) {
      toast.error('Kategori belum dipilih', 'Pilih satu kategori, atau pilih "Semua barang".');
      return;
    }
    setDiskonPaten(paten);
    toast.ok('Diskon paten disimpan', ringkasanPaten(bacaDiskonPaten()));
    onClose();
  }

  /** Daftar kategori produk — hanya perlu saat cakupan = kategori. */
  const [kategori, setKategori] = React.useState<string[]>([]);
  const [kategoriMuat, setKategoriMuat] = React.useState(false);

  React.useEffect(() => {
    if (!open || tab !== 'diskon' || kategoriMuat) return;
    setKategoriMuat(true);
    void productsApi
      .list('', true)
      .then((res) => {
        if (!res.ok) return;
        const set = new Set<string>();
        for (const p of res.data) {
          const k = p.category.trim();
          if (k) set.add(k);
        }
        setKategori([...set].sort((a, b) => a.localeCompare(b, 'id')));
      })
      .catch(() => {
        /* daftar kategori tak wajib — paten tetap bisa untuk semua barang */
      });
  }, [open, tab, kategoriMuat]);

  return (
    <Modal
      open={open}
      title="Pengaturan"
      onClose={onClose}
      width="max-w-md"
      footer={
        tab === 'toko' ? (
          <>
            <button type="button" className="btn-outline" onClick={onClose} disabled={saving}>
              Batal
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={klikSimpan}
              disabled={saving}
              data-loading={saving}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {saving ? 'Menyimpan…' : 'Simpan'}
            </button>
          </>
        ) : tab === 'diskon' ? (
          <>
            <button type="button" className="btn-outline" onClick={onClose}>
              Batal
            </button>
            <button type="button" className="btn-primary" onClick={simpanPaten}>
              Simpan Diskon
            </button>
          </>
        ) : (
          <button type="button" className="btn-primary" onClick={onClose}>
            Selesai
          </button>
        )
      }
    >
      {/* Tab: Toko (per akun) | Diskon | Tampilan (per perangkat) */}
      <div className="mb-3 flex gap-1 rounded-lg bg-[#eef3f9] p-1">
        {(
          [
            { id: 'toko' as const, label: 'Toko', Icon: Store },
            { id: 'diskon' as const, label: 'Diskon', Icon: BadgePercent },
            { id: 'tampilan' as const, label: 'Tampilan', Icon: Monitor },
            { id: 'printer' as const, label: 'Printer', Icon: PrinterIcon },
          ] satisfies { id: Tab; label: string; Icon: typeof Store }[]
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-pressed={tab === t.id}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[12.5px] font-bold transition ${
              tab === t.id
                ? 'bg-white text-[#1b5fa8] shadow-sm'
                : 'text-[#5b6b80] hover:bg-white/60'
            }`}
          >
            <t.Icon className="h-3.5 w-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'diskon' ? (
        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded-lg bg-[#f6f9fd] p-2.5 text-[11.5px] text-[#5b6b80]">
            <BadgePercent className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Diskon tetap yang dipasang pemilik toko. Kasir tak bisa mengubahnya: kolom Potongan tiap
            item baru langsung terisi dan struk memakai label di bawah. Berlaku di perangkat ini
            setelah disimpan.
          </div>

          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-[#d8e0ec] p-2.5">
            <span className="text-[12.5px] font-semibold text-[#35485c]">
              Aktifkan Diskon Paten
            </span>
            <input
              type="checkbox"
              className="h-4 w-4 accent-[#1b5fa8]"
              checked={paten.aktif}
              onChange={(e) => ubahPaten({ aktif: e.target.checked })}
            />
          </label>

          {/* Isian lain hanya aktif kalau paten hidup — hindari "nilai 5 tapi mati". */}
          <fieldset disabled={!paten.aktif} className="space-y-3 disabled:opacity-55">
            <div>
              <span className="label">Jenis Diskon</span>
              <div className="flex overflow-hidden rounded border border-[#cdd8e6]">
                {(['rp', 'pct'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => ubahPaten({ tipe: t })}
                    aria-pressed={paten.tipe === t}
                    className={`flex-1 py-1.5 text-[12.5px] font-semibold transition ${
                      paten.tipe === t ? 'bg-[#1b5fa8] text-white' : 'bg-white text-[#5b6b80]'
                    }`}
                  >
                    {t === 'rp' ? 'Nominal (Rp)' : 'Persen (%)'}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="label" htmlFor="s-paten-nilai">
                Nilai Diskon
              </label>
              {paten.tipe === 'rp' ? (
                <RupiahInput
                  id="s-paten-nilai"
                  ariaLabel="Nilai diskon paten (nominal)"
                  className="input tnum text-right"
                  value={paten.nilai}
                  min={0}
                  onChange={(v: number) => ubahPaten({ nilai: Math.max(0, v) })}
                  placeholder="0"
                />
              ) : (
                <input
                  id="s-paten-nilai"
                  type="number"
                  min={0}
                  max={100}
                  className="input tnum text-right"
                  value={paten.nilai || ''}
                  placeholder="0"
                  onChange={(e) =>
                    ubahPaten({
                      nilai: Math.min(100, Math.max(0, Math.floor(Number(e.target.value) || 0))),
                    })
                  }
                />
              )}
            </div>

            <div>
              <span className="label">Berlaku Untuk</span>
              <div className="space-y-2">
                <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-[#35485c]">
                  <input
                    type="radio"
                    name="s-paten-cakupan"
                    className="h-3.5 w-3.5 accent-[#1b5fa8]"
                    checked={paten.cakupan === 'semua'}
                    onChange={() => ubahPaten({ cakupan: 'semua' })}
                  />
                  Semua barang
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-[#35485c]">
                  <input
                    type="radio"
                    name="s-paten-cakupan"
                    className="h-3.5 w-3.5 accent-[#1b5fa8]"
                    checked={paten.cakupan === 'kategori'}
                    onChange={() => ubahPaten({ cakupan: 'kategori' })}
                  />
                  Kategori tertentu
                </label>
                {paten.cakupan === 'kategori' ? (
                  <select
                    className="input"
                    aria-label="Kategori yang mendapat diskon paten"
                    value={paten.kategori}
                    onChange={(e) => ubahPaten({ kategori: e.target.value })}
                  >
                    <option value="">
                      {kategoriMuat
                        ? kategori.length
                          ? '-- pilih kategori --'
                          : 'Belum ada produk berkategori'
                        : 'Memuat kategori…'}
                    </option>
                    {kategori.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
            </div>

            <div>
              <label className="label" htmlFor="s-paten-label">
                Tampilkan di Struk sebagai
              </label>
              <input
                id="s-paten-label"
                className="input"
                value={paten.label}
                maxLength={40}
                placeholder={LABEL_PATEN_DEFAULT}
                onChange={(e) => ubahPaten({ label: e.target.value })}
              />
              <p className="mt-1 text-[10.5px] text-[#93a5b9]">
                Untuk mode %, persen ikut tercetak otomatis, mis. &ldquo;
                {paten.label || LABEL_PATEN_DEFAULT} 5%&rdquo;.
              </p>
            </div>
          </fieldset>

          {/* Pratinjau: kasir bisa lihat dampaknya sebelum disimpan. */}
          <div className="rounded-lg border border-dashed border-[#cdd8e6] bg-[#f6f9fd] p-2.5">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#93a5b9]">
              Pratinjau ({ringkasanPaten(paten)})
            </p>
            <p className="mt-1 font-mono text-[11px] text-[#35485c]">
              Teh Pucuk 3500 — {paten.label || LABEL_PATEN_DEFAULT}
              {paten.tipe === 'pct' && paten.nilai > 0 ? ` ${Math.floor(paten.nilai)}%` : ''} (
              {paten.nilai > 0 ? '-' : ''}
              {rupiah(contohPotonganPaten(paten))})
            </p>
            {paten.aktif && paten.cakupan === 'kategori' && !paten.kategori ? (
              <p className="mt-1 text-[10.5px] font-semibold text-[#e03131]">
                Pilih kategorinya — selama ini belum ada, jadi tak ada barang yang kena diskon.
              </p>
            ) : null}
          </div>
        </div>
      ) : tab === 'printer' ? (
        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded-lg bg-[#f6f9fd] p-2.5 text-[11.5px] text-[#5b6b80]">
            <PrinterIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Setting ini hanya berlaku di perangkat ini. Pilihan “System Printer” dikirim ke
            browser lewat <code>window.print()</code>.
          </div>

          <label className="block space-y-1">
            <span className="label">Pilih Printer</span>
            <select
              className="input"
              value={printer.nama}
              onChange={(e) => ubahPrinter({ nama: e.target.value })}
            >
              <option value="System Printer">System Printer (default browser)</option>
            </select>
            <p className="text-[10.5px] text-[#7a8ba0]">
              Daftar printer spesifik disediakan browser saat <code>window.print()</code>;
              pilihan saat ini tetap memakai dialog print default.
            </p>
          </label>

          <div className="space-y-1">
            <span className="label">Ukuran Kertas</span>
            <div className="grid grid-cols-3 gap-1.5">
              {(['58mm', '80mm', 'A4'] as UkuranPrinter[]).map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => ubahPrinter({ ukuran: u })}
                  className={`rounded-lg border px-2 py-2 text-[12px] font-bold transition ${
                    printer.ukuran === u
                      ? 'border-[#1b5fa8] bg-[#e8f1fa] text-[#1b5fa8]'
                      : 'border-[#d8e0ec] bg-white text-[#5b6b80]'
                  }`}
                >
                  {u === '58mm' ? '58mm Thermal' : u === '80mm' ? '80mm Thermal' : 'A4'}
                </button>
              ))}
            </div>
          </div>

          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-[#d8e0ec] p-2.5">
            <span className="text-[12.5px] font-semibold text-[#35485c]">Auto Print setelah simpan transaksi</span>
            <input
              type="checkbox"
              className="h-4 w-4 accent-[#1b5fa8]"
              checked={printer.autoPrint}
              onChange={(e) => ubahPrinter({ autoPrint: e.target.checked })}
            />
          </label>

          {/* ---------- Printer Bluetooth (Web Bluetooth, auto reconnect) ---------- */}
          <div className="space-y-2 rounded-lg border border-[#d8e0ec] p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12.5px] font-semibold text-[#35485c]">Printer Bluetooth</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${
                  btStatus === 'tersambung'
                    ? 'bg-[#e6f6ed] text-[#0ca678]'
                    : btStatus === 'gagal'
                      ? 'bg-[#ffe3e3] text-[#e03131]'
                      : 'bg-[#eef3f9] text-[#5b6b80]'
                }`}
              >
                {btLabel[btStatus]}
              </span>
            </div>
            {printer.btDeviceName ? (
              <p className="text-[11px] text-[#7a8ba0]">
                Perangkat: <strong>{printer.btDeviceName}</strong>
                {printer.btAutoConnect ? ' — sambung otomatis saat aplikasi dibuka.' : ''}
              </p>
            ) : (
              <p className="text-[11px] text-[#7a8ba0]">
                Pasangkan sekali, lalu aplikasi menyambung sendiri tiap dibuka. Struk langsung
                terkirim ke printer thermal (58mm/80mm) tanpa dialog print.
              </p>
            )}
            {didukungBluetooth() ? (
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-primary !py-1.5 text-[12px]"
                  onClick={() => void klikPasangBt()}
                  disabled={btBusy}
                >
                  {btBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  {printer.btDeviceId ? 'Ganti Perangkat' : 'Pasangkan Printer'}
                </button>
                {printer.btDeviceId ? (
                  <button
                    type="button"
                    className="btn-outline !py-1.5 text-[12px]"
                    onClick={() => {
                      putusBluetooth();
                      setPrinter(bacaPrinterSettings());
                    }}
                  >
                    Putuskan
                  </button>
                ) : null}
              </div>
            ) : (
              <p className="text-[10.5px] font-semibold text-[#e03131]">
                Browser ini tidak mendukung Web Bluetooth — pakai Chrome atau Edge.
              </p>
            )}
            {printer.btDeviceId ? (
              <label className="flex cursor-pointer items-center justify-between gap-3">
                <span className="text-[12px] font-semibold text-[#35485c]">
                  Sambung otomatis
                </span>
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[#1b5fa8]"
                  checked={printer.btAutoConnect}
                  onChange={(e) => ubahPrinter({ btAutoConnect: e.target.checked })}
                />
              </label>
            ) : null}
          </div>
        </div>
      ) : tab === 'tampilan' ? (
        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded-lg bg-[#f6f9fd] p-2.5 text-[11.5px] text-[#5b6b80]">
            <Eye className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Display total besar di layar kasir untuk pelanggan. Disimpan di perangkat ini saja,
            berlaku seketika tanpa tombol Simpan.
          </div>

          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-[#d8e0ec] p-2.5">
            <span className="text-[12.5px] font-semibold text-[#35485c]">
              Tampilkan Total Besar
            </span>
            <input
              type="checkbox"
              className="h-4 w-4 accent-[#1b5fa8]"
              checked={tampilan.aktif}
              onChange={(e) => ubahTampilan({ aktif: e.target.checked })}
            />
          </label>

          <div>
            <label className="label" htmlFor="s-posisi">
              Posisi
            </label>
            <select
              id="s-posisi"
              className="input"
              value={tampilan.posisi}
              disabled={!tampilan.aktif}
              onChange={(e) => ubahPosisi(e.target.value)}
            >
              {OPSI_POSISI.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[10.5px] text-[#93a5b9]">
              Pilih &ldquo;Floating&rdquo; lalu seret kotaknya di layar kasir — posisinya tersimpan
              otomatis.
            </p>
          </div>

          <div>
            <span className="label">Ukuran Font</span>
            <input
              type="range"
              min={0}
              max={OPSI_UKURAN.length - 1}
              step={1}
              className="w-full accent-[#1b5fa8]"
              value={idxUkuran}
              disabled={!tampilan.aktif}
              aria-label="Ukuran font total besar"
              onChange={(e) =>
                ubahTampilan({
                  ukuran: OPSI_UKURAN[Number(e.target.value)].value,
                })
              }
            />
            <div className="mt-1 flex justify-between text-[10.5px] font-semibold text-[#93a5b9]">
              {OPSI_UKURAN.map((o, i) => (
                <span key={o.value} className={i === idxUkuran ? 'text-[#1b5fa8]' : undefined}>
                  {o.label}
                </span>
              ))}
            </div>
          </div>

          {tampilan.aktif ? (
            <div className="flex justify-center rounded-lg border border-dashed border-[#cdd8e6] bg-[#f6f9fd] py-3">
              <div className="rounded-2xl bg-[#0b1220] px-5 py-3 text-white ring-1 ring-white/10">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/50">
                  Total Belanja
                </p>
                <p
                  className="tnum font-black leading-none"
                  style={{ fontSize: ukuranFont(tampilan.ukuran) }}
                >
                  Rp. 0
                </p>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            klikSimpan();
          }}
        >
          <div className="flex items-center gap-2 rounded-lg bg-[#f6f9fd] p-2.5 text-[11.5px] text-[#5b6b80]">
            <Store className="h-3.5 w-3.5 shrink-0" />
            Data ini tercetak pada struk kasir.
          </div>

          <div>
            <label className="label" htmlFor="s-name">
              Nama Toko
            </label>
            <input
              id="s-name"
              className="input"
              value={form.storeName}
              onChange={(e) => setForm({ ...form, storeName: e.target.value })}
              placeholder="Toko Saya"
            />
          </div>

          <div>
            <label className="label" htmlFor="s-addr">
              Alamat
            </label>
            <input
              id="s-addr"
              className="input"
              value={form.storeAddress}
              onChange={(e) => setForm({ ...form, storeAddress: e.target.value })}
              placeholder="Jl. Contoh No. 1, Kota"
            />
          </div>

          <div>
            <label className="label" htmlFor="s-phone">
              Telepon
            </label>
            <TeleponInput
              id="s-phone"
              className="input tnum"
              value={form.storePhone}
              onChange={(v) => setForm({ ...form, storePhone: v })}
              placeholder="081234567890"
            />
            <p className="mt-1 text-[11px] text-zinc-500">
              Hanya angka, tanpa tanda hubung. Tampil sebagai &ldquo;Telp&rdquo; di struk.
            </p>
          </div>

          <div>
            <label className="label" htmlFor="s-cashier">
              Nama Kasir
            </label>
            <input
              id="s-cashier"
              className="input"
              value={form.cashierName}
              onChange={(e) => setForm({ ...form, cashierName: e.target.value })}
              placeholder="Kasir"
            />
          </div>
        </form>
      )}
    </Modal>
  );
}
