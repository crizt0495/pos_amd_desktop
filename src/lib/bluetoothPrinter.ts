import { bacaPrinterSettings, setPrinterSettings } from './printerSettings';
import { barisStruk, formatTanggalStruk, ringkasanStruk } from './receipt';
import { rupiah } from './format';
import type { ReceiptData } from './types';

/**
 * Printer thermal Bluetooth (ESC/POS) lewat Web Bluetooth API.
 *
 * - Pasangan perangkat dilakukan sekali lewat Pengaturan > Printer
 *   (butuh gesture user, syarat browser). Setelah itu ID perangkat
 *   disimpan di `printer_settings`, dan tiap aplikasi dibuka
 *   koneksi otomatis dicari ulang (`getDevices` + `gatt.connect`).
 * - Bila koneksi putus, listener `gattserverdisconnected` mencoba
 *   menyambung otomatis lagi beberapa kali.
 * - Cetak struk dikirim sebagai byte ESC/POS; kalau tidak tersambung,
 *   pemanggil jatuh ke `window.print()` seperti biasa.
 *
 * Catatan: hanya Chrome/Edge (desktop & Android) yang mendukung
 * Web Bluetooth; Firefox/Safari tidak — status `tidak-didukung`.
 */

export type StatusBluetooth =
  | 'tidak-didukung'
  | 'nonaktif'
  | 'mencoba'
  | 'tersambung'
  | 'gagal';

type Karakter = {
  uuid: string;
  writeValueWithoutResponse?: (data: ArrayBuffer) => Promise<void>;
  writeValue?: (data: ArrayBuffer) => Promise<void>;
};
type Layanan = { getCharacteristics: () => Promise<Karakter[]> };
type Server = {
  connected: boolean;
  connect: () => Promise<Server>;
  disconnect?: () => void;
  getPrimaryServices: (uuid?: string) => Promise<Layanan[]>;
};
export type PerangkatBluetooth = {
  id: string;
  name?: string | null;
  gatt?: Server;
  watchAdvertisements?: (options?: { signal?: AbortSignal }) => Promise<void>;
  addEventListener?: (type: string, listener: () => void) => void;
};
type ApiBluetooth = {
  getDevices?: () => Promise<PerangkatBluetooth[]>;
  requestDevice: (options: unknown) => Promise<PerangkatBluetooth>;
};

/* Layanan GATT umum pada printer thermal ESC/POS murah (58mm/80mm). */
const LAYANAN_UMUM = [
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '000018f0-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
];

let perangkat: PerangkatBluetooth | null = null;
let karakter: Karakter | null = null;
let status: StatusBluetooth = 'nonaktif';
let mencobaLagi = false;
let sedangSambung = false;
let timerUlang: number | null = null;
const dipantau = new WeakSet<PerangkatBluetooth>();
const pendengar = new Set<(s: StatusBluetooth) => void>();

function api(): ApiBluetooth | null {
  if (typeof navigator === 'undefined') return null;
  return (navigator as unknown as { bluetooth?: ApiBluetooth }).bluetooth ?? null;
}

export function didukungBluetooth(): boolean {
  return api() != null;
}

export function statusBluetooth(): StatusBluetooth {
  return status;
}

export function dengarStatusBluetooth(fn: (s: StatusBluetooth) => void): () => void {
  pendengar.add(fn);
  fn(status);
  return () => pendengar.delete(fn);
}

function setStatus(s: StatusBluetooth) {
  if (status === s) return;
  status = s;
  pendengar.forEach((fn) => fn(s));
}

async function cariKarakter(server: Server): Promise<Karakter | null> {
  let layanan: Layanan[] = [];
  try {
    layanan = await server.getPrimaryServices();
  } catch {
    return null;
  }
  for (const l of layanan) {
    const chars = await l.getCharacteristics().catch(() => [] as Karakter[]);
    const tulis = chars.find((c) => Boolean(c.writeValueWithoutResponse || c.writeValue));
    if (tulis) return tulis;
  }
  return null;
}

async function sambung(dev: PerangkatBluetooth, percobaan = 3): Promise<boolean> {
  if (!dev.gatt || sedangSambung) return tersambung();
  sedangSambung = true;
  setStatus('mencoba');
  try {
    for (let i = 0; i < percobaan; i++) {
      try {
        if (!dev.gatt.connected) await dev.gatt.connect();
        const c = await cariKarakter(dev.gatt);
        if (c) {
          perangkat = dev;
          karakter = c;
          setStatus('tersambung');
          return true;
        }
      } catch {
        /* coba lagi */
      }
      if (i < percobaan - 1) await new Promise((r) => setTimeout(r, 1200));
    }
    setStatus('gagal');
    return false;
  } finally {
    sedangSambung = false;
  }
}

