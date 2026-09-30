'use client';

import * as React from 'react';
import { Maximize2, X } from 'lucide-react';

import { angka, rupiah } from '@/lib/format';
import {
  bacaTampilan,
  dengarTampilan,
  gayaPosisi,
  jepitPosisi,
  setTampilan,
  ukuranFont,
  type PreferensiTampilan,
} from '@/lib/tampilan';

/**
 * Display total besar untuk pelanggan.
 *
 * - Nilainya langsung mengikuti keranjang (jumlah baris sudah dikurangi Potongan).
 * - Bisa diseret bebas; posisinya disimpan di localStorage sampai reload.
 * - Tombol [X] mengecilkan jadi pil kecil (total tetap kelihatan); klik pil
 *   untuk membesarkan lagi.
 * - Setelah transaksi tersimpan: dua baris — TOTAL dan KEMBALI (hijau).
 * - Disembunyikan sepenuhnya lewat Pengaturan > Tampilan > Tampilkan Total Besar.
 */
export function BigTotalDisplay({
  total,
  kembali = null,
}: {
  total: number;
  /** Nilai kembalian transaksi terakhir; null = belum ada pembayaran. */
  kembali?: number | null;
}) {
  const [pref, setPref] = React.useState<PreferensiTampilan | null>(null);
  // Posisi sementara selama diseret (belum disimpan, biar tidak flickering).
  const [seret, setSeret] = React.useState<{ x: number; y: number } | null>(null);
  const geserRef = React.useRef<{
    dx: number;
    dy: number;
    w: number;
    h: number;
    /** Titik mula — dipakai deteksi "cuma klik", bukan geser. */
    x0: number;
    y0: number;
    berubah: boolean;
  } | null>(null);
  const kotakRef = React.useRef<HTMLElement | null>(null);

  // Baca setelah mount supaya tidak ada bentrok dengan SSR.
  React.useEffect(() => {
    setPref(bacaTampilan());
    return dengarTampilan(setPref);
  }, []);

  // Jaring pengaman: koordinat tersimpan di luar layar (monitor/resolusi
  // diganti, atau geseran dari versi lama) dijepit ulang supaya kotak tak
  // hilang di luar layar dan masih bisa ditarik kembali.
  React.useEffect(() => {
    const el = kotakRef.current;
    if (!pref || pref.posisi !== 'floating' || pref.x == null || pref.y == null || !el) return;
    const r = el.getBoundingClientRect();
    if (!r.width) return;
    const p = jepitPosisi(r.left, r.top, r.width, r.height, window.innerWidth, window.innerHeight);
    if (Math.abs(p.x - r.left) > 1 || Math.abs(p.y - r.top) > 1) {
      setTampilan({ x: p.x, y: p.y });
    }
  }, [pref?.posisi, pref?.x, pref?.y, pref?.terbuka]);

  const px = ukuranFont(pref?.ukuran ?? 'besar');
  const sudahBayar = kembali != null;

  function mulaiSeret(e: React.PointerEvent<HTMLDivElement>) {
    // Tombol di dalam kotak bukan area geser.
    if ((e.target as HTMLElement).closest('[data-aksi]')) return;
    const el = kotakRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    geserRef.current = {
      dx: e.clientX - r.left,
      dy: e.clientY - r.top,
      w: r.width,
      h: r.height,
      x0: e.clientX,
      y0: e.clientY,
      berubah: false,
    };
    el.setPointerCapture(e.pointerId);
    setSeret({ x: r.left, y: r.top });
    e.preventDefault();
  }

  function geserSeret(e: React.PointerEvent<HTMLDivElement>) {
    const g = geserRef.current;
    if (!g) return;
    if (Math.abs(e.clientX - g.x0) > 2 || Math.abs(e.clientY - g.y0) > 2) g.berubah = true;
    setSeret(
      jepitPosisi(
        e.clientX - g.dx,
        e.clientY - g.dy,
        g.w,
        g.h,
        window.innerWidth,
        window.innerHeight,
      ),
    );
  }

  function selesaiSeret(e: React.PointerEvent<HTMLDivElement>) {
    const g = geserRef.current;
    geserRef.current = null;
    if (kotakRef.current?.hasPointerCapture?.(e.pointerId)) {
      kotakRef.current.releasePointerCapture(e.pointerId);
    }
    if (!g) return;
    // Klik biasa (tanpa gerakan) tidak mengubah posisi yang sudah jadi.
    if (!g.berubah) {
      setSeret(null);
      return;
    }
    // Geseran = mode bebas; koordinatnya disimpan untuk dipakai setelah reload.
    const akhir = seret ?? { x: e.clientX - g.dx, y: e.clientY - g.dy };
    setTampilan({ posisi: 'floating', x: akhir.x, y: akhir.y });
    setSeret(null);
  }

  if (!pref || !pref.aktif) return null;

  const gaya = gayaPosisi(pref, seret);

  /* ------------------ pil kecil: total tetap kelihatan ---------------- */
  if (!pref.terbuka) {
    return (
      <button
        type="button"
        ref={(el) => {
          kotakRef.current = el;
        }}
        data-aksi="buka"
        onClick={() => setTampilan({ terbuka: true })}
        title="Tampilkan Total Besar"
        aria-label="Tampilkan Total Besar"
        style={gaya}
        className="fixed z-[60] flex touch-none select-none items-center gap-1.5 rounded-full bg-[#0b1220]/85 px-3 py-1.5 text-[13px] font-bold text-white shadow-lg ring-1 ring-white/15 hover:bg-[#0b1220]"
      >
        <Maximize2 className="h-3.5 w-3.5 text-white/60" />
        <span className="tnum">Rp. {angka(total)}</span>
      </button>
    );
  }

  /* --------------------------- panel besar ---------------------------- */
  return (
    <div
      ref={(el) => {
        kotakRef.current = el;
      }}
      onPointerDown={mulaiSeret}
      onPointerMove={geserSeret}
      onPointerUp={selesaiSeret}
      onPointerCancel={selesaiSeret}
      style={gaya}
      role="status"
      aria-label={
        sudahBayar
          ? `Total ${rupiah(total)}, kembali ${rupiah(kembali ?? 0)}`
          : `Total belanja ${rupiah(total)}`
      }
      title="Seret untuk memindahkan — posisi tersimpan otomatis"
      className="fixed z-[60] cursor-move touch-none select-none rounded-2xl bg-[#0b1220] px-5 py-3 text-white shadow-[0_18px_40px_rgba(3,10,20,0.45)] ring-1 ring-white/10"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/50">
            {sudahBayar ? 'Total' : 'Total Belanja'}
          </p>
          <p className="tnum font-black leading-none" style={{ fontSize: px }}>
            {rupiah(total)}
          </p>
        </div>

        <button
          type="button"
          data-aksi="ciut"
          onClick={() => setTampilan({ terbuka: false })}
          title="Kecilkan (total tetap kelihatan)"
          aria-label="Kecilkan display total"
          className="-mr-1 -mt-1 grid h-6 w-6 shrink-0 place-items-center rounded text-white/50 transition hover:bg-white/15 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {sudahBayar ? (
        <div className="mt-2 border-t border-white/15 pt-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-300/80">
            Kembali
          </p>
          <p
            className="tnum font-black leading-none text-emerald-400"
            style={{ fontSize: Math.round(px * 1.15) }}
          >
            {rupiah(kembali ?? 0)}
          </p>
        </div>
      ) : null}
    </div>
  );
}
