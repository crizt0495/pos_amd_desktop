/**
 * Utilitas ekspor tanpa library tambahan.
 *   - `unduhExcel`  : simpan tabel HTML sebagai berkas .xls (dibuka Excel).
 *   - `cetakHtml`   : buka jendela cetak (simpan sebagai PDF).
 */

/** Simpan tabel HTML (string `<table>…</table>`) sebagai berkas Excel .xls. */
export function unduhExcel(namaBerkas: string, tabelHtml: string, judul = '') {
  const html = `<!doctype html><html><head><meta charset="utf-8" />
    <style>table{border-collapse:collapse}th,td{border:1px solid #999;padding:4px 8px;font-family:sans-serif;font-size:12px}th{background:#e8eef7;text-align:left}.num{text-align:right}</style>
    </head><body>${judul ? `<h3>${judul}</h3>` : ''}${tabelHtml}</body></html>`;
  const blob = new Blob(['\ufeff' + html], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = namaBerkas.endsWith('.xls') ? namaBerkas : `${namaBerkas}.xls`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Buka jendela baru berisi dokumen HTML siap cetak, lalu panggil `window.print()`.
 * `css` opsional untuk mengatur format kertas.
 */
export function cetakHtml(judul: string, bodyHtml: string, css = '') {
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) {
    alert('Izinkan popup untuk bisa mencetak / menyimpan PDF.');
    return;
  }
  win.document.write(`<!doctype html><html><head><meta charset="utf-8" />
    <title>${judul}</title>
    <style>
      @page{size:A4 portrait;margin:10mm}
      body{font-family:sans-serif;padding:20px;color:#1b3a5c;font-size:12px}
      h1,h2,h3{margin:0 0 4px}
      table{width:100%;border-collapse:collapse;margin-top:10px}
      th,td{border:1px solid #d8e0ec;padding:5px 8px;font-size:12px}
      th{background:#f6f9fd;text-align:left}
      .num{text-align:right;font-variant-numeric:tabular-nums}
      .muted{color:#5b6b80}
      ${css}
    </style></head><body>${bodyHtml}
    <script>window.onload=function(){window.print();}</script>
    </body></html>`);
  win.document.close();
}

/** Escape teks agar aman dimasukkan ke HTML. */
export function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
