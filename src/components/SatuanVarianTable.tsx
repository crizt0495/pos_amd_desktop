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
 * Bagi harga satuan utama dengan konversi -> angka bulat tanpa koma.
 * Konversi kosong / 0 / tidak valid mengembalikan `null` supaya pemanggil
 * TIDAK mengisi apa-apa (sesuai aturan "jangan hitung kalau konversi kosong").
 */
function bagiKonversi(nilaiUtama: number, konversi: string): string | null {
  const konv = Number(String(konversi ?? '').replace(/[^\d]/g, ''));
  if (!Number.isFinite(konv) || konv <= 0) return null;
  return String(Math.round(nilaiUtama / konv));
}

/**
 * Tabel varian satuan pada modal Tambah/Ubah Produk.
 *
 * Kolom: [Satuan*] [Harga Modal*] [Harga Jual*] [Konversi] [Barcode Satuan] [Aksi]
 *
 * Baris pertama adalah **satuan dasar**: konversinya terkunci di 1 (readonly)
 * dan nilainya dipakai untuk `products.price` / `products.cost` / `unit`.
 * Baris kedua dan seterusnya bebas, misalnya `Dus` dengan konversi 6.
 *
 * Harga Pokok & Harga Jual satuan turunan otomatis = harga satuan utama ÷
 * konversi saat pemicunya berubah, tapi tetap bisa diedit manual.
 *
 * Komponen ini murni presentational + validasi tampilan; pennyimpanan
 * ditangani oleh pemanggil lewat `onChange(baris)`.
 */
