import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { SESSION_COOKIE } from '@/lib/sessionCookie';

// Baseline "must be logged in" gate for every API route and dashboard page.
// Fine-grained access stays with requirePermission() (src/lib/rbac.ts).
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/api/auth')) {
    return NextResponse.next();
  }

  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET, cookieName: SESSION_COOKIE });

  if (pathname === '/login') {
    return token ? NextResponse.redirect(new URL('/dashboard', request.url)) : NextResponse.next();
  }

  if (token) {
    return NextResponse.next();
  }

  if (pathname.startsWith('/api')) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('callbackUrl', pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/api/:path*', '/dashboard/:path*', '/login'],
};
