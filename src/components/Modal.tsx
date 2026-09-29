import * as React from 'react';
import { X } from 'lucide-react';

/** Modal konfirmasi/sukses sederhana — gaya iPOS (header biru). */
export function Modal({
  open,
  title,
  children,
  onClose,
  footer,
  width = 'max-w-md',
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  footer?: React.ReactNode;
  width?: string;
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#10365c]/45 p-4 backdrop-blur-[2px] sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`w-full ${width} animate-pop-in overflow-hidden rounded-xl bg-white shadow-[0_20px_50px_rgba(16,40,70,0.28)]`}
      >
        <div className="flex items-center justify-between bg-gradient-to-r from-[#2470c0] to-[#134a85] px-5 py-3">
          <h2 className="text-[14px] font-bold text-white">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="grid h-7 w-7 place-items-center rounded text-white/80 transition hover:bg-white/20 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>

        {footer ? (
          <div className="flex justify-end gap-2 border-t border-[#d8e0ec] bg-[#f6f9fd] px-5 py-3">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}