export function SatuanVarianTable({
  baris,
  onChange,
  errors,
  onTambah,
  onTambahSatuan,
  opsiSatuan = [],
}: {
  baris: VarianBaris[];
  onChange: (next: VarianBaris[]) => void;
  /** Pesan error per indeks baris (dihasilkan `validasiVarian`). */
  errors?: VarianError[];
  onTambah: () => void;
  /** Dipanggil saat tombol [+] di sebelah dropdown satuan baris `i` ditekan. */
  onTambahSatuan?: (i: number) => void;
  /** Pilihan satuan dari `master_satuan`; kolom SATUAN jadi dropdown. */
  opsiSatuan?: string[];
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

    // Auto-isi harga turunan (Harga Pokok & Harga Jual) = harga utama ÷ konversi.
    // Hasilnya cuma ISIAN AWAL: admin boleh ganti manual, dan nilai manual tidak
    // tertimpa kecuali pemicunya berubah lagi:
    //   - harga utama (baris 0) berubah -> semua baris turunan
    //   - konversi baris turunan (j > 0) berubah -> baris itu saja
    // Konversi kosong / 0 -> JANGAN dihitung (nilai dibiarkan apa adanya).
    const ubahPokokUtama = i === 0 && patch.harga_beli !== undefined;
    const ubahJualUtama = i === 0 && patch.harga_jual !== undefined;
    const ubahKonversiTurunan = i > 0 && patch.konversi !== undefined;

    if (ubahPokokUtama) {
      const pokokUtama = parseRupiah(next[0]!.harga_beli);
      for (let j = 1; j < next.length; j += 1) {
        const hasil = bagiKonversi(pokokUtama, next[j]!.konversi);
        if (hasil !== null) next[j] = { ...next[j]!, harga_beli: hasil };
      }
    }
    if (ubahJualUtama) {
      const jualUtama = parseRupiah(next[0]!.harga_jual);
      for (let j = 1; j < next.length; j += 1) {
        const hasil = bagiKonversi(jualUtama, next[j]!.konversi);
        if (hasil !== null) next[j] = { ...next[j]!, harga_jual: hasil };
      }
    }
    if (ubahKonversiTurunan) {
      const konv = next[i]!.konversi;
      const pokok = bagiKonversi(parseRupiah(next[0]!.harga_beli), konv);
      const jual = bagiKonversi(parseRupiah(next[0]!.harga_jual), konv);
      next[i] = {
        ...next[i]!,
        ...(pokok !== null ? { harga_beli: pokok } : {}),
        ...(jual !== null ? { harga_jual: jual } : {}),
      };
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
        <table className="w-full min-w-[800px] border-collapse text-left">
          <thead className="bg-[#f6f9fd]">
            <tr>
              <th className="th w-[220px]">Satuan</th>
              <th className="th w-[140px] text-right">Harga Beli*</th>
              <th className="th w-[140px] text-right">Harga Jual*</th>
              <th className="th w-[96px] text-right">Konversi</th>
              <th className="th w-[150px]">Barcode Satuan</th>
              <th className="th w-[56px] text-center">Aksi</th>
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
                  <td className="td p-1.5 align-top">
                    {/* Kolom satuan: TIDAK BOLEH teks bebas — hanya pilihan
                        dari master_satuan (baris lama di luar master tetap
                        tampil bertanda agar tidak hilang saat disimpan).
                        Tombol [+] menambah satuan baru langsung ke master.
                        Dropdown + [+] selalu satu baris, tinggi sama (h-9). */}
                    <div className="flex items-center gap-1.5">
                      <select
                        className={`input h-9 min-w-0 flex-1 rounded-md text-[12.5px] ${
                          salah || isKembar || !b.satuan.trim() ? '!border-[#e03131]' : ''
                        }`}
                        value={b.satuan}
                        aria-label={`Satuan baris ${i + 1}`}
                        onChange={(e) => ubah(i, { satuan: e.target.value })}
                      >
                        <option value="">— pilih satuan —</option>
                        {opsiSatuan.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                        {b.satuan &&
                        !opsiSatuan.some((o) => o.trim().toLowerCase() === b.satuan.trim().toLowerCase()) ? (
                          <option value={b.satuan}>{b.satuan} (di luar master)</option>
                        ) : null}
                      </select>
                      {onTambahSatuan ? (
                        <button
                          type="button"
                          onClick={() => onTambahSatuan(i)}
                          title="Tambah satuan baru"
                          aria-label={`Tambah satuan baru untuk baris ${i + 1}`}
                          className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-[#cdd8e6] bg-white text-[17px] font-bold leading-none text-[#1b5fa8] transition hover:border-[#1b5fa8] hover:bg-[#e8f1fa]"
                        >
                          +
                        </button>
                      ) : null}
                    </div>
                    {i === 0 ? (
                      <span className="mt-1 block text-[10px] text-[#9fb0c4]">SATUAN UTAMA (basis)</span>
                    ) : (
                      <span className="mt-1 block text-[10px] text-[#9fb0c4]">SATUAN TURUNAN</span>
                    )}
                    {!b.satuan.trim() ? (
                      <span className="mt-0.5 block text-[10px] font-bold text-[#c92a2a]">pilih satuan</span>
                    ) : null}
                    {isKembar ? (
                      <span className="mt-0.5 block text-[10px] font-bold text-[#c92a2a]">satuan kembar</span>
                    ) : null}
                  </td>

                  <td className="td p-1.5 align-top">
                    <RupiahInput
                      className="!h-9 w-full rounded-md !text-[12.5px] text-right"
                      ariaLabel={`Harga modal ${b.satuan || `baris ${i + 1}`}`}
                      value={b.harga_beli}
                      onChange={(v) => ubah(i, { harga_beli: String(v) })}
                    />
                    {i > 0 ? (
                      <span className="mt-1 block text-[10px] text-[#9fb0c4]">
                        auto = modal dasar ÷ konversi; boleh lebih, tak boleh kurang
                      </span>
                    ) : null}
                  </td>

                  <td className="td p-1.5 align-top">
                    <RupiahInput
                      className="!h-9 w-full rounded-md !text-[12.5px] text-right"
                      ariaLabel={`Harga jual ${b.satuan || `baris ${i + 1}`}`}
                      value={b.harga_jual}
                      onChange={(v) => ubah(i, { harga_jual: String(v) })}
                    />
                    {i > 0 ? (
                      <span className="mt-1 block text-[10px] text-[#9fb0c4]">
                        auto = jual utama ÷ konversi; boleh diubah
                      </span>
                    ) : null}
                    {isRugi ? (
                      <span className="mt-1 block text-[10px] font-bold text-[#b8860b]">jual rugi</span>
                    ) : null}
                  </td>

                  <td className="td p-1.5 align-top">
                    <input
                      className={`input tnum h-9 w-full rounded-md text-right text-[12.5px] ${
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

                  <td className="td p-1.5 align-top">
                    <input
                      className="input h-9 w-full rounded-md font-mono text-[11.5px]"
                      value={b.barcode}
                      placeholder={i === 0 ? 'barcode utama' : 'opsional'}
                      aria-label={`Barcode satuan ${b.satuan || `baris ${i + 1}`}`}
                      onChange={(e) => ubah(i, { barcode: e.target.value })}
                    />
                  </td>

                  <td className="td p-1.5 align-top text-center">
                    <button
                      type="button"
                      onClick={() => aksi.run(() => hapus(i), `hapus-${i}`)}
                      disabled={i === 0}
                      title={i === 0 ? 'Satuan dasar tidak bisa dihapus' : 'Hapus baris'}
                      aria-label={`Hapus baris satuan ${i + 1}`}
                      className="grid h-9 w-9 place-items-center rounded-md border border-[#cdd8e6] bg-white text-[#c92a2a] transition hover:bg-[#fff5f5] disabled:cursor-not-allowed disabled:border-[#e6ecf4] disabled:text-[#cdd8e6]"
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
        <Plus className="h-3.5 w-3.5" /> Tambah Baris Satuan
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
