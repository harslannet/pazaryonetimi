/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../database/prisma.service';

type AdminRequest = Request & {
  user?: { id?: string };
  adminUser?: {
    id: string;
    email: string | null;
    type: string;
    firstName: string | null;
    lastName: string | null;
  };
};

/**
 * Admin Auth Guard
 * Admin endpoint'lerine yalnızca aktif SUPERADMIN kullanıcılarının erişmesini sağlar.
 *
 * Kullanım:
 *   @UseGuards(AdminGuard)
 *   @Controller('admin')
 *   export class AdminController {}
 *
 * Kimlik, global JWT/Passport guard tarafından doğrulanan request.user'dan alınır.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminRequest>();

    // Never trust identity supplied through headers or request bodies.
    const adminId = request.user?.id;
    if (!adminId) {
      throw new UnauthorizedException(
        'Geçerli bir access token gerekli.',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: adminId },
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

    if (!user) {
      throw new UnauthorizedException('Geçersiz admin kullanıcısı');
    }

    if (user.status !== 'active' || user.type !== 'SUPERADMIN') {
      throw new ForbiddenException(
        'Bu işlem için aktif SUPERADMIN yetkisi gerekli.',
      );
    }

    // Request'e admin bilgisini ekle
    request.adminUser = user;
    return true;
  }
}
