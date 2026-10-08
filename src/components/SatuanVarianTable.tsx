'use client';

import * as React from 'react';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';

import { RupiahInput } from '@/components/RupiahInput';
import { useClickCooldown } from '@/lib/useButtonGuard';
import {
  parseRupiah,
  satuanKembar,
  varianRugi,
  type VarianBaris,
  type VarianError,
} from '@/lib/format';

/**
 * Tabel varian satuan pada modal Tambah/Ubah Produk.
 *
 * Kolom: [Satuan*] [Harga Modal*] [Harga Jual*] [Konversi] [Barcode Satuan] [Aksi]
 *
 * Baris pertama adalah **satuan dasar**: konversinya terkunci di 1 (readonly)
 * dan nilainya dipakai untuk `products.price` / `products.cost` / `unit`.
 * Baris kedua dan seterusnya bebas, misalnya `Dus` dengan konversi 6.
 *
 * Komponen ini murni presentational + validasi tampilan; pennyimpanan
 * ditangani oleh pemanggil lewat `onChange(baris)`.
 */
export function SatuanVarianTable({
  baris,
  onChange,
  errors,
  onTambah,
}: {
  baris: VarianBaris[];
  onChange: (next: VarianBaris[]) => void;
  /** Pesan error per indeks baris (dihasilkan `validasiVarian`). */
  errors?: VarianError[];
  onTambah: () => void;
}) {
  const errUmum = errors?.find((e) => e.index === -1)?.pesan;
  const errRow = React.useCallback(
    (i: number) => errors?.filter((e) => e.index === i).map((e) => e.pesan).join(' '),
    [errors],
  );
  const kembar = satuanKembar(baris);
  const rugi = varianRugi(baris);
  // Tombol "+ Tambah Satuan" & "Hapus baris" dikunci 1,5 detik.
  const aksi = useClickCooldown(1500);

  function ubah(i: number, patch: Partial<VarianBaris>) {
    const next = [...baris];
    const cur = next[i];
    if (!cur) return;
    next[i] = { ...cur, ...patch };
    // Baris pertama selalu satuan dasar: konversi tidak bisa diubah.
    if (i === 0 && patch.konversi !== undefined) next[i]!.konversi = '1';

    // Auto harga modal satuan turunan: modal utama / konversi. Kalau harga
    // modal utama berubah, semua baris turunan ikut hitung ulang.
    const modalUtama = parseRupiah(next[0]!.harga_beli);
    for (let j = 1; j < next.length; j += 1) {
      const konv = Number(next[j]!.konversi) || 1;
      const nilai = konv > 0 ? Math.round(modalUtama / konv) : 0;
      next[j] = { ...next[j]!, harga_beli: String(nilai) };
    }
    onChange(next);
  }

  function hapus(i: number) {
    // Baris satuan dasar tidak boleh dihapus — tanpa dia produk tak punya harga.
    if (i === 0) return;
    onChange(baris.filter((_, x) => x !== i));
  }

  return (
    <div className="mt-3">
      <div className="mb-1.5 flex items-center gap-2">
        <p className="text-[12.5px] font-bold text-[#1b3a5c]">Satuan &amp; Harga *</p>
        <span className="text-[11px] text-[#9fb0c4]">baris 1 = satuan dasar (kecil); satuan yang lebih besar harus di baris bawah dengan konversi &gt; 1</span>
      </div>

      <div className="overflow-x-auto rounded-md border border-[#d8e0ec]">
        <table className="w-full min-w-[620px] border-collapse text-left">
          <thead className="bg-[#f6f9fd]">
            <tr>
              <th className="th w-[112px]">Satuan*</th>
              <th className="th w-[112px] text-right">Harga Modal*</th>
              <th className="th w-[112px] text-right">Harga Jual*</th>
              <th className="th w-[104px] text-right">Konversi</th>
              <th className="th w-[140px]">Barcode Satuan</th>
              <th className="th w-[64px] text-center">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#eef2f7] bg-white">
            {baris.map((b, i) => {
              const salah = Boolean(errRow(i));
              // Tandai baris kedua yang NAMANYA kembar (baris pertama tetap aman).
              const key = b.satuan.trim().toLowerCase();
              const firstIdx = baris.findIndex((x) => x.satuan.trim().toLowerCase() === key);
              const isKembar = Boolean(key) && kembar !== null && firstIdx !== -1 && firstIdx !== i;
              const isRugi =
                Boolean(b.satuan.trim()) &&
                parseRupiah(b.harga_jual) > 0 &&
                parseRupiah(b.harga_jual) < parseRupiah(b.harga_beli);
              return (
                <tr key={`baris-${i}`} className={isKembar ? 'bg-[#fff5f5]' : undefined}>
                  <td className="td p-1.5">
                    <input
                      className={`input h-8 rounded-md text-[12.5px] ${
                        salah || isKembar ? '!border-[#e03131]' : ''
                      }`}
                      value={b.satuan}
                      placeholder={i === 0 ? 'btl' : 'Dus'}
                      aria-label={`Satuan baris ${i + 1}`}
                      onChange={(e) => ubah(i, { satuan: e.target.value })}
                    />
                    {i === 0 ? (
                      <span className="mt-0.5 block text-[10px] text-[#9fb0c4]">SATUAN UTAMA (basis)</span>
                    ) : null}
                    {isKembar ? (
                      <span className="mt-0.5 block text-[10px] font-bold text-[#c92a2a]">satuan kembar</span>
                    ) : null}
                  </td>

                  <td className="td p-1.5">
                    <RupiahInput
                      className={`!h-8 w-full rounded-md !text-[12.5px] text-right ${
                        i > 0 ? 'bg-[#f6f9fd] text-[#7a8ba0]' : ''
                      }`}
                      ariaLabel={`Harga modal ${b.satuan || `baris ${i + 1}`}`}
                      value={b.harga_beli}
                      disabled={i > 0}
                      onChange={(v) => ubah(i, { harga_beli: String(v) })}
                    />
                    {i > 0 ? (
                      <span className="mt-0.5 block text-[10px] text-[#9fb0c4]">
                        otomatis = modal utama / konversi
                      </span>
                    ) : null}
                  </td>

                  <td className="td p-1.5">
                    <RupiahInput
                      className="!h-8 w-full rounded-md !text-[12.5px] text-right"
                      ariaLabel={`Harga jual ${b.satuan || `baris ${i + 1}`}`}
                      value={b.harga_jual}
                      onChange={(v) => ubah(i, { harga_jual: String(v) })}
                    />
                    {isRugi ? (
                      <span className="mt-0.5 block text-[10px] font-bold text-[#b8860b]">jual rugi</span>
                    ) : null}
                  </td>

                  <td className="td p-1.5">
                    <input
                      className={`input tnum h-8 w-full rounded-md text-right text-[12.5px] ${
                        i === 0 ? 'bg-[#f6f9fd] text-[#7a8ba0]' : ''
                      }`}
                      type="text"
                      inputMode="numeric"
                      value={b.konversi}
                      readOnly={i === 0}
                      aria-label={`Konversi ${b.satuan || `baris ${i + 1}`}`}
                      onChange={(e) => ubah(i, { konversi: e.target.value.replace(/[^\d]/g, '') })}
                    />
                  </td>

                  <td className="td p-1.5">
                    <input
                      className="input h-8 w-full rounded-md font-mono text-[11.5px]"
                      value={b.barcode}
                      placeholder={i === 0 ? 'barcode utama' : 'opsional'}
                      aria-label={`Barcode satuan ${b.satuan || `baris ${i + 1}`}`}
                      onChange={(e) => ubah(i, { barcode: e.target.value })}
                    />
                  </td>

                  <td className="td p-1.5 text-center">
                    <button
                      type="button"
                      onClick={() => aksi.run(() => hapus(i), `hapus-${i}`)}
                      disabled={i === 0}
                      title={i === 0 ? 'Satuan dasar tidak bisa dihapus' : 'Hapus baris'}
                      aria-label={`Hapus baris satuan ${i + 1}`}
                      className="grid h-8 w-8 place-items-center rounded-md border border-[#cdd8e6] bg-white text-[#c92a2a] transition hover:bg-[#fff5f5] disabled:cursor-not-allowed disabled:border-[#e6ecf4] disabled:text-[#cdd8e6]"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        onClick={() => aksi.run(onTambah, 'tambah' )}
        disabled={aksi.locked('tambah')}
        className="rb-btn mt-2"
      >
        <Plus className="h-3.5 w-3.5" /> Tambah Satuan
      </button>

      {errUmum ? (
        <p className="mt-1.5 flex items-center gap-1.5 text-[11.5px] font-semibold text-[#c92a2a]">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {errUmum}
        </p>
      ) : null}

      {baris.map((b, i) =>
        errRow(i) ? (
          <p key={`err-${i}`} className="mt-1 text-[11px] font-semibold text-[#c92a2a]">
            Baris {i + 1} ({b.satuan || 'tanpa nama'}): {errRow(i)}
          </p>
        ) : null,
      )}

      {rugi.length > 0 && !errUmum ? (
        <p className="mt-1.5 flex items-start gap-1.5 rounded-md bg-[#fff9db] px-2 py-1.5 text-[11.5px] text-[#a35b00]">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>
            {rugi.length} satuan dijual di bawah harga modal
            {rugi.length === 1 ? ` (${rugi[0]!.satuan})` : ''}. Boleh disimpan, tapi penjualan merugi.
          </span>
        </p>
      ) : null}
    </div>
  );
}
