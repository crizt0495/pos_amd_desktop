import * as React from 'react';
import { X } from 'lucide-react';

/** Modal konfirmasi sederhana (bukan dialog-window native). */
export function Modal({
  open,
  title,
  children,
  onClose,
  footer,
  width = 'max-w-md',
  flat = false,
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  footer?: React.ReactNode;
  width?: string;
  /** Gaya kasir klasik: kotak keras, border-2 hitam, tanpa rounded. */
  flat?: boolean;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`w-full ${width} ${
          flat
            ? 'rounded-none border-2 border-black bg-white shadow-[6px_6px_0_rgba(0,0,0,0.9)]'
            : 'animate-fade-in rounded-2xl bg-white shadow-2xl'
        }`}
      >
        <div
          className={`flex items-center justify-between px-5 py-3.5 ${
            flat ? 'border-b-2 border-black' : 'border-b border-zinc-100'
          }`}
        >
          <h2 className="font-mono text-[15px] font-bold text-black">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className={`grid h-7 w-7 place-items-center text-black transition hover:bg-black hover:text-white ${
              flat ? 'border-2 border-black' : 'rounded-full text-zinc-400 hover:bg-zinc-100'
            }`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[65vh] overflow-y-auto px-5 py-4">{children}</div>

        {footer ? (
          <div
            className={`flex justify-end gap-2 px-5 py-3 ${flat ? 'border-t-2 border-black' : 'border-t border-zinc-100'}`}
          >
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
