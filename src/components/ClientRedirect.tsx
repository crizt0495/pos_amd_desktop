'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Pengalihan client-side untuk mode ekspor statis desktop (tanpa server).
 * Dipakai halaman `/` yang di web memakai redirect server-side.
 */
export default function ClientRedirect({ to }: { to: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(to);
  }, [router, to]);
  return null;
}
