import { auth } from '@/auth';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export default async function proxy(req: NextRequest) {
  const session = await auth();
  const { pathname } = req.nextUrl;

  const PROTECTED = ['/dashboard', '/onboarding', '/settings'];
  const isProtected = PROTECTED.some((p) => pathname.startsWith(p));

  if (isProtected && !session?.user?.id) {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (
    session?.user?.id &&
    !session.user.onboardingComplete &&
    pathname.startsWith('/dashboard')
  ) {
    return NextResponse.redirect(new URL('/onboarding', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/onboarding/:path*', '/settings/:path*'],
};
