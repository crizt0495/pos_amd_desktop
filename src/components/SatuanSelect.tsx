'use client';

import * as React from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * Dropdown SATUAN berbasis DOM — BUKAN `<select>` native.
 *
 * Mengapa: popup `<select>` native dirender oleh OS sebagai child window
 * terpisah. Di Wine (dan di beberapa konfigurasi Windows fullscreen) popup
 * itu tidak tampil sehingga pengguna melihat "dropdown tidak bisa diklik",
 * padahal elemennya sendiri sudah menerima klik. Dengan daftar opsi berupa
 * elemen DOM biasa, pilihan tampil di dalam halaman dan bisa diuji otomatis.
 *
 * API-nya sengaja dibuat menyerupai `<select>` (value + onChange) supaya
 * mudah disubstitusikan.
 */
export function SatuanSelect({
  value,
  options,
  onChange,
  ariaLabel,
  invalid = false,
  optionLabel,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  ariaLabel: string;
  invalid?: boolean;
  /** Label tampilan berbeda dari nilai (mis. "X (di luar master)"). */
  optionLabel?: (v: string) => string;
}) {
  const [open, setOpen] = React.useState(false);
  const [idx, setIdx] = React.useState(0);
  const boxRef = React.useRef<HTMLDivElement>(null);
  const btnRef = React.useRef<HTMLButtonElement>(null);

  // Tutup saat klik di luar / ganti layar.
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Sinkronkan indeks aktif dengan nilai sekarang.
  React.useEffect(() => {
    const i = options.findIndex((o) => o === value);
    setIdx(i >= 0 ? i : 0);
  }, [value, options, open]);

  React.useEffect(() => {
    if (!open) return;
    // Pindahkan fokus ke opsi aktif saat terbuka (aksesibilitas keyboard).
    const el = boxRef.current?.querySelector('[role="option"][aria-selected="true"] button') as HTMLButtonElement | null;
    el?.focus({ preventScroll: true });
  }, [open, idx]);


  const pilih = (v: string) => {
    onChange(v);
    setOpen(false);
    btnRef.current?.focus();
  };

  return (
    <div ref={boxRef} className="relative min-w-0 flex-1">
      <button
        ref={btnRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        data-testid={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ' || e.key === ' ') {
            e.preventDefault();
            if (!open) setOpen(true);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        className={`input flex h-9 w-full min-w-0 items-center justify-between gap-1 rounded-md px-2 text-left text-[12.5px] ${invalid ? '!border-[#e03131]' : ''}`}
      >
        <span className={`truncate ${value ? 'text-[#22374b]' : 'text-[#9fb0c4]'}`}>
          {value ? (optionLabel ? optionLabel(value) : value) : '— pilih satuan —'}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[#7a8ba0]" />
      </button>

      {open ? (
        <ul
          role="listbox"
          aria-label={ariaLabel}
          className="absolute left-0 right-0 top-full z-40 mt-1 max-h-56 overflow-auto rounded border border-[#1b5fa8] bg-white py-0.5 shadow-[0_8px_24px_rgba(27,58,92,0.18)]"
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, options.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
            else if (e.key === 'Enter') { e.preventDefault(); if (options[idx] != null) pilih(options[idx]); }
            else if (e.key === 'Escape') { setOpen(false); }
          }}
        >
          {options.length === 0 ? (
            <li className="px-2.5 py-2 text-[12px] text-[#7a8ba0]">Belum ada master satuan</li>
          ) : (
            options.map((o, i) => (
              <li key={o} role="option" aria-selected={o === value}>
                <button
                  type="button"
                  onClick={() => pilih(o)}
                  onMouseEnter={() => setIdx(i)}
                  tabIndex={-1}
                  className={`flex w-full items-center px-2.5 py-1.5 text-left text-[12.5px] ${
                    o === value ? 'bg-[#eaf2fb] font-semibold text-[#1b5fa8]' : i === idx ? 'bg-[#f1f5fa]' : ''
                  } text-[#22374b]`}
                >
                  <span className="truncate">{optionLabel ? optionLabel(o) : o}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
