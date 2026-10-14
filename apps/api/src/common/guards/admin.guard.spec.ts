import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { AdminGuard } from './admin.guard';

describe('AdminGuard', () => {
  let findUnique: jest.Mock;
  let guard: AdminGuard;

  function contextFor(request: Record<string, any>): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    findUnique = jest.fn();
    guard = new AdminGuard({ user: { findUnique } } as any);
  });

  it('does not accept identity from headers or request bodies', async () => {
    const request = {
      headers: { 'x-admin-id': 'known-user-id' },
      body: { adminUserId: 'known-user-id' },
    };

    await expect(guard.canActivate(contextFor(request))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('rejects tenant admins', async () => {
    findUnique.mockResolvedValue({ id: 'admin-id', type: 'ADMIN', status: 'active' });
    const request = { user: { id: 'admin-id' } };

    await expect(guard.canActivate(contextFor(request))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects inactive superadmins', async () => {
    findUnique.mockResolvedValue({ id: 'admin-id', type: 'SUPERADMIN', status: 'inactive' });
    const request = { user: { id: 'admin-id' } };

    await expect(guard.canActivate(contextFor(request))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('allows an active superadmin from the verified request identity', async () => {
    const user = {
      id: 'admin-id',
      email: 'admin@example.com',
      type: 'SUPERADMIN',
      tenantId: null,
      status: 'active',
      firstName: 'Platform',
      lastName: 'Admin',
    };
    findUnique.mockResolvedValue(user);
    const request: Record<string, any> = { user: { id: user.id } };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.adminUser).toEqual(user);
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: user.id },
      select: {
        id: true,
        email: true,
        type: true,
        tenantId: true,
        status: true,
        firstName: true,
        lastName: true,
      },
    });
  });
});
