/**
 * Platform yönetimi yalnızca SUPERADMIN hesabına açıktır.
 */
export type PlatformAdminUser = {
  type?: string | null;
  tenantId?: string | null;
};

export function isPlatformAdmin(user: PlatformAdminUser | null | undefined): boolean {
  if (!user?.type) return false;
  return user.type === 'SUPERADMIN';
}

export function isTenantOwner(user: PlatformAdminUser | null | undefined): boolean {
  return user?.type === 'ADMIN' && !!user.tenantId;
}
