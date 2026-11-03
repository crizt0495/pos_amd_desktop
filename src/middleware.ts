import { type NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

import { env } from '@/lib/env';

/**
 * Refresh sesi Supabase + proteksi route.
 *  - /kasir, /produk, /laporan  -> wajib login
 *  - /login                     -> kalau sudah login, lempar ke /kasir
 */
const PROTECTED = ['/kasir', '/produk', '/laporan'];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  let response = NextResponse.next({ request: { headers: req.headers } });

  const isProtected = PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const needAuth = isProtected || pathname === '/login';

  let user: { id: string } | null = null;
  if (needAuth) {
    const supabase = createServerClient(env.supabaseUrl, env.supabaseAnonKey || 'public-anon-key', {
      cookies: {
        getAll() { return req.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value));
          response = NextResponse.next({ request: { headers: req.headers } });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options as never));
        },
      },
    });
    try {
      const { data } = await supabase.auth.getUser();
      user = data.user ?? null;
    } catch {
      user = null;
    }
  }

  if (isProtected && !user) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  if (pathname === '/login' && user) {
    const url = req.nextUrl.clone();
    url.pathname = '/kasir';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ['/((?!.*\\.(?:ico|png|jpg|jpeg|svg|webp|css|js|woff2?)$).*)'],
};