'use client';

import * as React from 'react';
import { Eye, Loader2, Monitor, Store } from 'lucide-react';

import { settingsApi } from '@/lib/api';
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
import { Modal } from './Modal';
import { useToast } from './Toast';

type Form = {
  storeName: string;
  storeAddress: string;
  storePhone: string;
  cashierName: string;
};

type Tab = 'toko' | 'tampilan';

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
      setForm({ storeName, storeAddress, storePhone, cashierName });
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
    res.push(await settingsApi.set('storePhone', form.storePhone.trim()));
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
        ) : (
          <button type="button" className="btn-primary" onClick={onClose}>
            Selesai
          </button>
        )
      }
    >
      {/* Tab: Toko (per akun) | Tampilan (per perangkat) */}
      <div className="mb-3 flex gap-1 rounded-lg bg-[#eef3f9] p-1">
        {(
          [
            { id: 'toko' as const, label: 'Toko', Icon: Store },
            { id: 'tampilan' as const, label: 'Tampilan', Icon: Monitor },
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

      {tab === 'tampilan' ? (
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
            <input
              id="s-phone"
              className="input tnum"
              value={form.storePhone}
              onChange={(e) => setForm({ ...form, storePhone: e.target.value })}
              placeholder="0812-3456-7890"
            />
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
