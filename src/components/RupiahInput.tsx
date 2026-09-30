'use client';

import * as React from 'react';

/**
 * Input nominal dengan pemisah ribuan gaya Indonesia, diformat **realtime**
 * selagi mengetik — supaya yang mengetik langsung tahu bedanya `1000` vs `1.000`.
 *
 * - ketik `1000`     -> tampil `1.000`
 * - ketik `10000`    -> tampil `10.000`
 * - ketik `1000000`  -> tampil `1.000.000`
 * - isi `1.000.000`  -> nilainya 1000000 (pemisah diabaikan saat parsing)
 * - `0`/kosong       -> tampil kosong, angka 0 (placeholder "0")
 *
 * Nilai yang dikirim ke `onChange` selalu **integer polos**, jadi aman langsung
 * disimpan ke database (bukan string "4.000"). Kursor tetap di ujung teks dan
 * tidak melompat saat pemisah ribuan disisipkan.
 *
 * Ini menggantikan `UangInput` lama (prefix "Rp." + format saat blur) yang
 * dipakai di sel kasir, karena kasir butuh feedback ribuan realtime.
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
  const elRef = React.useRef<HTMLInputElement | null>(null);

  // Gabung ref internal (untuk kursor) dengan ref dari pemanggil.
  const setRef = React.useCallback(
    (node: HTMLInputElement | null) => {
      elRef.current = node;
      if (typeof inputRef === 'function') inputRef(node);
      else if (inputRef) (inputRef as React.MutableRefObject<HTMLInputElement | null>).current = node;
    },
    [inputRef],
  );

  // Ikuti perubahan nilai dari luar (reset form, baris dihapus, shortcut bayar).
  React.useEffect(() => {
    setTeks(format(String(value ?? '')));
  }, [value]);

  return (
    <input
      id={id}
      ref={setRef}
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
        caretKeUjung();
      }}
      onBlur={(e) => setTeks(format(e.target.value))}
    />
  );

  /** Kursor selalu di belakang: sisipan pemisah ribuan tidak boleh bikin lompat. */
  function caretKeUjung() {
    requestAnimationFrame(() => {
      const el = elRef.current;
      if (!el) return;
      const end = el.value.length;
      el.setSelectionRange(end, end);
    });
  }
}

/** "4000" -> "4.000" ; "1500000" -> "1.500.000" ; "abc"/"" -> "" */
function format(raw: string): string {
  const n = parse(raw);
  if (!n) return '';
  return new Intl.NumberFormat('id-ID').format(n);
}

/** Buang pemisah ribuan & karakter non-angka, lalu jadi integer. */
function parse(raw: string): number {
  const n = Number.parseInt(String(raw ?? '').replace(/\./g, '').replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

export default RupiahInput;
