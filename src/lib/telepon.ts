/**
 * Aturan nomor telepon bersama untuk seluruh Desktop.
 *
 * Dulu `POLA_HP` + `hanyaDigit` hidup lokal di `ModalPelanggan`, sementara
 * `SettingsModal` (telepon toko) tidak punya sanitasi apa pun — sehingga
 * "0812-abc" bisa tersimpan dan ikut tercetak di struk. Keduanya sekarang
 * memakai aturan yang sama dari file ini.
 */

/** Nomor HP Indonesia: diawali 08, total 10-13 digit (mis. 081234567890). */
export const POLA_HP = /^08\d{8,11}$/;

/** Buang semua karakter selain digit. */
export const hanyaAngka = (s: string): string => (s ?? '').replace(/\D/g, '');

/**
 * Nomor telepon untuk disimpan/disimpan ke database: hanya digit, maksimal
 * 15 karakter (batas E.164). Lapisan terakhir sebelum write.
 */
export const bersihkanTelepon = (v: string, maks = 15): string =>
  hanyaAngka(v).slice(0, maks);

/**
 * Sisa-sisa karakter non-digit yang user ketik/paste. Dipakai sebagai
 * `onBeforeInput` blocker supaya karakter tidak pernah sempat muncul di
 * layar — menyaring di `onChange` saja membiarkan karakter berkedip satu
 * frame sebelum hilang.
 */
export const karakterIlegalTelepon = (data: string | null): boolean => /\D/.test(data ?? '');