'use client';

import { useEffect } from 'react';

import { attachSync } from '@/lib/supabase/sync';

/**
 * Menyalakan sinkronisasi database lokal → Supabase saat aplikasi berjalan di
 * shell desktop dengan database lokal aktif (offline-first). Tidak berefek di
 * browser biasa.
 */
export default function DesktopSync() {
  useEffect(() => attachSync(), []);
  return null;
}
