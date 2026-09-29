'use client';

import * as React from 'react';

import { parseRupiah, rupiah } from '@/lib/format';

/**
 * Input nominal dengan format ribuan gaya Indonesia.
 *
 * Saat tidak difokuskan tampil sebagai "Rp. 15.000" (pemisah ribuan).
 * Saat difokuskan isinya jadi angka polos supaya mudah diketik/ diubah;
 * begitu blur kembali diformat. Semua karakter non-angka diabaikan saat mengetik.
 */
export function UangInput({
  id,
  value,
  onChange,
  className = '',
  placeholder,
  ariaLabel,
  dataCell,
}: {
  id?: string;
  value: number | string;
  onChange: (v: number) => void;
  className?: string;
  placeholder?: string;
  ariaLabel?: string;
  dataCell?: string;
}) {
  const [fokus, setFokus] = React.useState(false);
  const num = React.useMemo(() => (typeof value === 'number' ? value : parseRupiah(value)), [value]);

  return (
    <input
      id={id}
      data-cell={dataCell}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      aria-label={ariaLabel}
      className={`uang-input ${className}`}
      value={fokus ? String(num) : num ? rupiah(num) : ''}
      placeholder={placeholder}
      onFocus={() => setFokus(true)}
      onBlur={() => setFokus(false)}
      onChange={(e) => {
        const n = parseRupiah(e.target.value);
        onChange(n);
      }}
    />
  );
}
