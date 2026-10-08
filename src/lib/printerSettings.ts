export type UkuranPrinter = '58mm' | '80mm' | 'A4';

export interface PreferensiPrinter {
  nama: string;
  ukuran: UkuranPrinter;
  autoPrint: boolean;
}

const KEY = 'printer_settings';

export function bacaPrinterSettings(): PreferensiPrinter {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { nama: 'System Printer', ukuran: '80mm', autoPrint: true };
    const parsed = JSON.parse(raw) as Partial<PreferensiPrinter>;
    return {
      nama: parsed.nama ?? 'System Printer',
      ukuran: (parsed.ukuran as UkuranPrinter) ?? '80mm',
      autoPrint: parsed.autoPrint !== false,
    };
  } catch {
    return { nama: 'System Printer', ukuran: '80mm', autoPrint: true };
  }
}

export function setPrinterSettings(p: PreferensiPrinter): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}
