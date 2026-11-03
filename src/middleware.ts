import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!.*\\.(?:ico|png|jpg|jpeg|svg|webp|css|js|woff2?)$).*)'],
};
