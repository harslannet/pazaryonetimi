import 'server-only';

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { isPlatformAdmin } from '@/lib/platform-admin';

export type PlatformAdminSession = {
  id: string;
  type?: string;
  tenantId?: string | null;
  email?: string | null;
};

export async function requirePlatformAdmin(): Promise<
  | { error: NextResponse; user: null; accessToken: null }
  | { error: null; user: PlatformAdminSession; accessToken: string | undefined }
> {
  const session = await auth();

  if (!session?.user?.id) {
    return {
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      user: null,
      accessToken: null,
    };
  }

  const user = session.user as PlatformAdminSession;
  const accessToken = (session.user as PlatformAdminSession & { accessToken?: string }).accessToken;

  if (!isPlatformAdmin(user)) {
    return {
      error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
      user: null,
      accessToken: null,
    };
  }

  if (!accessToken) {
    return {
      error: NextResponse.json({ error: 'Admin API oturumu doğrulanamadı' }, { status: 401 }),
      user: null,
      accessToken: null,
    };
  }

  return { error: null, user, accessToken };
}
