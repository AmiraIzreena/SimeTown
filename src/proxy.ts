import { NextResponse, type NextRequest } from 'next/server';

/**
 * Runs before every page. It sets a strict Content-Security-Policy with a
 * fresh nonce per request (the main defence against cross-site scripting) and
 * sends signed-out visitors to the sign-in page. This redirect is a
 * convenience only: every API call checks the session and role again on the
 * server (see src/server/http/router.ts).
 */

const PROTECTED = ['/app', '/merchant', '/sponsor', '/guard', '/courier', '/console'];
const SESSION_COOKIES = ['__Host-kita_session', 'kita_session'];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const signedIn = SESSION_COOKIES.some((name) => request.cookies.has(name));
  if (!signedIn && PROTECTED.some((area) => pathname === area || pathname.startsWith(`${area}/`))) {
    const login = new URL('/login', request.url);
    login.searchParams.set('next', pathname + request.nextUrl.search);
    return NextResponse.redirect(login);
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const dev = process.env.NODE_ENV === 'development';
  const googleMaps = Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY);
  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? ` 'unsafe-eval'` : ''}`,
    // Stylesheets are our own files. Inline style *attributes* are allowed for computed widths (progress bars, charts).
    dev ? `style-src 'self' 'unsafe-inline'${googleMaps ? ' https://fonts.googleapis.com' : ''}` : `style-src 'self' 'nonce-${nonce}'${googleMaps ? ' https://fonts.googleapis.com' : ''}`,
    `style-src-attr 'unsafe-inline'`,
    // Kitar map tiles: the OpenStreetMap tile server only.
    `img-src 'self' data: blob: https://tile.openstreetmap.org https://*.tile.openstreetmap.org${googleMaps ? ' https://*.googleapis.com https://*.gstatic.com https://*.google.com https://*.googleusercontent.com' : ''}`,
    `font-src 'self'${googleMaps ? ' https://fonts.gstatic.com' : ''}`,
    `connect-src 'self'${googleMaps ? ' https://*.googleapis.com https://*.google.com https://*.gstatic.com data: blob:' : ''}`,
    ...(googleMaps ? [`frame-src https://*.google.com`, `worker-src blob:`] : []),
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    ...(request.nextUrl.protocol === 'https:' ? ['upgrade-insecure-requests'] : []),
  ].join('; ');

  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  // Pages only: the API sends JSON, and static files need no policy.
  matcher: [{ source: '/((?!api|_next/static|_next/image|favicon.ico|icon.svg).*)', missing: [{ type: 'header', key: 'next-router-prefetch' }] }],
};
