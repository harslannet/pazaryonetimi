import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/admin-auth';
import { buildApiUrlCandidates } from '@/lib/server-api-url';

export const dynamic = 'force-dynamic';

async function proxyTenants(req: NextRequest, nestPath: string) {
  const authResult = await requirePlatformAdmin();
  if (authResult.error) return authResult.error;

  const search = req.nextUrl.search;
  const body =
    req.method !== 'GET' && req.method !== 'HEAD' ? await req.text() : undefined;

  for (const url of buildApiUrlCandidates(`/${nestPath}${search}`)) {
    try {
      const res = await fetch(url, {
        method: req.method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authResult.accessToken}`,
        },
        body,
        cache: 'no-store',
      });
      const data = await res.json().catch(() => null);
      if (res.ok) return NextResponse.json(data, { status: res.status });
      if (res.status >= 400 && res.status < 500) {
        return NextResponse.json(data ?? { error: 'İstek başarısız' }, { status: res.status });
      }
    } catch {
      // Sonraki adayı dene
    }
  }

  return NextResponse.json({ error: 'Tenant API erişilemedi' }, { status: 502 });
}

export async function GET(req: NextRequest) {
  return proxyTenants(req, 'admin/tenants');
}

export async function POST(req: NextRequest) {
  return proxyTenants(req, 'admin/tenants');
}
