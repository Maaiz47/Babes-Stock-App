import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const secret = new TextEncoder().encode(process.env.JWT_SECRET ?? 'babes-stock-dev-secret-change-in-prod');

const PUBLIC_PATHS = ['/login', '/signup', '/forgot-password', '/reset-password'];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isPublic = PUBLIC_PATHS.some(p => pathname.startsWith(p));
  // Routes that authenticate themselves and must never be cookie-gated here.
  // /api/meds/dispatch is called by cron with a Bearer token and no cookie: a
  // redirect to /login would return 200 HTML, so the caller would report success
  // while no reminder was ever sent. The route does its own constant-time
  // CRON_SECRET check, so bypassing the cookie gate does not open it up.
  const isApi = pathname.startsWith('/api/auth')
    || pathname.startsWith('/api/init')
    || pathname.startsWith('/api/meds/dispatch');

  if (isPublic || isApi) {
    // Already logged in → redirect away from auth pages
    if (isPublic) {
      const token = request.cookies.get('session')?.value;
      if (token) {
        try {
          await jwtVerify(token, secret);
          return NextResponse.redirect(new URL('/', request.url));
        } catch {}
      }
    }
    return NextResponse.next();
  }

  const token = request.cookies.get('session')?.value;
  if (!token) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  try {
    const { payload } = await jwtVerify(token, secret);
    // Admin-only routes
    if (pathname.startsWith('/admin') && !payload.isAdmin) {
      return NextResponse.redirect(new URL('/', request.url));
    }
    return NextResponse.next();
  } catch {
    const response = NextResponse.redirect(new URL('/login', request.url));
    response.cookies.delete('session');
    return response;
  }
}

/**
 * `/sw.js` and `/manifest.webmanifest` are excluded on purpose.
 *
 * Per the service-worker spec a redirect on the script fetch is a hard
 * registration failure — it cannot be followed. With them inside the matcher,
 * the moment the 7-day session JWT expired the browser's periodic update check
 * would get a 307 to /login, the registration would be torn down, and the
 * medicine alarms would stop firing with no visible error. Neither file
 * contains anything private.
 */
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|sw\\.js$|manifest\\.webmanifest$|.*\\.png$).*)',
  ],
};