function pantau(dev: PerangkatBluetooth) {
  if (dipantau.has(dev)) return;
  dipantau.add(dev);
  dev.addEventListener?.('gattserverdisconnected', () => {
    karakter = null;
    if (mencobaLagi) return;
    mencobaLagi = true;
    setStatus('mencoba');
    void sambung(dev).finally(() => {
      mencobaLagi = false;
    });
  });
  // Printer mulai mengiklankan dirinya -> langsung sambung tanpa menunggu.
  dev.addEventListener?.('advertisementreceived', () => {
    if (!tersambung()) void sambung(dev, 1);
  });
  dev.watchAdvertisements?.().catch(() => {
    /* izin iklan tidak tersedia — gatt.connect tetap dicoba */
  });
}

/**
 * Pengulang latar belakang: selama "sambung otomatis" aktif dan belum
 * tersambung, coba lagi tiap 6 detik (mis. printer baru dinyalakan
 * setelah aplikasi terbuka).
 */
function mulaiPengulang() {
  if (typeof window === 'undefined' || timerUlang != null) return;
  timerUlang = window.setInterval(() => {
    const pref = bacaPrinterSettings();
    if (!pref.btAutoConnect || !pref.btDeviceId) {
      hentikanPengulang();
      return;
    }
    if (tersambung() || sedangSambung) return;
    void autoSambungBluetooth();
  }, 6000);
}

function hentikanPengulang() {
  if (timerUlang != null && typeof window !== 'undefined') window.clearInterval(timerUlang);
  timerUlang = null;
}

/** Pasangkan perangkat baru — HARUS dipanggil dari handler klik user. */
export async function pasangkanBluetooth(): Promise<{ ok: boolean; pesan: string }> {
  const bt = api();
  if (!bt) return { ok: false, pesan: 'Browser ini tidak mendukung Web Bluetooth (pakai Chrome/Edge).' };
  let dev: PerangkatBluetooth;
  try {
    dev = await bt.requestDevice({
      acceptAllDevices: true,
      optionalServices: LAYANAN_UMUM,
    });
  } catch {
    return { ok: false, pesan: 'Pemilihan perangkat dibatalkan.' };
  }
  const pref = bacaPrinterSettings();
  pref.btDeviceId = dev.id;
  pref.btDeviceName = dev.name || 'Printer Bluetooth';
  pref.btAutoConnect = true;
  setPrinterSettings(pref);
  pantau(dev);
  const ok = await sambung(dev);
  return {
    ok,
    pesan: ok
      ? `Tersambung ke ${pref.btDeviceName}.`
      : 'Perangkat terpilih tapi gagal tersambung. Coba lagi dekat printer.',
  };
}

export function putusBluetooth() {
  hentikanPengulang();
  karakter = null;
  try {
    if (perangkat?.gatt?.connected) perangkat.gatt.disconnect?.();
  } catch {
    /* abaikan */
  }
  perangkat = null;
  const pref = bacaPrinterSettings();
  pref.btDeviceId = null;
  pref.btDeviceName = null;
  pref.btAutoConnect = false;
  setPrinterSettings(pref);
  setStatus('nonaktif');
}

/**
 * Sambung otomatis ke perangkat yang pernah dipasang — dipanggil saat
 * aplikasi dibuka. Tidak butuh gesture karena izin sudah diberikan
 * sekali saat pasangkan.
 */
export async function autoSambungBluetooth(): Promise<StatusBluetooth> {
  const bt = api();
  const pref = bacaPrinterSettings();
  if (!bt) {
    setStatus('tidak-didukung');
    return status;
  }
  if (!pref.btAutoConnect || !pref.btDeviceId || !bt.getDevices) {
    setStatus('nonaktif');
    return status;
  }
  setStatus('mencoba');
  try {
    const devices = await bt.getDevices();
    const dev = devices.find((d) => d.id === pref.btDeviceId);
    if (!dev) {
      setStatus('gagal');
      return status;
    }
    pantau(dev);
    await sambung(dev);
  } catch {
    setStatus('gagal');
  }
  // Gagal sekali pun tetap diulang otomatis tiap 6 detik.
  if (status !== 'tersambung') mulaiPengulang();
  return status;
}

export function tersambung(): boolean {
  return Boolean(karakter && perangkat?.gatt?.connected !== false);
}

/* ----------------------------- ESC/POS ---------------------------------- */

function lebarUkuran(ukuran: string): number {
  return ukuran === '80mm' ? 48 : 32;
}

