import { draftGet, draftSet } from './localStore';

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

/** Cache memori untuk mempertahankan sinkronitas baca. */
let cache: PreferensiPrinter | null = null;
let memuat = false;

/** Baca nilai lama dari localStorage — untuk migrasi. */
function bacaDariLocalStorage(): PreferensiPrinter | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
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
    return null;
  }
}

/** Normalisasi objek. */
function rapikan(p: Partial<PreferensiPrinter> | null): PreferensiPrinter {
  if (!p) return { ...DEFAULT };
  return {
    nama: p.nama ?? DEFAULT.nama,
    namaManual: Array.isArray(p.namaManual)
      ? p.namaManual.filter((x): x is string => typeof x === 'string')
      : [],
    ukuran: (p.ukuran as UkuranPrinter) ?? DEFAULT.ukuran,
    autoPrint: p.autoPrint !== false,
    btDeviceId: p.btDeviceId ?? null,
    btDeviceName: p.btDeviceName ?? null,
    btAutoConnect: p.btAutoConnect !== false,
  };
}

/** Muat dari SQLite dan migrasi. */
async function muatDariDb() {
  if (memuat) return;
  memuat = true;
  try {
    const db = await draftGet<PreferensiPrinter>(KEY);
    if (db) {
      cache = rapikan(db);
    } else if (cache) {
      draftSet(KEY, cache);
    }
    try {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  } finally {
    memuat = false;
  }
}

export function bacaPrinterSettings(): PreferensiPrinter {
  try {
    if (typeof window === 'undefined') return { ...DEFAULT };
  } catch {
    return { ...DEFAULT };
  }
  if (cache) return cache;
  const lama = bacaDariLocalStorage();
  cache = lama ? lama : { ...DEFAULT };
  void muatDariDb();
  return cache;
}

export function setPrinterSettings(p: PreferensiPrinter): void {
  const next = rapikan(p);
  cache = next;
  draftSet(KEY, next);
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
