
import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../database/prisma.service';
import * as bcrypt from 'bcryptjs';

export interface JwtPayload {
  sub: string;
  email: string;
  tenantId: string;
  type: string; // SUPERADMIN | ADMIN | USER
}

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    type: string;
    tenantId: string | null;
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async login(
    email: string,
    password: string,
  ): Promise<TokenResponse> {
    const cleanEmail = email.toLowerCase().trim();

    this.logger.debug(`Login attempt for email: ${cleanEmail}`);

    const user = await this.prisma.user.findUnique({
      where: { email: cleanEmail },
      select: {
        id: true,
        email: true,
        password: true,
        firstName: true,
        lastName: true,
        type: true,
        tenantId: true,
        status: true,
      },
    });

    if (!user) {
      this.logger.warn(`Login failed: User not found for ${cleanEmail}`);
      throw new UnauthorizedException('Geçersiz e-posta veya şifre');
    }

    if (user.status !== 'active') {
      this.logger.warn(`Login blocked: Inactive user ${cleanEmail}`);
      throw new UnauthorizedException('Hesap aktif değil');
    }

    if (!user.password) {
      this.logger.warn(`Login failed: No password set for ${cleanEmail}`);
      throw new UnauthorizedException(
        'Bu hesap için şifre ayarlanmamış. OAuth ile giriş yapın.',
      );
    }

    const isPasswordValid = await bcrypt.compare(
      password,
      user.password,
    );

    if (!isPasswordValid) {
      this.logger.warn(`Login failed: Invalid password for ${cleanEmail}`);
      throw new UnauthorizedException('Geçersiz e-posta veya şifre');
    }

    const tokens = await this.generateTokens(user);

    this.logger.log(`User logged in successfully: ${user.email}`);

    return tokens;
  }

  async register(data: {
    email: string;
    password: string;
    firstName?: string;
    lastName?: string;
    company?: string;
  }): Promise<TokenResponse> {
    const cleanEmail = data.email.toLowerCase().trim();

    const existing = await this.prisma.user.findUnique({
      where: { email: cleanEmail },
    });

    if (existing) {
      throw new ConflictException('Bu e-posta adresi zaten kayıtlı');
    }

    const hashedPassword = await bcrypt.hash(data.password, 12);

    const tenantName =
      data.company ||
      `${data.firstName || cleanEmail.split('@')[0]}'in Mağazası`;

    const baseSlug = tenantName
      .toLowerCase()
      .replace(/[çÇ]/g, 'c')
      .replace(/[ğĞ]/g, 'g')
      .replace(/[ıİ]/g, 'i')
      .replace(/[öÖ]/g, 'o')
      .replace(/[şŞ]/g, 's')
      .replace(/[üÜ]/g, 'u')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 60);

    let slug = baseSlug;

    const slugExists = await this.prisma.tenant.findFirst({
      where: { slug },
    });

    if (slugExists) {
      slug = `${baseSlug}-${Date.now().toString(36)}`;
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({
          data: {
            name: tenantName,
            slug,
            plan: 'FREE',
            isOnboarded: false,
          },
        });

        const adminRole = await tx.role.create({
          data: {
            name: 'Admin',
            description: 'Mağaza Yöneticisi - Tam Yetki',
            tenantId: tenant.id,
            isSystem: true,
            permissions: {
              create: [
                {
                  action: 'manage',
                  resource: 'all',
                },
              ],
            },
          },
        });

        return tx.user.create({
          data: {
            email: cleanEmail,
            password: hashedPassword,
            firstName: data.firstName || null,
            lastName: data.lastName || null,
            tenantId: tenant.id,
            roleId: adminRole.id,
            type: 'ADMIN',
          },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            type: true,
            tenantId: true,
          },
        });
      });

      const tokens = await this.generateTokens(result);

      this.logger.log(
        `User registered with new tenant: ${result.email} (tenant: ${slug})`,
      );

      return tokens;
    } catch (error) {
      this.logger.error(
        `Registration failed for ${cleanEmail}: ${error.message}`,
        error.stack,
      );

      if (error instanceof ConflictException) {
        throw error;
      }

      throw new Error(
        `Kayıt işlemi sırasında bir hata oluştu: ${error.message}`,
      );
    }
  }

  async refreshToken(
    refreshToken: string,
  ): Promise<TokenResponse> {
    try {
      const payload = this.jwtService.verify<
        JwtPayload & { tokenType: string }
      >(refreshToken);

      if (payload.tokenType !== 'refresh') {
        throw new UnauthorizedException('Geçersiz refresh token');
      }

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          type: true,
          tenantId: true,
          status: true,
        },
      });

      if (!user) {
        throw new UnauthorizedException('Kullanıcı bulunamadı');
      }

      if (user.status !== 'active') {
        this.logger.warn(
          `Refresh token blocked: Inactive user ${user.email}`,
        );
        throw new UnauthorizedException('Hesap aktif değil');
      }

      return this.generateTokens(user);
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      throw new UnauthorizedException(
        'Geçersiz veya süresi dolmuş refresh token',
      );
    }
  }

  async validateUser(payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        type: true,
        tenantId: true,
        status: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Geçersiz token');
    }

    if (user.status !== 'active') {
      this.logger.warn(
        `Token validation blocked: Inactive user ${user.email}`,
      );
      throw new UnauthorizedException('Hesap aktif değil');
    }

    return user;
  }

  async changePassword(
    userId: string,
    oldPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        password: true,
        status: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Kullanıcı bulunamadı');
    }

    if (user.status !== 'active') {
      throw new UnauthorizedException('Hesap aktif değil');
    }

    if (!user.password) {
      throw new UnauthorizedException('Mevcut şifre bulunamadı');
    }

    const isOldPasswordValid = await bcrypt.compare(
      oldPassword,
      user.password,
    );

    if (!isOldPasswordValid) {
      throw new UnauthorizedException('Mevcut şifre yanlış');
    }

    if (newPassword.length < 8) {
      throw new UnauthorizedException(
        'Yeni şifre en az 8 karakter olmalıdır',
      );
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    this.logger.log(`Password changed for user: ${userId}`);
  }

  private async generateTokens(user: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    type: string;
    tenantId: string | null;
  }): Promise<TokenResponse> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      tenantId: user.tenantId || '',
      type: user.type,
    };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: '24h',
    });

    const refreshToken = this.jwtService.sign(
      {
        ...payload,
        tokenType: 'refresh',
      },
      {
        expiresIn: '7d',
      },
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: 86400,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        type: user.type,
        tenantId: user.tenantId,
      },
    };
  }
}
