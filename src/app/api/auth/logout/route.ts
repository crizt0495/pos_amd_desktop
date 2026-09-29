import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/** POST /api/auth/logout — hapus sesi Supabase lalu kembali ke /login. */
export async function POST(_req: Request) {
  const supabase = createClient();
  await supabase.auth.signOut();
  return NextResponse.json({ ok: true, message: 'Logout berhasil.' });
}