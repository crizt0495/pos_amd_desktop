'use client';

import * as React from 'react';
import { Store } from 'lucide-react';

import { settingsApi } from '@/lib/api';
import { Modal } from './Modal';
import { useToast } from './Toast';

type Form = {
  storeName: string;
  storeAddress: string;
  storePhone: string;
  cashierName: string;
};

/** Pengaturan toko sederhana (nama, alamat, telepon, kasir) — tersimpan per akun. */
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
  const [form, setForm] = React.useState<Form>({
    storeName: '',
    storeAddress: '',
    storePhone: '',
    cashierName: '',
  });
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
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

  async function simpan() {
    setSaving(true);
    try {
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
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Pengaturan Toko"
      onClose={onClose}
      width="max-w-md"
      footer={
        <>
          <button type="button" className="btn-outline" onClick={onClose}>
            Batal
          </button>
          <button type="button" className="btn-primary" onClick={() => void simpan()} disabled={saving}>
            {saving ? 'Menyimpan...' : 'Simpan'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
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
      </div>
    </Modal>
  );
}