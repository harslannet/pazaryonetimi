import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { fetchFromApi } from '@/lib/server-api-url';

export type VerifiedAuthUser = {
  id: string;
  email: string;
  name: string;
  type: string;
  tenantId: string | null;
  isOnboarded: boolean;
  image: string | null;
  accessToken?: string;
};

export async function verifyCredentials(
  email: string,
  password: string,
): Promise<VerifiedAuthUser | null> {
  const cleanEmail = email.toLowerCase().trim();
  if (!cleanEmail || !password) return null;

  const user = await prisma.user.findUnique({
    where: { email: cleanEmail },
    include: { tenant: true },
  });

  if (!user?.password) return null;
  if (user.status !== 'active') return null;

  const isValid = await bcrypt.compare(password, user.password);
  if (!isValid) return null;

  let accessToken: string | undefined;
  const apiLogin = await fetchFromApi<{ accessToken?: string }>('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: cleanEmail, password }),
  });
  if (apiLogin.ok && apiLogin.data?.accessToken) {
    accessToken = apiLogin.data.accessToken;
  }

  return {
    id: user.id,
    email: user.email,
    name:
      [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email,
    type: user.type,
    tenantId: user.tenantId,
    isOnboarded: user.tenant?.isOnboarded ?? false,
    image: user.image,
    accessToken,
  };
}