function pad(kiri: string, kanan: string, lebar: number): string {
  const spasi = Math.max(1, lebar - kiri.length - kanan.length);
  const s = kiri + ' '.repeat(spasi) + kanan;
  return s.length > lebar ? s.slice(0, lebar) : s;
}

/** Susun teks struk (lebar mengikuti ukuran kertas setting) -> byte ESC/POS. */
export function strukKeBytes(data: ReceiptData, ukuran: string): Uint8Array {
  const lebar = lebarUkuran(ukuran);
  const baris = barisStruk(data);
  const { subtotalKotor, totalPotongan, total } = ringkasanStruk(data, baris);
  const tengah = (s: string) => (s.length >= lebar ? s.slice(0, lebar) : s + ' '.repeat(Math.floor((lebar - s.length) / 2)));
  const garis = '-'.repeat(lebar);

  const teks: string[] = [];
  const ESC = '\x1b';
  const center = `${ESC}a\x01`;
  const left = `${ESC}a\x00`;
  const bold = `${ESC}E\x01`;
  const normal = `${ESC}E\x00`;

  teks.push(`${ESC}@`, center, tengah(data.storeName));
  if (data.storeAddress) teks.push(tengah(data.storeAddress.slice(0, lebar)));
  if (data.storePhone) teks.push(tengah(`Telp: ${data.storePhone}`));
  teks.push(left, garis);
  teks.push(pad('No', data.invoiceNo, lebar));
  teks.push(pad('Tgl', formatTanggalStruk(data.createdAt), lebar));
  teks.push(pad('Kasir', data.cashierName, lebar));
  teks.push(garis);
  for (const b of baris) {
    teks.push(b.name.slice(0, lebar));
    teks.push(pad(`  ${b.qty} x ${rupiah(b.price)}`, rupiah(b.gross), lebar));
    if (b.discount > 0) {
      const label = `${b.discountLabel || 'Pot/Diskon'}${b.discountPct != null ? ` ${b.discountPct}%` : ''}`;
      teks.push(pad(`  ${label}`, `-${rupiah(b.discount)}`, lebar));
    }
    teks.push(pad('  Net', rupiah(b.net), lebar));
  }
  teks.push(garis);
  teks.push(pad('Subtotal', rupiah(subtotalKotor), lebar));
  if (totalPotongan > 0) teks.push(pad('Potongan', `-${rupiah(totalPotongan)}`, lebar));
  teks.push(bold, pad('TOTAL', rupiah(total), lebar), normal);
  teks.push(pad('Bayar', rupiah(data.paid), lebar));
  teks.push(pad('Kembali', rupiah(data.changeDue), lebar));
  if (data.note) teks.push(pad('Catatan', data.note.slice(0, lebar - 9), lebar));
  teks.push(garis);
  teks.push(center, 'Terima kasih', `${left}${ESC}d\x03`); // feed 3 baris
  teks.push(`${ESC}m\x01`); // potong kertas parsial (diabaikan bila tak didukung)

  const enc = new TextEncoder().encode(teks.join('\n'));
  return enc;
}

/** Kirim byte apa pun ke printer (chunk kecil agar BLE tidak menolak). */
export async function kirimBytes(bytes: Uint8Array): Promise<boolean> {
  if (!tersambung() || !karakter) return false;
  const CHUNK = 128;
  try {
    for (let i = 0; i < bytes.length; i += CHUNK) {
      const potong = bytes.slice(i, i + CHUNK);
      const buf = potong.buffer.slice(potong.byteOffset, potong.byteOffset + potong.byteLength);
      if (karakter.writeValueWithoutResponse) await karakter.writeValueWithoutResponse(buf);
      else await karakter.writeValue!(buf);
      await new Promise((r) => setTimeout(r, 30));
    }
    return true;
  } catch {
    setStatus('gagal');
    return false;
  }
}

/**
 * Cetak struk ke printer Bluetooth bila tersambung & ukurannya thermal.
 * Mengembalikan `false` agar pemanggil fallback ke `window.print()`.
 */
export async function cetakStrukBluetooth(data: ReceiptData): Promise<boolean> {
  const pref = bacaPrinterSettings();
  if (pref.ukuran === 'A4') return false;
  if (pref.btDeviceId && pref.btAutoConnect) {
    // Belum tersambung? Coba sambung dulu sekarang (tanpa dialog browser).
    if (!tersambung()) await autoSambungBluetooth();
    mulaiPengulang();
  }
  if (!tersambung()) return false;
  const bytes = strukKeBytes(data, pref.ukuran);
  return kirimBytes(bytes);
}
