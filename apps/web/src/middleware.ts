import { NextRequest, NextResponse } from "next/server";

function getSessionPayload(sessionToken: string): Record<string, unknown> | null {
    try {
        const parts = sessionToken.split('.');
        if (parts.length < 2) return null;
        return JSON.parse(Buffer.from(parts[1], 'base64').toString()) as Record<string, unknown>;
    } catch {
        return null;
    }
}

export const config = {
    matcher: [
        /*
         * Match all paths except for:
         * 1. /api routes
         * 2. /_next (Next.js internals)
         * 3. /_static (inside /public)
         * 4. all root files inside /public (e.g. /favicon.ico)
         */
        "/((?!api/|_next/|_static/|[\\w-]+\\.\\w+).*)",
    ],
};

// Rate limiting for login attempts (in-memory, per IP)
const loginAttempts = new Map<string, { count: number; lastAttempt: number; blockedUntil: number }>();
const MAX_LOGIN_ATTEMPTS = 5;
const BLOCK_DURATION = 15 * 60 * 1000; // 15 minutes
const ATTEMPT_WINDOW = 5 * 60 * 1000; // 5 minutes

function checkRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
    const now = Date.now();
    const record = loginAttempts.get(ip);

    if (!record) return { allowed: true };

    // If blocked, check if block has expired
    if (record.blockedUntil > now) {
        return { allowed: false, retryAfter: Math.ceil((record.blockedUntil - now) / 1000) };
    }

    // Reset if outside attempt window
    if (now - record.lastAttempt > ATTEMPT_WINDOW) {
        loginAttempts.delete(ip);
        return { allowed: true };
    }

    if (record.count >= MAX_LOGIN_ATTEMPTS) {
        record.blockedUntil = now + BLOCK_DURATION;
        return { allowed: false, retryAfter: Math.ceil(BLOCK_DURATION / 1000) };
    }

    return { allowed: true };
}

function recordLoginAttempt(ip: string) {
    const now = Date.now();
    const record = loginAttempts.get(ip);
    if (record) {
        record.count++;
        record.lastAttempt = now;
    } else {
        loginAttempts.set(ip, { count: 1, lastAttempt: now, blockedUntil: 0 });
    }
}

// Security headers
function addSecurityHeaders(response: NextResponse): NextResponse {
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('X-Frame-Options', 'SAMEORIGIN');
    response.headers.set('X-XSS-Protection', '1; mode=block');
    response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    response.headers.set(
        'Content-Security-Policy',
        [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://www.google-analytics.com https://static.cloudflareinsights.com",
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
            "img-src 'self' data: blob: https: http:",
            "font-src 'self' https://fonts.gstatic.com",
            "connect-src 'self' https://www.google-analytics.com https://vitals.vercel-analytics.com https://cloudflareinsights.com https://api.pazaryonetimi.com wss://api.pazaryonetimi.com ws://localhost:* http://localhost:*",
            "frame-ancestors 'self'",
            "base-uri 'self'",
            "form-action 'self'",
        ].join('; ')
    );
    return response;
}

