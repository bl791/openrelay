import { NextResponse, type NextRequest } from 'next/server';

const AUTH_COOKIE = 'openrelay_auth';
const PROTECTED_PREFIXES = ['/dashboard', '/streams'];
const AUTH_PAGES = ['/login', '/register'];

/**
 * Edge guard for the dashboard. Presence of the (non-httpOnly) auth cookie is the
 * gate; the API remains the source of truth and rejects invalid tokens, but this
 * prevents flashing protected pages to logged-out operators and bounces
 * authenticated users away from the auth screens.
 */
export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.get(AUTH_COOKIE)?.value === '1';

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (isProtected && !hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  if (hasSession && AUTH_PAGES.includes(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/streams/:path*', '/login', '/register'],
};
