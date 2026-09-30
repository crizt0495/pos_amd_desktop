'use client';

import * as React from 'react';
import { AlertTriangle, CheckCircle2, FileUp, Loader2, Upload } from 'lucide-react';

import { Modal } from '@/components/Modal';
import { contohCsv, parseProdukCsv, unduhTeks, type ParsedProdukRow } from '@/lib/csv';

export type ImportResult = {
  dibuat: number;
  diperbarui: number;
  gagal: { row: number; pesan: string }[];
};

/**
 * Modal Import Produk dari CSV (Fitur #4).
 * - Pilih berkas .csv atau tempel teks (support UTF-8 + BOM).
 * - Parse & validasi live (nama wajib; baris kosong dilewati).
 * - Tombol Import memanggil `onImport(rows)` di pemanggil (baris sudah bersih),
 *   lalu menampilkan ringkasan (dibuat / diperbarui / gagal).
 */
export function CsvImportModal({
  open,
  onClose,
  onImport,
}: {
  open: boolean;
  onClose: () => void;
  onImport: (rows: ParsedProdukRow[]) => Promise<ImportResult>;
}) {
  const [teks, setTeks] = React.useState('');
  const [namaFile, setNamaFile] = React.useState('');
  const [parsed, setParsed] = React.useState<{ rows: ParsedProdukRow[]; errors: string[] } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [hasil, setHasil] = React.useState<ImportResult | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) {
      setTeks('');
      setNamaFile('');
      setParsed(null);
      setHasil(null);
      setBusy(false);
    }
  }, [open]);

  function bacaFile(f: File | undefined) {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const txt = String(reader.result ?? '');
      setTeks(txt);
      setNamaFile(f.name);
      setParsed(parseProdukCsv(txt));
    };
    reader.readAsText(f, 'utf-8');
  }

  function ubahTeks(v: string) {
    setTeks(v);
    setParsed(parseProdukCsv(v));
  }

  async function jalankan() {
    if (!parsed || !parsed.rows.length) return;
    setBusy(true);
    try {
      const res = await onImport(parsed.rows);
      setHasil(res);
    } finally {
      setBusy(false);
    }
  }

  const jumlahSiap = parsed?.rows.length ?? 0;
  const peringatan = parsed?.errors.length ?? 0;

  return (
    <Modal
      open={open}
      title="Import Produk (CSV)"
      onClose={() => (busy ? undefined : onClose())}
      width="max-w-lg"
      footer={
        hasil ? (
          <>
            <button type="button" className="btn-outline" onClick={onClose}>
              Tutup
            </button>
            <button type="button" className="btn-primary" onClick={onClose}>
              <CheckCircle2 className="h-4 w-4" /> Selesai
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn-outline" onClick={onClose} disabled={busy}>
              Batal
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => void jalankan()}
              disabled={busy || !jumlahSiap}
              data-loading={busy}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {busy ? 'Mengimpor…' : `Import ${jumlahSiap} Baris`}
            </button>
          </>
        )
      }
    >
      {hasil ? (
        <div className="space-y-2.5">
          <div className="flex items-center gap-2 rounded-lg bg-[#e8f7ee] px-3 py-2.5 text-[13px] text-[#0a7a3d]">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>
              <b>{hasil.dibuat}</b> produk baru · <b>{hasil.diperbarui}</b> diperbarui
            </span>
          </div>
          {hasil.gagal.length ? (
            <div className="rounded-lg border border-[#ffd6d6] bg-[#fff5f5] p-3">
              <p className="flex items-center gap-1.5 text-[12px] font-bold text-[#e03131]">
                <AlertTriangle className="h-3.5 w-3.5" /> {hasil.gagal.length} baris gagal
              </p>
              <ul className="mt-1.5 space-y-1 text-[11.5px]" data-testid="impor-gagal">
                {hasil.gagal.slice(0, 8).map((g, i) => (
                  <li key={i} className="text-[#a85555]">
                    Baris {g.row}: {g.pesan}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="text-[11.5px] text-[#7a8ba0]">
            Data produk sudah dimuat ulang. Tutup untuk kembali ke daftar.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          <button
            type="button"
            className="btn-ghost px-0 text-[11.5px] font-semibold text-[#1b5fa8] hover:bg-transparent hover:underline"
            onClick={() => unduhTeks('contoh-produk.csv', contohCsv())}
          >
            ↓ Unduh contoh CSV
          </button>

          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            hidden
            aria-label="Pilih berkas CSV"
            onChange={(e) => {
              bacaFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-[#b9c9db] bg-[#f8fafd] px-4 py-5 text-[12.5px] font-semibold text-[#5b6b80] transition hover:border-[#1b5fa8] hover:text-[#1b5fa8]"
            onClick={() => fileRef.current?.click()}
          >
            <FileUp className="h-4 w-4" />
            {namaFile || 'Pilih berkas .csv…'}
          </button>

          <textarea
            aria-label="Tempel isi CSV"
            spellCheck={false}
            className="input h-32 w-full resize-y font-mono text-[11px] leading-relaxed"
            placeholder="…atau tempel isi CSV di sini (baris pertama = header)…"
            value={teks}
            onChange={(e) => ubahTeks(e.target.value)}
          />

          {parsed ? (
            <p
              data-testid="impor-ringkasan"
              className={`rounded-lg px-3 py-2 text-[12px] font-semibold ${
                peringatan
                  ? 'bg-[#fff9db] text-[#a35b00]'
                  : jumlahSiap
                    ? 'bg-[#e8f7ee] text-[#0a7a3d]'
                    : 'bg-[#f1f3f5] text-[#7a8ba0]'
              }`}
            >
              {jumlahSiap
                ? `${jumlahSiap} baris siap diimport${peringatan ? ` · ${peringatan} peringatan/lewat` : ''}.`
                : peringatan
                  ? `Tidak ada baris valid — ${peringatan} masalah.`
                  : 'Menunggu isi CSV…'}
            </p>
          ) : null}

          {parsed && peringatan ? (
            <ul className="max-h-24 space-y-0.5 overflow-auto rounded-lg bg-[#fff5f5] p-2 text-[11px] text-[#a85555]">
              {parsed.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          ) : null}

          <p className="text-[11px] leading-relaxed text-[#7a8ba0]">
            Kolom: barcode, nama (wajib), kategori, harga_jual, harga_pokok, stok, stok_minimum,
            satuan, varian. Produk dikenali dari <b>barcode</b> (lalu nama); barcode sama = data
            diperbarui, barcode baru = produk baru.
          </p>
        </div>
      )}
    </Modal>
  );
}