export default async function middleware(req: NextRequest) {
    const url = req.nextUrl;
    const hostname = req.headers.get("host");
    const pathname = url.pathname;

    // ========== RATE LIMITING FOR LOGIN ==========
    if ((pathname === '/login' || pathname === '/admin/login') && req.method === 'POST') {
        const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
            req.headers.get('x-real-ip') ||
            'unknown';
        const rateCheck = checkRateLimit(ip);
        if (!rateCheck.allowed) {
            const response = NextResponse.json(
                { error: 'Çok fazla giriş denemesi. Lütfen daha sonra tekrar deneyin.' },
                { status: 429 }
            );
            response.headers.set('Retry-After', String(rateCheck.retryAfter || 900));
            return addSecurityHeaders(response);
        }
        recordLoginAttempt(ip);
    }

    // ========== AUTH PROTECTION ==========
    // Check for NextAuth session token
    const sessionToken = req.cookies.get('next-auth.session-token')?.value ||
        req.cookies.get('__Secure-next-auth.session-token')?.value ||
        req.cookies.get('authjs.session-token')?.value ||
        req.cookies.get('__Secure-authjs.session-token')?.value;

    // Protect /dashboard/* routes - require authentication
    if (pathname.startsWith('/dashboard')) {
        if (!sessionToken) {
            const loginUrl = new URL('/login', req.url);
            loginUrl.searchParams.set('callbackUrl', pathname);
            const response = NextResponse.redirect(loginUrl);
            return addSecurityHeaders(response);
        }
    }

    // Redirect to onboarding if tenant is not yet onboarded
    if (pathname.startsWith('/dashboard') && sessionToken) {
        const payload = getSessionPayload(sessionToken);
        if (payload?.isOnboarded === false && !pathname.startsWith('/onboarding')) {
            const onboardingUrl = new URL('/onboarding', req.url);
            const response = NextResponse.redirect(onboardingUrl);
            return addSecurityHeaders(response);
        }
    }

    // Protect /admin/* routes — platform admin only
    if (pathname.startsWith('/admin') && pathname !== '/admin/login') {
        if (!sessionToken) {
            const loginUrl = new URL('/admin/login', req.url);
            loginUrl.searchParams.set('callbackUrl', pathname);
            const response = NextResponse.redirect(loginUrl);
            return addSecurityHeaders(response);
        }

        // This middleware only decodes session-cookie text and cannot verify its
        // signature. The admin client reads the authenticated NextAuth session,
        // and every admin API request is independently authorized by the API.
    }

    const isLocalHost = hostname?.startsWith('localhost') || hostname?.startsWith('127.0.0.1');
    const isIpAddress = /^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/.test(hostname || '');
    const isDevDomain = hostname?.includes('sslip.io') || hostname?.includes('nip.io') || hostname?.includes('traefik') || hostname?.includes('local');

    // Extract base domain from NEXTAUTH_URL if present
    let configuredHost = '';
    if (process.env.NEXTAUTH_URL) {
        try {
            configuredHost = new URL(process.env.NEXTAUTH_URL).hostname.toLowerCase();
        } catch {
            // keep empty
        }
    }

    const rawHost = hostname?.split(':')[0]?.toLowerCase() || '';

    // If accessing via IP, localhost, dev domain (sslip.io), or the configured host itself
    const isMainHost =
        isLocalHost ||
        isIpAddress ||
        isDevDomain ||
        !rawHost ||
        rawHost === 'pazaryonetimi.com' ||
        rawHost === 'www.pazaryonetimi.com' ||
        rawHost === 'app.pazaryonetimi.com' ||
        rawHost === configuredHost ||
        rawHost === ('www.' + configuredHost) ||
        rawHost === ('app.' + configuredHost);

    // Only rewrite to /_sites if it is explicitly a tenant subdomain of pazaryonetimi.com or configuredHost
    const baseDomain = configuredHost && configuredHost !== 'localhost' ? configuredHost : 'pazaryonetimi.com';
    const isSubdomainOfBase = rawHost.endsWith('.' + baseDomain) && rawHost !== baseDomain && rawHost !== ('www.' + baseDomain) && rawHost !== ('app.' + baseDomain) && rawHost !== ('api.' + baseDomain);

    if (!isMainHost && isSubdomainOfBase) {
        const tenant = rawHost.replace('.' + baseDomain, '');
        if (tenant && tenant !== 'www' && tenant !== 'app' && tenant !== 'api' && tenant !== 'admin') {
            const searchParams = req.nextUrl.searchParams.toString();
            const path = url.pathname + (searchParams.length > 0 ? '?' + searchParams : '');
            const response = NextResponse.rewrite(
                new URL(`/_sites/${tenant}${path}`, req.url)
            );
            return addSecurityHeaders(response);
        }
    }

    // If it's the main domain/app, just let Next.js handle it
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set('x-pathname', pathname);

    const response = NextResponse.next({
        request: {
            headers: requestHeaders,
        }
    });
    return addSecurityHeaders(response);
}
