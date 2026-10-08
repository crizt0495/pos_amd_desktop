export type UkuranPrinter = '58mm' | '80mm' | 'A4';

export interface PreferensiPrinter {
  nama: string;
  ukuran: UkuranPrinter;
  autoPrint: boolean;
  /** ID perangkat Bluetooth yang pernah dipasang (Web Bluetooth). */
  btDeviceId: string | null;
  btDeviceName: string | null;
  /** Sambung otomatis tiap aplikasi dibuka. */
  btAutoConnect: boolean;
}

const KEY = 'printer_settings';

export function bacaPrinterSettings(): PreferensiPrinter {
  try {
    if (typeof localStorage === 'undefined') return { nama: 'System Printer', ukuran: '80mm', autoPrint: true, btDeviceId: null, btDeviceName: null, btAutoConnect: true };
    const raw = localStorage.getItem(KEY);
    if (!raw) return { nama: 'System Printer', ukuran: '80mm', autoPrint: true, btDeviceId: null, btDeviceName: null, btAutoConnect: true };
    const parsed = JSON.parse(raw) as Partial<PreferensiPrinter>;
    return {
      nama: parsed.nama ?? 'System Printer',
      ukuran: (parsed.ukuran as UkuranPrinter) ?? '80mm',
      autoPrint: parsed.autoPrint !== false,
      btDeviceId: parsed.btDeviceId ?? null,
      btDeviceName: parsed.btDeviceName ?? null,
      btAutoConnect: parsed.btAutoConnect !== false,
    };
  } catch {
    return { nama: 'System Printer', ukuran: '80mm', autoPrint: true, btDeviceId: null, btDeviceName: null, btAutoConnect: true };
  }
}

export function setPrinterSettings(p: PreferensiPrinter): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}
