export type UkuranPrinter = '58mm' | '80mm' | 'A4';

export interface PreferensiPrinter {
  /** Nama printer terpilih. Web tidak bisa auto-detect, jadi daftar diisi manual. */
  nama: string;
  /** Daftar nama printer yang ditambahkan manual (tersimpan lokal). */
  namaManual: string[];
  ukuran: UkuranPrinter;
  autoPrint: boolean;
  /** ID perangkat Bluetooth yang pernah dipasang (Web Bluetooth). */
  btDeviceId: string | null;
  btDeviceName: string | null;
  /** Sambung otomatis tiap aplikasi dibuka. */
  btAutoConnect: boolean;
}

const KEY = 'printer_settings';

const DEFAULT: PreferensiPrinter = {
  nama: 'System Printer',
  namaManual: [],
  ukuran: '80mm',
  autoPrint: true,
  btDeviceId: null,
  btDeviceName: null,
  btAutoConnect: true,
};

export function bacaPrinterSettings(): PreferensiPrinter {
  try {
    if (typeof localStorage === 'undefined') return { ...DEFAULT };
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT };
    const parsed = JSON.parse(raw) as Partial<PreferensiPrinter>;
    return {
      nama: parsed.nama ?? DEFAULT.nama,
      namaManual: Array.isArray(parsed.namaManual)
        ? parsed.namaManual.filter((x): x is string => typeof x === 'string')
        : [],
      ukuran: (parsed.ukuran as UkuranPrinter) ?? DEFAULT.ukuran,
      autoPrint: parsed.autoPrint !== false,
      btDeviceId: parsed.btDeviceId ?? null,
      btDeviceName: parsed.btDeviceName ?? null,
      btAutoConnect: parsed.btAutoConnect !== false,
    };
  } catch {
    return { ...DEFAULT };
  }
}

export function setPrinterSettings(p: PreferensiPrinter): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}
