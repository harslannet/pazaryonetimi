import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/admin-auth';
import { buildApiUrlCandidates } from '@/lib/server-api-url';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ path: string[] }> };

async function proxyToNest(req: NextRequest, context: RouteContext) {
  const authResult = await requirePlatformAdmin();
  if (authResult.error) return authResult.error;

  const { path } = await context.params;
  const nestPath = path.join('/');
  const search = req.nextUrl.search;
  const body =
    req.method !== 'GET' && req.method !== 'HEAD'
      ? await req.text()
      : undefined;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${authResult.accessToken}`,
  };

  let lastStatus = 502;
  let lastBody: unknown = { error: 'API erişilemedi' };

  for (const url of buildApiUrlCandidates(`/${nestPath}${search}`)) {
    try {
      const res = await fetch(url, {
        method: req.method,
        headers,
        body,
        cache: 'no-store',
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        return NextResponse.json(data, { status: res.status });
      }
      lastStatus = res.status;
      lastBody = data ?? { error: `HTTP ${res.status}` };
      if (res.status >= 400 && res.status < 500 && res.status !== 404) break;
    } catch {
      // Sonraki adayı dene
    }
  }

  return NextResponse.json(lastBody, { status: lastStatus });
}

export async function GET(req: NextRequest, context: RouteContext) {
  return proxyToNest(req, context);
}

export async function POST(req: NextRequest, context: RouteContext) {
  return proxyToNest(req, context);
}

export async function PUT(req: NextRequest, context: RouteContext) {
  return proxyToNest(req, context);
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  return proxyToNest(req, context);
}

export async function DELETE(req: NextRequest, context: RouteContext) {
  return proxyToNest(req, context);
}
