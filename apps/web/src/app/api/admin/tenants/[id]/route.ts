import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/admin-auth';
import { buildApiUrlCandidates } from '@/lib/server-api-url';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

async function proxyTenantById(req: NextRequest, id: string) {
  const authResult = await requirePlatformAdmin();
  if (authResult.error) return authResult.error;

  const body =
    req.method !== 'GET' && req.method !== 'HEAD' ? await req.text() : undefined;

  for (const url of buildApiUrlCandidates(`/admin/tenants/${id}`)) {
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

export async function GET(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  return proxyTenantById(req, id);
}

export async function PUT(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  return proxyTenantById(req, id);
}

export async function DELETE(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  return proxyTenantById(req, id);
}
