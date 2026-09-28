/**
 * Rate limiter in-memory untuk endpoint publik (aktivasi & login).
 *
 * ⚠️ CATATAN VERCEL: setiap instance serverless punya memori sendiri, jadi
 * limiter ini bukan pembatas mutlak di skala besar (bisa di-bypass dengan
 * menyebar percobaan ke banyak instance). Namun ia tetap menutup serangan
 * brute-force paling sederhana: banyak percobaan dari satu IP pada satu
 * instance. Untuk pertahanan berlapis gunakan juga rate limiting di edge
 * (mis. Upstash) atau built-in auth rate limits dari Supabase.
 */

const WINDOW_MS = 15 * 60 * 1000; // 15 menit

/** Percobaan aktivasi serial key per IP per jendela. */
export const MAX_ACTIVATE = 30;
/** Percobaan login per IP per jendela. */
export const MAX_LOGIN = 20;

const buckets = new Map<string, { count: number; resetAt: number }>();

/**
 * Konsumsi satu slot untuk `key`. Mengembalikan `ok=false` bila sudah
 * melewati `max` percobaan dalam satu jendela waktu.
 */
export function consume(key: string, max: number): { ok: boolean; retryAfterMs: number } {
  const now = Date.now();

  // Jaga memori: buang entri yang sudah kedaluwarsa bila peta membesar.
  if (buckets.size > 5000) {
    for (const [k, b] of buckets) {
      if (b.resetAt <= now) buckets.delete(k);
    }
  }

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { ok: true, retryAfterMs: 0 };
  }

  bucket.count += 1;
  if (bucket.count > max) {
    return { ok: false, retryAfterMs: bucket.resetAt - now };
  }
  return { ok: true, retryAfterMs: 0 };
}

/**
 * IP klien dari header proxy, disanitasi agar hanya menyisakan karakter IP
 * yang sah (mencegah data lain ikut tersimpan di dalam kunci rate limit).
 */
export function clientIpFromRequest(req: Request): string {
  const raw =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip')?.trim() ||
    'unknown';
  const cleaned = raw.replace(/[^0-9a-fA-F:.\[\]]/g, '');
  return cleaned || 'unknown';
}

/** Kunci pembatas per-konteks (pisahkan jendela aktivasi vs login). */
export function rateLimitKey(ip: string, scope: 'activate' | 'login'): string {
  return `${scope}:${ip}`;
}