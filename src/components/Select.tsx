'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';

/**
 * Dropdown berbasis DOM — pengganti `<select>` native di seluruh aplikasi.
 *
 * Alasan: popup `<select>` native dirender oleh OS sebagai child window
 * terpisah. Di Wine (dan sebagian konfigurasi Windows fullscreen) popup itu
 * tidak tampil, sehingga pengguna melihat "dropdown tidak bisa diklik"
 * padahal elemennya menerima klik. Dengan daftar opsi berupa elemen DOM
 * biasa, pilihan tampil di dalam halaman dan bisa diklik/diuji otomatis.
 *
 * Menu dirender lewat portal (`position: fixed`) supaya tidak terpotong oleh
 * container ber-overflow (modal / tabel).
 */
export type SelectOption = {
  value: string;
  label: string;
  /** Judul grup opsional (seperti <optgroup>). */
  group?: string;
  disabled?: boolean;
};

export function Select({
  value,
  options,
  onChange,
  ariaLabel,
  id,
  className,
  disabled = false,
  invalid = false,
  placeholder = '— pilih —',
  menuClassName,
  testId,
  wrapperClassName,
}: {
  value: string;
  options: SelectOption[];
  onChange: (v: string) => void;
  ariaLabel?: string;
  id?: string;
  className?: string;
  disabled?: boolean;
  invalid?: boolean;
  placeholder?: string;
  menuClassName?: string;
  testId?: string;
  /** Kelas pembungkus (untuk mengatur lebar/flex di layout pemanggil). */
  wrapperClassName?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [idx, setIdx] = React.useState(0);
  const [pos, setPos] = React.useState<{
    left: number;
    width: number;
    top?: number;
    bottom?: number;
    maxH: number;
  } | null>(null);
  const btnRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLUListElement>(null);

  const selected = options.find((o) => o.value === value);
  const label = selected ? selected.label : value || placeholder;

  const compute = React.useCallback(() => {
    const b = btnRef.current;
    if (!b) return;
    const r = b.getBoundingClientRect();
    const gap = 4;
    let left = r.left;
    const w = Math.max(120, r.width);
    if (left + w > window.innerWidth - gap) left = window.innerWidth - gap - w;
    if (left < gap) left = gap;
    const below = window.innerHeight - r.bottom - gap - 8;
    const above = r.top - gap - 8;
    const up = below < 180 && above > below;
    const maxH = Math.max(110, Math.min(340, up ? above : below));
    setPos(
      up
        ? { left, width: w, bottom: window.innerHeight - r.top + gap, maxH }
        : { left, width: w, top: r.bottom + gap, maxH },
    );
  }, []);

  React.useEffect(() => {
    if (open) compute();
  }, [open, compute]);

  // Sinkronkan indeks aktif dengan nilai sekarang.
  React.useEffect(() => {
    if (!open) return;
    const i = options.findIndex((o) => o.value === value);
    setIdx(i >= 0 ? i : 0);
  }, [value, open, options]);

  // Tutup saat klik di luar / scroll / ganti layar.
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node)) return;
      if (menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onScroll = () => setOpen(false);
    const onResize = () => compute();
    document.addEventListener('mousedown', onDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, compute]);

  // Fokuskan opsi aktif saat terbuka (aksesibilitas keyboard).
  React.useEffect(() => {
    if (!open) return;
    const el = menuRef.current?.querySelector('[data-active="1"]') as HTMLElement | null;
    el?.focus({ preventScroll: true });
  }, [open, idx]);

  const pilih = (v: string) => {
    onChange(v);
    setOpen(false);
    btnRef.current?.focus();
  };

  const nav = (dir: number) => {
    setIdx((i) => {
      let n = i;
      for (let k = 0; k < options.length; k += 1) {
        n = (n + dir + options.length) % options.length;
        if (!options[n].disabled) return n;
      }
      return i;
    });
  };

  const menu =
    open && pos
      ? createPortal(
          <ul
            ref={menuRef}
            role="listbox"
            aria-label={ariaLabel}
            className={`fixed z-[100000] overflow-auto rounded border border-[#1b5fa8] bg-white py-0.5 shadow-[0_8px_24px_rgba(27,58,92,0.18)] ${menuClassName ?? ''}`}
            style={{ left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxH }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') nav(1);
              else if (e.key === 'ArrowUp') nav(-1);
              else if (e.key === 'Enter') {
                e.preventDefault();
                const o = options[idx];
                if (o && !o.disabled) pilih(o.value);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setOpen(false);
                btnRef.current?.focus();
              } else if (e.key === 'Tab') {
                setOpen(false);
              }
            }}
          >
            {options.length === 0 ? (
              <li className="px-2.5 py-2 text-[12px] text-[#7a8ba0]">Tidak ada pilihan</li>
            ) : (
              options.map((o, i) => (
                <React.Fragment key={`${o.group ?? ''}-${o.value}-${i}`}>
                  {o.group && (i === 0 || options[i - 1].group !== o.group) ? (
                    <li
                      aria-hidden="true"
                      className="px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-wide text-[#8fa2b6]"
                    >
                      {o.group}
                    </li>
                  ) : null}
                  <li role="option" aria-selected={o.value === value}>
                    <button
                      type="button"
                      data-opt="1"
                      data-active={i === idx ? '1' : undefined}
                      tabIndex={-1}
                      disabled={o.disabled}
                      onClick={() => pilih(o.value)}
                      onMouseEnter={() => setIdx(i)}
                      className={`flex w-full items-center px-2.5 py-1.5 text-left text-[12.5px] ${
                        o.value === value
                          ? 'bg-[#eaf2fb] font-semibold text-[#1b5fa8]'
                          : i === idx
                            ? 'bg-[#f1f5fa]'
                            : ''
                      } ${o.disabled ? 'cursor-not-allowed opacity-50' : ''} text-[#22374b]`}
                    >
                      <span className="truncate">{o.label}</span>
                    </button>
                  </li>
                </React.Fragment>
              ))
            )}
          </ul>,
          document.body,
        )
      : null;

  return (
    <div className={wrapperClassName ?? 'relative min-w-0 w-full'}>
      <button
        ref={btnRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        data-testid={testId ?? ariaLabel}
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setOpen((v) => !v);
        }}
        onKeyDown={(e) => {
          if (disabled) return;
          if (
            e.key === 'ArrowDown' ||
            e.key === 'ArrowUp' ||
            e.key === 'Enter' ||
            e.key === ' '
          ) {
            e.preventDefault();
            if (!open) setOpen(true);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        className={`${className ?? 'input'} flex w-full min-w-0 cursor-pointer items-center justify-between gap-1 text-left ${
          invalid ? '!border-[#e03131]' : ''
        } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
      >
        <span className={`truncate ${value ? 'text-[#22374b]' : 'text-[#9fb0c4]'}`}>{label}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[#7a8ba0]" />
      </button>
      {menu}
    </div>
  );
}
