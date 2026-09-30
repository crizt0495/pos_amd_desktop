'use client';

import * as React from 'react';

/**
 * Input nominal dengan pemisah ribuan gaya Indonesia.
 *
 * Berbeda dari `UangInput` (sel kasir) yang memakai prefix "Rp." dan hanya
 * memformat saat blur, komponen ini memformat **selalu** while typing:
 * mengetik `4000` langsung tampil `4.000`. Nilai yang dikembalikan ke pemanggil
 * tetap angka polos supaya aman dipakai langsung ke database.
 *
 * - `1000`      -> tampil `1.000`
 * - `1000000`   -> tampil `1.000.000`
 * - `1.000.000` -> nilai 1000000 (pemisah diabaikan saat parsing)
 * - `0`         -> tampil `0` (bukan kosong, sesuai placeholder "0")
 */
export function RupiahInput({
  id,
  value,
  onChange,
  className = '',
  placeholder = '0',
  ariaLabel,
  dataCell,
  disabled,
  min = 0,
  onKeyDown,
  onEnter,
  inputRef,
  autoFocus,
}: {
  id?: string;
  /** Angka (bukan string terformat) — sumber kebenaran. */
  value: number | string;
  onChange: (v: number) => void;
  className?: string;
  placeholder?: string;
  ariaLabel?: string;
  dataCell?: string;
  disabled?: boolean;
  /** Batas bawah; nilai di bawahnya tidak diterima. */
  min?: number;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onEnter?: () => void;
  inputRef?: React.Ref<HTMLInputElement>;
  /** Fokus otomatis saat modal/komponen terbuka (buka keypad numerik di HP). */
  autoFocus?: boolean;
}) {
  const [teks, setTeks] = React.useState(() => format(String(value ?? '')));

  // Ikuti perubahan nilai dari luar (mis. saat form di-reset atau baris dihapus).
  React.useEffect(() => {
    setTeks(format(String(value ?? '')));
  }, [value]);

  return (
    <input
      id={id}
      ref={inputRef}
      data-cell={dataCell}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      autoFocus={autoFocus}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`uang-input ${className}`}
      value={teks}
      placeholder={placeholder}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (e.key === 'Enter' && !e.defaultPrevented) {
          e.preventDefault();
          onEnter?.();
        }
      }}
      onChange={(e) => {
        const n = parse(e.target.value);
        setTeks(format(e.target.value));
        onChange(n < min ? min : n);
      }}
      onBlur={(e) => setTeks(format(e.target.value))}
    />
  );
}

/** "4000" -> "4.000" ; "1500000" -> "1.500.000" ; "abc" -> "" */
function format(raw: string): string {
  const n = parse(raw);
  if (!n) return '';
  return n.toLocaleString('id-ID');
}

/** Buang semua karakter non-angka lalu jadi number. */
function parse(raw: string): number {
  const n = Number(String(raw ?? '').replace(/[^\d-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}
