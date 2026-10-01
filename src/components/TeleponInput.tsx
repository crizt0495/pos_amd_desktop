'use client';

import * as React from 'react';

import { bersihkanTelepon, karakterIlegalTelepon } from '@/lib/telepon';

/**
 * Input nomor telepon — hanya menerima angka.
 *
 * Tiga lapis pertahanan, karena `inputMode` saja tidak cukup:
 * 1. `onBeforeInput` menolak karakter non-digit **sebelum** masuk DOM, jadi
 *    huruf/huruf yang diketik tidak pernah sempat berkedip di layar.
 * 2. `onChange` menyaring ulang — menangkap sisipan yang bisa lolos dari
 *    `beforeinput` (paste dari WhatsApp/Chrome autofill, drag-drop, IME).
 * 3. `inputMode="numeric"` → keyboard HP langsung numeric, tidak ada tombol huruf.
 *
 * Nilai yang diteruskan ke `onChange` selalu angka murni, maksimal `maxLength`
 * digit (default 15, batas E.164).
 */
export function TeleponInput({
  id,
  value,
  onChange,
  className = '',
  placeholder = '08xxxxxxxxxx',
  maxLength = 15,
  disabled,
  onEnter,
  ...rest
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  className?: string;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
  /** Dipanggil saat user menekan Enter (form langsung submit). */
  onEnter?: () => void;
  'aria-invalid'?: boolean;
}) {
  return (
    <input
      {...rest}
      id={id}
      type="tel"
      inputMode="numeric"
      pattern="[0-9]*"
      autoComplete="tel"
      maxLength={maxLength}
      disabled={disabled}
      placeholder={placeholder}
      className={className}
      value={value}
      onBeforeInput={(e) => {
        if (karakterIlegalTelepon((e.nativeEvent as InputEvent).data)) e.preventDefault();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onEnter?.();
        }
      }}
      onChange={(e) => onChange(bersihkanTelepon(e.target.value, maxLength))}
    />
  );
}