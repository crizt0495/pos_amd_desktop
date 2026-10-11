import { redirect } from 'next/navigation';

import ClientRedirect from '@/components/ClientRedirect';

/**
 * `/` → `/kasir`.
 *  - Web/Vercel: redirect server-side (307).
 *  - Ekspor statis desktop: tanpa server, jadi dialihkan di client.
 */
export default function HomePage() {
  if (process.env.DESKTOP_EXPORT === '1') return <ClientRedirect to="/kasir" />;
  redirect('/kasir');
}
