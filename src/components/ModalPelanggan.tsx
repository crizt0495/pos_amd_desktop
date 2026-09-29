'use client';

import * as React from 'react';
import { Loader2, UserPlus } from 'lucide-react';

import { Modal } from '@/components/Modal';
import type { CustomerInput } from '@/lib/types';

/**
 * Form Tambah Pelanggan — dipakai dari tombol `+` di dropdown Pelanggan.
 * API tidak punya kolom sales/alamat di v1; kolom `phone` & `address` ditambahkan
 * lewat migrasi di supabase/schema.sql.
 */
export function ModalPelanggan({
  open,
  onClose,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (input: CustomerInput) => Promise<void>;
}) {
  const [nama, setNama] = React.useState('');
  const [noHp, setNoHp] = React.useState('');
  const [alamat, setAlamat] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');

  // Reset form tiap modal dibuka supaya tidak membawa isian sebelumnya.
  React.useEffect(() => {
    if (open) {
      setNama('');
      setNoHp('');
      setAlamat('');
      setError('');
      setSaving(false);
    }
  }, [open]);

  async function submit() {
    const clean = nama.trim();
    if (!clean) {
      setError('Nama pelanggan wajib diisi.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave({ name: clean, phone: noHp.trim() || null, address: alamat.trim() || null });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menyimpan pelanggan.');
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Tambah Pelanggan"
      onClose={onClose}
      width="max-w-md"
      footer={
        <>
          <button type="button" className="btn-outline" onClick={onClose} disabled={saving}>
            Batal
          </button>
          <button type="button" className="btn-primary" onClick={() => void submit()} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            Simpan
          </button>
        </>
      }
    >
      <div className="space-y-2.5">
        <div>
          <label className="frm-label" htmlFor="plg-nama">
            Nama
          </label>
          <input
            id="plg-nama"
            className="frm-input h-9"
            value={nama}
            onChange={(e) => {
              setNama(e.target.value);
              setError('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
            }}
            placeholder="mis. Budi Santoso"
            autoFocus
          />
        </div>

        <div>
          <label className="frm-label" htmlFor="plg-hp">
            No HP
          </label>
          <input
            id="plg-hp"
            className="frm-input tnum h-9"
            value={noHp}
            onChange={(e) => setNoHp(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
            }}
            placeholder="08xxxxxxxxxx"
            inputMode="tel"
          />
        </div>

        <div>
          <label className="frm-label" htmlFor="plg-alamat">
            Alamat
          </label>
          <textarea
            id="plg-alamat"
            className="frm-input min-h-[64px] resize-y py-1.5"
            value={alamat}
            onChange={(e) => setAlamat(e.target.value)}
            placeholder="Alamat lengkap"
          />
        </div>

        {error ? <p className="text-[12px] font-semibold text-[#c92a2a]">{error}</p> : null}
      </div>
    </Modal>
  );
}
