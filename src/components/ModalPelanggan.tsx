'use client';

import * as React from 'react';
import { AlertTriangle, Loader2, UserPlus } from 'lucide-react';

import { Modal } from '@/components/Modal';
import { useButtonGuard } from '@/lib/useButtonGuard';
import type { CustomerInput } from '@/lib/types';

/** Nomor HP Indonesia: 08 + 8..11 digit (mis. 081234567890). */
const POLA_HP = /^08[0-9]{8,11}$/;

/** Buang semua karakter non-digit supaya "0812-3456" tetap bisa lolos. */
const hanyaDigit = (s: string) => s.replace(/[^\d+]/g, '');

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
  const [error, setError] = React.useState('');
  const simpan = useButtonGuard();
  const saving = simpan.busy;
  const { reset: resetGuard } = simpan;

  // Reset form tiap modal dibuka supaya tidak membawa isian sebelumnya.
  // `simpan` adalah objek baru tiap render, jadi andalkan `resetGuard`
  // (useCallback stabil) — kalau tidak, form ikut ter-reset tiap ketikan.
  React.useEffect(() => {
    if (!open) return;
    setNama('');
    setNoHp('');
    setAlamat('');
    setError('');
    resetGuard();
  }, [open, resetGuard]);

  /* ----------------------------- validasi ------------------------------ */
  const namaPendek = nama.trim().length > 0 && nama.trim().length < 3;
  const hpAngka = hanyaDigit(noHp);
  const hpAda = hpAngka.length > 0;
  const hpSalah = hpAda && !POLA_HP.test(hpAngka);

  const isFormValid = React.useMemo(
    () => nama.trim().length >= 3 && (!hpAda || POLA_HP.test(hpAngka)),
    [nama, hpAda, hpAngka],
  );

  /** Simpan: satu klik = satu INSERT; klik ganda ditolak + toast "Mohon tunggu". */
  function submit() {
    if (saving) {
      setError('Mohon tunggu… pelanggan sedang disimpan.');
      return;
    }
    if (!isFormValid) {
      setError(
        nama.trim().length < 3
          ? 'Nama pelanggan minimal 3 karakter.'
          : 'No HP harus diawali 08 dan terdiri dari 10-13 digit.',
      );
      return;
    }
    setError('');
    void simpan.guard(
      async () => {
        await onSave({
          name: nama.trim(),
          phone: hpAngka || null,
          address: alamat.trim() || null,
        });
        onClose();
      },
      {
        cooldownMs: 1500,
        pesanTunggu: 'Pelanggan sedang disimpan…',
        onBlocked: (pesan) => setError(pesan),
        onError: (e) =>
          setError(e instanceof Error ? e.message : 'Gagal menyimpan pelanggan.'),
      },
    );
  }

  function enter(e: React.KeyboardEvent) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    submit();
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
          <button
            type="button"
            className="btn-primary"
            onClick={submit}
            disabled={!isFormValid || saving}
            data-loading={saving}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            {saving ? 'Menyimpan…' : 'Simpan'}
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="space-y-2.5">
          <div>
            <label className="frm-label" htmlFor="plg-nama">
              Nama *
            </label>
            <input
              id="plg-nama"
              className={`frm-input h-9 ${namaPendek ? 'input-invalid' : ''}`}
              value={nama}
              onChange={(e) => {
                setNama(e.target.value);
                setError('');
              }}
              onKeyDown={enter}
              placeholder="mis. Budi Santoso"
              aria-invalid={namaPendek}
              autoFocus
            />
            {namaPendek ? (
              <p className="field-error">
                <AlertTriangle className="h-3 w-3" /> Nama minimal 3 karakter.
              </p>
            ) : null}
          </div>

          <div>
            <label className="frm-label" htmlFor="plg-hp">
              No HP
            </label>
            <input
              id="plg-hp"
              className={`frm-input tnum h-9 ${hpSalah ? 'input-invalid' : ''}`}
              value={noHp}
              onChange={(e) => {
                setNoHp(e.target.value);
                setError('');
              }}
              onKeyDown={enter}
              placeholder="08xxxxxxxxxx"
              inputMode="tel"
              aria-invalid={hpSalah}
            />
            {hpSalah ? (
              <p className="field-error">
                <AlertTriangle className="h-3 w-3" /> No HP harus diawali 08 (10-13 digit).
              </p>
            ) : null}
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

          {error ? (
            <p className="flex items-center gap-1 text-[12px] font-semibold text-[#c92a2a]">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {error}
            </p>
          ) : null}
        </div>
      </form>
    </Modal>
  );
}
