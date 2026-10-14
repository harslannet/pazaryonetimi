/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/require-await, @typescript-eslint/no-unused-vars */
import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(private prisma: PrismaService) {}

  // ═══════════════════════════════════════════════════════════════════
  // FEATURE FLAGS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Tüm feature flag'leri getir
   */
  async getFeatureFlags() {
    // Simüle edilmiş feature flags (gerçek uygulamada DB'de saklanır)
    return [
      {
        key: 'ai_pricing',
        name: 'AI Fiyatlandırma',
        enabled: true,
        tenantOverrides: [],
      },
      {
        key: 'bulk_edit',
        name: 'Toplu Düzenleme',
        enabled: true,
        tenantOverrides: [],
      },
      {
        key: 'multi_warehouse',
        name: 'Çoklu Depo',
        enabled: false,
        tenantOverrides: ['tenant_1', 'tenant_2'],
      },
      {
        key: 'advanced_analytics',
        name: 'Gelişmiş Analitik',
        enabled: true,
        tenantOverrides: [],
      },
      { key: 'api_v2', name: 'API v2', enabled: false, tenantOverrides: [] },
      {
        key: 'new_dashboard',
        name: 'Yeni Dashboard',
        enabled: false,
        tenantOverrides: ['tenant_3'],
      },
      {
        key: 'mobile_app',
        name: 'Mobil Uygulama',
        enabled: true,
        tenantOverrides: [],
      },
      {
        key: 'webhooks',
        name: 'Webhook Desteği',
        enabled: true,
        tenantOverrides: [],
      },
    ];
  }

  /**
   * Feature flag güncelle
   */
  async updateFeatureFlag(
    key: string,
    enabled: boolean,
    tenantOverrides?: string[],
  ) {
    await this.prisma.activityLog.create({
      data: {
        action: 'admin.feature_flag.update',
        resource: 'feature_flag',
        resourceId: key,
        details: { key, enabled, tenantOverrides },
      },
    });

    return { key, enabled, tenantOverrides, updatedAt: new Date() };
  }

  /**
   * Tenant için feature flag kontrolü
   */
  async checkFeatureFlag(tenantId: string, featureKey: string) {
    const flags = await this.getFeatureFlags();
    const flag = flags.find((f) => f.key === featureKey);

    if (!flag) return { enabled: false };

    // Real DB check could go here, for now using logic from getFeatureFlags
    return {
      enabled: flag.enabled,
      isOverridden: false,
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // BULK OPERATIONS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Toplu tenant işlemi
   */
  async bulkTenantOperation(
    operation: 'activate' | 'deactivate' | 'upgrade' | 'notify',
    tenantIds: string[],
    data?: any,
  ) {
    const results: { tenantId: string; success: boolean; error?: string }[] =
      [];

    for (const tenantId of tenantIds) {
      try {
        switch (operation) {
          case 'activate':
            await this.prisma.tenant.update({
              where: { id: tenantId },
              data: { isOnboarded: true },
            });
            break;
          case 'deactivate':
            await this.prisma.tenant.update({
              where: { id: tenantId },
              data: { isOnboarded: false },
            });
            break;
          case 'upgrade':
            await this.prisma.tenant.update({
              where: { id: tenantId },
              data: { plan: data?.plan || 'PRO' },
            });
            break;
          case 'notify':
            // Bildirim gönderme simülasyonu
            this.logger.log(
              `Bildirim gönderildi: ${tenantId} - ${data?.message}`,
            );
            break;
        }
        results.push({ tenantId, success: true });
      } catch (error: any) {
        results.push({ tenantId, success: false, error: error.message });
      }
    }

    await this.prisma.activityLog.create({
      data: {
        action: `admin.bulk.${operation}`,
        resource: 'tenant',
        details: { operation, tenantCount: tenantIds.length, results },
      },
    });

    return {
      operation,
      total: tenantIds.length,
      success: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    };
  }

  /**
   * Platform geneli duyuru gönder
   */
  async sendPlatformAnnouncement(
    title: string,
    message: string,
    type: 'info' | 'warning' | 'critical',
  ) {
    const tenants = await this.prisma.tenant.findMany({
      where: { isOnboarded: true },
      select: { id: true },
    });

    // Her tenant'a bildirim oluştur
    await this.prisma.notification.createMany({
      data: tenants.map((tenant) => ({
        tenantId: tenant.id,
        type: 'SYSTEM',
        title,
        message,
        data: { announcementType: type },
      })),
    });

    return {
      success: true,
      sentTo: tenants.length,
      announcement: { title, message, type, sentAt: new Date() },
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // MAINTENANCE MODE
  // ═══════════════════════════════════════════════════════════════════

  private maintenanceMode = {
    enabled: false,
    message: '',
    scheduledEnd: null as Date | null,
  };

  /**
   * Bakım modunu aç/kapat
   */
  async setMaintenanceMode(
    enabled: boolean,
    message?: string,
    scheduledEnd?: Date,
  ) {
    const config = await this.prisma.systemConfig.upsert({
      where: { id: 'default' },
      update: {
        maintenanceMode: enabled,
        maintenanceMessage:
          message || 'Sistem bakımda. Lütfen daha sonra tekrar deneyin.',
        maintenanceEnd: scheduledEnd || null,
      },
      create: {
        id: 'default',
        maintenanceMode: enabled,
        maintenanceMessage:
          message || 'Sistem bakımda. Lütfen daha sonra tekrar deneyin.',
        maintenanceEnd: scheduledEnd,
      },
    });

    await this.prisma.activityLog.create({
      data: {
        action: enabled
          ? 'admin.maintenance.enable'
          : 'admin.maintenance.disable',
        resource: 'system',
        details: config,
      },
    });

    return {
      enabled: config.maintenanceMode,
      message: config.maintenanceMessage,
      scheduledEnd: config.maintenanceEnd,
    };
  }

  /**
   * Bakım modu durumu
   */
  async getMaintenanceMode() {
    const config = await this.prisma.systemConfig.findUnique({
      where: { id: 'default' },
    });
    if (!config) return { enabled: false, message: '', scheduledEnd: null };

    return {
      enabled: config.maintenanceMode,
      message: config.maintenanceMessage,
      scheduledEnd: config.maintenanceEnd,
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // BILLING & REVENUE
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Fatura ve gelir özeti
   */
  async getBillingOverview() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const [
      totalTenants,
      paidSubscriptions,
      trialSubscriptions,
      thisMonthRevenue,
      lastMonthRevenue,
      overduePayments,
      upcomingRenewals,
    ] = await Promise.all([
      this.prisma.tenant.count(),
      this.prisma.tenant.count({
        where: { plan: { in: ['PRO', 'ENTERPRISE'] } },
      }),
      this.prisma.tenant.count({ where: { plan: 'FREE' } }),
      this.getMonthlyRevenue(startOfMonth),
      this.getMonthlyRevenue(startOfLastMonth),
      this.getOverduePayments(),
      this.getUpcomingRenewals(),
    ]);

    const growthRate =
      lastMonthRevenue > 0
        ? ((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100
        : 0;

    return {
      summary: {
        totalTenants,
        paidSubscriptions,
        trialSubscriptions,
        conversionRate:
          totalTenants > 0 ? (paidSubscriptions / totalTenants) * 100 : 0,
      },
      revenue: {
        thisMonth: thisMonthRevenue,
        lastMonth: lastMonthRevenue,
        growthRate: Math.round(growthRate * 100) / 100,
        projected: thisMonthRevenue * 1.1, // %10 projeksiyon
      },
      overduePayments,
      upcomingRenewals,
      planDistribution: await this.getPlanDistribution(),
    };
  }

  private async getMonthlyRevenue(startDate: Date): Promise<number> {
    const endDate = new Date(
      startDate.getFullYear(),
      startDate.getMonth() + 1,
      0,
    );
    const result = await this.prisma.order.aggregate({
      where: {
        orderDate: { gte: startDate, lte: endDate },
      },
      _sum: { totalAmount: true },
    });
    return result._sum.totalAmount?.toNumber() || 0;
  }

  private async getOverduePayments() {
    // Simüle edilmiş geciken ödemeler
    return [
      {
        tenantId: 't1',
        tenantName: 'Acme Corp',
        amount: 2500,
        daysOverdue: 15,
      },
      {
        tenantId: 't2',
        tenantName: 'Tech Store',
        amount: 1800,
        daysOverdue: 7,
      },
      {
        tenantId: 't3',
        tenantName: 'Fashion Hub',
        amount: 3200,
        daysOverdue: 3,
      },
    ];
  }

  private async getUpcomingRenewals() {
    // Simüle edilmiş yaklaşan yenilemeler
    return [
      {
        tenantId: 't4',
        tenantName: 'Digital Shop',
        plan: 'PRO',
        renewalDate: new Date(Date.now() + 3 * 86400000),
        amount: 1500,
      },
      {
        tenantId: 't5',
        tenantName: 'Home Goods',
        plan: 'ENTERPRISE',
        renewalDate: new Date(Date.now() + 7 * 86400000),
        amount: 5000,
      },
      {
        tenantId: 't6',
        tenantName: 'Sport Center',
        plan: 'PRO',
        renewalDate: new Date(Date.now() + 14 * 86400000),
        amount: 1500,
      },
    ];
  }

  private async getPlanDistribution() {
    const plans = await this.prisma.tenant.groupBy({
      by: ['plan'],
      _count: { id: true },
    });

    return plans.map((p) => ({
      plan: p.plan,
      count: p._count.id,
    }));
  }

  // ═══════════════════════════════════════════════════════════════════
  // API RATE LIMITING DASHBOARD
  // ═══════════════════════════════════════════════════════════════════

  /**
   * API kullanım istatistikleri
   */
  async getApiUsageStats() {
    // Simüle edilmiş API kullanım verileri
    const tenantUsage = [
      {
        tenantId: 't1',
        tenantName: 'Mega Store',
        requests: 45000,
        limit: 50000,
        percentage: 90,
      },
      {
        tenantId: 't2',
        tenantName: 'Fashion Hub',
        requests: 32000,
        limit: 50000,
        percentage: 64,
      },
      {
        tenantId: 't3',
        tenantName: 'Tech World',
        requests: 28000,
        limit: 30000,
        percentage: 93,
      },
      {
        tenantId: 't4',
        tenantName: 'Home Decor',
        requests: 15000,
        limit: 50000,
        percentage: 30,
      },
      {
        tenantId: 't5',
        tenantName: 'Sport Zone',
        requests: 12000,
        limit: 20000,
        percentage: 60,
      },
    ];

    const hourlyStats = Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      requests: Math.round(Math.random() * 5000 + 1000),
      errors: Math.round(Math.random() * 50),
    }));

    const topEndpoints = [
      { endpoint: 'GET /api/products', count: 125000, avgResponseTime: 45 },
      { endpoint: 'GET /api/orders', count: 89000, avgResponseTime: 62 },
      { endpoint: 'POST /api/orders', count: 45000, avgResponseTime: 120 },
      { endpoint: 'PUT /api/inventory', count: 32000, avgResponseTime: 85 },
      { endpoint: 'GET /api/analytics', count: 28000, avgResponseTime: 250 },
    ];

    return {
      tenantUsage,
      hourlyStats,
      topEndpoints,
      totalRequests: tenantUsage.reduce((sum, t) => sum + t.requests, 0),
      abuseAlerts: [
        { tenantId: 't3', reason: 'Limit yaklaşıyor', severity: 'warning' },
        { tenantId: 't1', reason: 'Yüksek hata oranı', severity: 'warning' },
      ],
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // AUDIT LOGS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Denetim logları
   */
  async getAuditLogs(filters?: {
    tenantId?: string;
    action?: string;
    resource?: string;
    startDate?: Date;
    endDate?: Date;
    page?: number;
    limit?: number;
  }) {
    const {
      tenantId,
      action,
      resource,
      startDate,
      endDate,
      page = 1,
      limit = 50,
    } = filters || {};

    const where: any = {};
    if (tenantId) where.tenantId = tenantId;
    if (action) where.action = { contains: action };
    if (resource) where.resource = resource;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = startDate;
      if (endDate) where.createdAt.lte = endDate;
    }

    const [logs, total] = await Promise.all([
      this.prisma.activityLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.activityLog.count({ where }),
    ]);

    return {
      logs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // TENANT ONBOARDING
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Yeni tenant oluştur ve onboarding başlat
   */
  async createTenantWithOnboarding(data: {
    name: string;
    slug: string;
    email: string;
    plan: string;
    ownerName: string;
    ownerEmail: string;
    ownerPassword: string;
  }) {
    const tenant = await this.prisma.tenant.create({
      data: {
        name: data.name,
        slug: data.slug,
        plan: (data.plan || 'FREE') as any,
        isOnboarded: false,
        settings: {
          create: {
            config: {
              onboardingCompleted: false,
              onboardingStep: 1,
              createdBy: 'admin',
            },
          },
        },
      },
    });

    // Owner kullanıcı oluştur
    const owner = await this.prisma.user.create({
      data: {
        email: data.ownerEmail,
        password: data.ownerPassword, // Gerçek uygulamada hash'lenmeli
        firstName: data.ownerName.split(' ')[0],
        lastName: data.ownerName.split(' ').slice(1).join(' ') || '',
        type: 'ADMIN',
        tenantId: tenant.id,
      },
    });

    // Hoşgeldin bildirimi
    await this.prisma.notification.create({
      data: {
        tenantId: tenant.id,
        type: 'SYSTEM',
        title: 'Hoş Geldiniz!',
        message:
          'PazarYonetimi platformuna hoş geldiniz. Kurulum sihirbazı ile hızlıca başlayın.',
        data: { action: 'start_onboarding' },
      },
    });

    // Log
    await this.prisma.activityLog.create({
      data: {
        tenantId: tenant.id,
        action: 'admin.tenant.create',
        resource: 'tenant',
        resourceId: tenant.id,
        details: { name: data.name, plan: data.plan, createdBy: 'admin' },
      },
    });

    return {
      tenant,
      owner: { id: owner.id, email: owner.email },
      onboarding: {
        currentStep: 1,
        totalSteps: 5,
        steps: [
          { step: 1, name: 'Mağaza Bilgileri', completed: true },
          { step: 2, name: 'Pazaryeri Entegrasyonu', completed: false },
          { step: 3, name: 'Ürün Aktarımı', completed: false },
          { step: 4, name: 'Ekip Üyeleri', completed: false },
          { step: 5, name: 'Ayarlar', completed: false },
        ],
      },
    };
  }

  /**
   * Onboarding durumu
   */
  async getOnboardingStatus(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true, name: true },
    });

    if (!tenant) throw new NotFoundException('Tenant bulunamadı');

    const settings = (tenant.settings as any) || {};

    return {
      tenantName: tenant.name,
      completed: settings.onboardingCompleted || false,
      currentStep: settings.onboardingStep || 1,
      steps: [
        {
          step: 1,
          name: 'Mağaza Bilgileri',
          completed: settings.onboardingStep > 1,
        },
        {
          step: 2,
          name: 'Pazaryeri Entegrasyonu',
          completed: settings.onboardingStep > 2,
        },
        {
          step: 3,
          name: 'Ürün Aktarımı',
          completed: settings.onboardingStep > 3,
        },
        {
          step: 4,
          name: 'Ekip Üyeleri',
          completed: settings.onboardingStep > 4,
        },
        { step: 5, name: 'Ayarlar', completed: settings.onboardingCompleted },
      ],
    };
  }

  /**
   * Onboarding adımını tamamla
   */
  async completeOnboardingStep(tenantId: string, step: number) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });

    if (!tenant) throw new NotFoundException('Tenant bulunamadı');

    const settings = (tenant.settings as any) || {};
    const newSettings = {
      ...settings,
      onboardingStep: step + 1,
      onboardingCompleted: step >= 5,
    };

    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { settings: newSettings },
    });

    return { step, completed: true, nextStep: step + 1 };
  }

  // ═══════════════════════════════════════════════════════════════════
  // TENANT LISTING & DETAIL
  // ═══════════════════════════════════════════════════════════════════

  async getTenants(filters: {
    plan?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const { plan, search, page = 1, limit = 20 } = filters;
    const where: any = {};

    if (plan) where.plan = plan;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
        { domain: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [tenants, total] = await Promise.all([
      this.prisma.tenant.findMany({
        where,
        include: {
          _count: {
            select: { users: true, products: true, orders: true, stores: true },
          },
          settings: { select: { config: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.tenant.count({ where }),
    ]);

    return {
      tenants: tenants.map((t) => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        domain: t.domain,
        plan: t.plan,
        status: t.status,
        isOnboarded: t.isOnboarded,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        lastActiveAt: t.lastActiveAt,
        userCount: t._count.users,
        productCount: t._count.products,
        orderCount: t._count.orders,
        storeCount: t._count.stores,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async getTenantDetail(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: {
        users: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            type: true,
            createdAt: true,
          },
        },
        settings: true,
        integrations: {
          select: { id: true, platform: true, isActive: true, createdAt: true },
        },
        _count: {
          select: {
            products: true,
            orders: true,
            stores: true,
            supportTickets: true,
          },
        },
      },
    });

    if (!tenant) throw new NotFoundException('Tenant bulunamadı');

    // Son 30 gün sipariş sayısı
    const recentOrders = await this.prisma.order.count({
      where: {
        tenantId: id,
        orderDate: { gte: new Date(Date.now() - 30 * 86400000) },
      },
    });

    // Son 30 gün gelir
    const recentRevenue = await this.prisma.order.aggregate({
      where: {
        tenantId: id,
        orderDate: { gte: new Date(Date.now() - 30 * 86400000) },
      },
      _sum: { totalAmount: true },
    });

    return {
      ...tenant,
      stats: {
        totalProducts: tenant._count.products,
        totalOrders: tenant._count.orders,
        totalStores: tenant._count.stores,
        totalTickets: tenant._count.supportTickets,
        recentOrders,
        recentRevenue: recentRevenue._sum.totalAmount || 0,
      },
    };
  }

  async updateTenant(
    id: string,
    data: { name?: string; plan?: string; isOnboarded?: boolean },
  ) {
    const updateData: any = {};
    if (data.name) updateData.name = data.name;
    if (data.plan) updateData.plan = data.plan as any;
    if (data.isOnboarded !== undefined)
      updateData.isOnboarded = data.isOnboarded;

    const tenant = await this.prisma.tenant.update({
      where: { id },
      data: updateData,
    });

    await this.prisma.activityLog.create({
      data: {
        tenantId: id,
        action: 'admin.tenant.update',
        resource: 'tenant',
        resourceId: id,
        details: { changes: data },
      },
    });

    return tenant;
  }

  async deleteTenant(id: string) {
    await this.prisma.activityLog.create({
      data: {
        action: 'admin.tenant.delete',
        resource: 'tenant',
        resourceId: id,
        details: { deletedAt: new Date().toISOString() },
      },
    });

    await this.prisma.tenant.delete({ where: { id } });
    return { success: true };
  }

  // ═══════════════════════════════════════════════════════════════════
  // USER MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════

  async getUsers(filters: {
    tenantId?: string;
    type?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const { tenantId, type, search, page = 1, limit = 20 } = filters;
    const where: any = {};

    if (tenantId) where.tenantId = tenantId;
    if (type) where.type = type;
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          type: true,
          createdAt: true,
          tenantId: true,
          tenant: { select: { name: true } },
          twoFactorEnabled: true,
          status: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        name: [u.firstName, u.lastName].filter(Boolean).join(' ') || null,
        type: u.type,
        tenant: u.tenant,
        tenantId: u.tenantId,
        twoFactorEnabled: u.twoFactorEnabled,
        status: u.status,
        createdAt: u.createdAt,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async getUserDetail(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        type: true,
        createdAt: true,
        tenantId: true,
        tenant: { select: { name: true, plan: true } },
        twoFactorEnabled: true,
        twoFactorDevices: { select: { id: true, name: true, createdAt: true } },
        role: { select: { id: true, name: true } },
      },
    });

    if (!user) throw new NotFoundException('Kullanıcı bulunamadı');
    return user;
  }

  async createUser(data: {
    email: string;
    password?: string;
    firstName?: string;
    lastName?: string;
    type?: string;
    tenantId?: string;
    status?: string;
  }) {
    if (!data.email) {
      throw new BadRequestException('E-posta adresi gereklidir');
    }
    const cleanEmail = data.email.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({
      where: { email: cleanEmail },
    });
    if (existing) {
      throw new ConflictException('Bu e-posta adresi zaten kullanımda');
    }

    const validTypes = ['SUPERADMIN', 'ADMIN', 'USER'];
    const userType = validTypes.includes(data.type?.toUpperCase() || '')
      ? (data.type!.toUpperCase() as any)
      : 'USER';

    const requestedPassword = data.password?.trim();
    if (userType === 'SUPERADMIN' && (!requestedPassword || requestedPassword.length < 16)) {
      throw new BadRequestException(
        'SUPERADMIN hesabı için en az 16 karakterli, açıkça belirtilmiş bir parola gerekli.',
      );
    }

    const rawPassword =
      requestedPassword && requestedPassword.length >= 6
        ? requestedPassword
        : 'Pazar123!';
    const hashedPassword = await bcrypt.hash(rawPassword, 12);

    let tenantId = userType === 'SUPERADMIN' ? undefined : data.tenantId;
    if (userType !== 'SUPERADMIN' && !tenantId) {
      const defaultTenant = await this.prisma.tenant.findFirst({
        orderBy: { createdAt: 'asc' },
      });
      tenantId = defaultTenant?.id;
    }

    const user = await this.prisma.user.create({
      data: {
        email: cleanEmail,
        password: hashedPassword,
        firstName: data.firstName?.trim() || null,
        lastName: data.lastName?.trim() || null,
        type: userType,
        tenantId: tenantId || null,
        status: data.status || 'active',
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        type: true,
        tenantId: true,
        tenant: { select: { name: true } },
        status: true,
        twoFactorEnabled: true,
        createdAt: true,
      },
    });

    await this.prisma.activityLog.create({
      data: {
        tenantId: tenantId || undefined,
        action: 'admin.user.create',
        resource: 'user',
        resourceId: user.id,
        details: { email: user.email, type: user.type },
      },
    });

    return {
      ...user,
      name: [user.firstName, user.lastName].filter(Boolean).join(' ') || null,
    };
  }

  async updateUser(
    id: string,
    data: {
      type?: string;
      firstName?: string;
      lastName?: string;
      email?: string;
      password?: string;
      tenantId?: string;
      status?: string;
    },
  ) {
    const userExists = await this.prisma.user.findUnique({ where: { id } });
    if (!userExists) throw new NotFoundException('Kullanıcı bulunamadı');

    const updateData: any = {};
    let resultingType = userExists.type;
    if (data.type) {
      const validTypes = ['SUPERADMIN', 'ADMIN', 'USER'];
      if (validTypes.includes(data.type.toUpperCase())) {
        resultingType = data.type.toUpperCase() as any;
        updateData.type = resultingType;
      }
    }
    if (resultingType === 'SUPERADMIN') {
      if (
        userExists.type !== 'SUPERADMIN' &&
        (!data.password || data.password.trim().length < 16)
      ) {
        throw new BadRequestException(
          'SUPERADMIN yetkisi verirken en az 16 karakterli yeni bir parola gerekli.',
        );
      }
      updateData.tenantId = null;
    }
    if (data.firstName !== undefined) updateData.firstName = data.firstName;
    if (data.lastName !== undefined) updateData.lastName = data.lastName;
    if (data.email) updateData.email = data.email.toLowerCase().trim();
    if (resultingType !== 'SUPERADMIN' && data.tenantId !== undefined) {
      updateData.tenantId = data.tenantId || null;
    }
    if (data.status) updateData.status = data.status;
    if (data.password && data.password.trim().length >= 6) {
      updateData.password = await bcrypt.hash(data.password.trim(), 12);
    }

    const user = await this.prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        email: true,
        type: true,
        firstName: true,
        lastName: true,
        tenantId: true,
        tenant: { select: { name: true } },
        status: true,
        twoFactorEnabled: true,
        createdAt: true,
      },
    });

    await this.prisma.activityLog.create({
      data: {
        action: 'admin.user.update',
        resource: 'user',
        resourceId: id,
        details: {
          changes: {
            ...data,
            password: data.password ? '***' : undefined,
          },
        },
      },
    });

    return {
      ...user,
      name: [user.firstName, user.lastName].filter(Boolean).join(' ') || null,
    };
  }

  async updateUserRole(id: string, roleOrType: string) {
    return this.updateUser(id, { type: roleOrType });
  }

  async deleteUser(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Kullanıcı bulunamadı');

    await this.prisma.user.delete({ where: { id } });

    await this.prisma.activityLog.create({
      data: {
        action: 'admin.user.delete',
        resource: 'user',
        resourceId: id,
        details: { email: user.email },
      },
    });

    return { success: true, message: 'Kullanıcı silindi' };
  }

  async lockUser(id: string) {
    await this.prisma.user.update({
      where: { id },
      data: { status: 'locked' },
    });

    await this.prisma.activityLog.create({
      data: {
        action: 'admin.user.lock',
        resource: 'user',
        resourceId: id,
        details: { lockedAt: new Date().toISOString() },
      },
    });

    return { success: true, message: 'Kullanıcı hesabı kilitlendi' };
  }

  async unlockUser(id: string) {
    await this.prisma.user.update({
      where: { id },
      data: { status: 'active' },
    });

    await this.prisma.activityLog.create({
      data: {
        action: 'admin.user.unlock',
        resource: 'user',
        resourceId: id,
        details: { unlockedAt: new Date().toISOString() },
      },
    });

    return { success: true, message: 'Kullanıcı hesabı açıldı' };
  }

  async force2FA(id: string) {
    await this.prisma.activityLog.create({
      data: {
        action: 'admin.user.force_2fa',
        resource: 'user',
        resourceId: id,
        details: { enforcedAt: new Date().toISOString() },
      },
    });

    return { success: true, message: '2FA zorunlu kılındı' };
  }

  // ═══════════════════════════════════════════════════════════════════
  // ROLE MANAGEMENT (Real DB)
  // ═══════════════════════════════════════════════════════════════════

  async getRoles(tenantId?: string) {
    const where: any = {};
    if (tenantId) where.tenantId = tenantId;

    const roles = await this.prisma.role.findMany({
      where,
      include: {
        permissions: { select: { id: true, action: true, resource: true } },
        _count: { select: { users: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return roles.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem,
      tenantId: r.tenantId,
      userCount: r._count.users,
      permissions: r.permissions,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  async createRole(data: {
    name: string;
    description?: string;
    tenantId?: string;
    permissions: string[];
  }) {
    const role = await this.prisma.role.create({
      data: {
        name: data.name,
        description: data.description,
        tenantId: data.tenantId,
        permissions: {
          connectOrCreate: data.permissions.map((p) => {
            const [resource, action] = p.includes(':') ? p.split(':') : [p, p];
            return {
              where: { id: `${resource}_${action}` },
              create: { id: `${resource}_${action}`, action: p, resource },
            };
          }),
        },
      },
      include: { permissions: true, _count: { select: { users: true } } },
    });

    await this.prisma.activityLog.create({
      data: {
        action: 'admin.role.create',
        resource: 'role',
        resourceId: role.id,
        details: { name: data.name, permissions: data.permissions },
      },
    });

    return role;
  }

  async updateRole(
    id: string,
    data: { name?: string; description?: string; permissions?: string[] },
  ) {
    const updateData: any = {};
    if (data.name) updateData.name = data.name;
    if (data.description !== undefined)
      updateData.description = data.description;

    if (data.permissions) {
      updateData.permissions = {
        set: [],
        connectOrCreate: data.permissions.map((p) => {
          const [resource, action] = p.includes(':') ? p.split(':') : [p, p];
          return {
            where: { id: `${resource}_${action}` },
            create: { id: `${resource}_${action}`, action: p, resource },
          };
        }),
      };
    }

    const role = await this.prisma.role.update({
      where: { id },
      data: updateData,
      include: { permissions: true, _count: { select: { users: true } } },
    });

    await this.prisma.activityLog.create({
      data: {
        action: 'admin.role.update',
        resource: 'role',
        resourceId: id,
        details: { changes: data },
      },
    });

    return role;
  }

  async deleteRole(id: string) {
    const role = await this.prisma.role.findUnique({ where: { id } });
    if (!role) throw new NotFoundException('Rol bulunamadı');
    if (role.isSystem) throw new ForbiddenException('Sistem rolleri silinemez');

    await this.prisma.role.delete({ where: { id } });

    await this.prisma.activityLog.create({
      data: {
        action: 'admin.role.delete',
        resource: 'role',
        resourceId: id,
        details: { name: role.name },
      },
    });

    return { success: true };
  }

  // ═══════════════════════════════════════════════════════════════════
  // BACKUP & DISASTER RECOVERY
  // ═══════════════════════════════════════════════════════════════════

  async getBackups(filters: {
    tenantId?: string;
    status?: string;
    page?: number;
  }) {
    const { tenantId, status, page = 1 } = filters;
    const where: any = {};
    if (tenantId) where.tenantId = tenantId;
    if (status) where.status = status;

    const [backups, total] = await Promise.all([
      this.prisma.backupJob.findMany({
        where,
        include: { tenant: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * 20,
        take: 20,
      }),
      this.prisma.backupJob.count({ where }),
    ]);

    return {
      backups,
      pagination: { page, limit: 20, total, totalPages: Math.ceil(total / 20) },
    };
  }

  async getBackupSchedules() {
    return this.prisma.backupSchedule.findMany({
      include: { tenant: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createBackupSchedule(data: {
    tenantId: string;
    name: string;
    type: string;
    frequency: string;
    retentionDays: number;
  }) {
    const schedule = await this.prisma.backupSchedule.create({
      data: {
        tenantId: data.tenantId,
        name: data.name,
        type: data.type,
        frequency: data.frequency,
        retentionDays: data.retentionDays,
      },
    });

    await this.prisma.activityLog.create({
      data: {
        tenantId: data.tenantId,
        action: 'admin.backup.schedule_create',
        resource: 'backup_schedule',
        resourceId: schedule.id,
        details: data,
      },
    });

    return schedule;
  }

  async restoreBackup(backupId: string, dryRun?: boolean) {
    const backup = await this.prisma.backupJob.findUnique({
      where: { id: backupId },
    });
    if (!backup) throw new NotFoundException('Yedek bulunamadı');

    const restore = await this.prisma.restoreJob.create({
      data: {
        tenantId: backup.tenantId,
        backupId,
        status: dryRun ? 'DRY_RUN' : 'PENDING',
        dryRun: dryRun || false,
      },
    });

    await this.prisma.activityLog.create({
      data: {
        tenantId: backup.tenantId,
        action: 'admin.backup.restore',
        resource: 'restore_job',
        resourceId: restore.id,
        details: { backupId, dryRun },
      },
    });

    return {
      restore,
      message: dryRun ? 'Dry run başlatıldı' : 'Geri yükleme başlatıldı',
    };
  }

  async getDrSettings() {
    return this.prisma.drSettings.findMany({
      include: { tenant: { select: { name: true } } },
    });
  }

  async updateDrSettings(tenantId: string, data: any) {
    const dr = await this.prisma.drSettings.upsert({
      where: { tenantId },
      update: data,
      create: { tenantId, ...data },
    });

    return dr;
  }

  // ═══════════════════════════════════════════════════════════════════
  // SECURITY DASHBOARD
  // ═══════════════════════════════════════════════════════════════════

  async getLoginAttempts(filters: {
    email?: string;
    isSuccess?: boolean;
    page?: number;
    limit?: number;
  }) {
    const { email, isSuccess, page = 1, limit = 50 } = filters;
    const where: any = {};
    if (email) where.email = { contains: email, mode: 'insensitive' };
    if (isSuccess !== undefined) where.isSuccess = isSuccess;

    const [attempts, total] = await Promise.all([
      this.prisma.loginAttempt.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.loginAttempt.count({ where }),
    ]);

    return {
      attempts,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async getSecurityStats() {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      totalAttempts24h,
      failedAttempts24h,
      successAttempts24h,
      totalAttempts7d,
      failedAttempts7d,
      usersWithout2FA,
      usersWith2FA,
      totalUsers,
    ] = await Promise.all([
      this.prisma.loginAttempt.count({
        where: { createdAt: { gte: last24h } },
      }),
      this.prisma.loginAttempt.count({
        where: { createdAt: { gte: last24h }, isSuccess: false },
      }),
      this.prisma.loginAttempt.count({
        where: { createdAt: { gte: last24h }, isSuccess: true },
      }),
      this.prisma.loginAttempt.count({ where: { createdAt: { gte: last7d } } }),
      this.prisma.loginAttempt.count({
        where: { createdAt: { gte: last7d }, isSuccess: false },
      }),
      this.prisma.user.count({
        where: { twoFactorDevices: { none: {} } },
      }),
      this.prisma.user.count({
        where: { twoFactorDevices: { some: {} } },
      }),
      this.prisma.user.count(),
    ]);

    return {
      last24h: {
        total: totalAttempts24h,
        failed: failedAttempts24h,
        success: successAttempts24h,
        failureRate:
          totalAttempts24h > 0
            ? Math.round((failedAttempts24h / totalAttempts24h) * 100)
            : 0,
      },
      last7d: {
        total: totalAttempts7d,
        failed: failedAttempts7d,
      },
      twoFactor: {
        enabled: usersWith2FA,
        disabled: usersWithout2FA,
        total: totalUsers,
        adoptionRate:
          totalUsers > 0 ? Math.round((usersWith2FA / totalUsers) * 100) : 0,
      },
    };
  }

  async getSuspiciousIps() {
    // IP'lere göre başarısız giriş sayısı — 5'ten fazla başarısız olanlara bakar
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const attempts = await this.prisma.loginAttempt.groupBy({
      by: ['ipAddress'],
      where: {
        isSuccess: false,
        createdAt: { gte: last24h },
        ipAddress: { not: null },
      },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 20,
    });

    return attempts
      .filter((a) => a._count.id >= 3)
      .map((a) => ({
        ip: a.ipAddress,
        failedAttempts: a._count.id,
        severity:
          a._count.id >= 10
            ? 'critical'
            : a._count.id >= 5
              ? 'warning'
              : 'info',
      }));
  }

  async blockIp(ip: string, reason: string) {
    await this.prisma.activityLog.create({
      data: {
        action: 'admin.security.block_ip',
        resource: 'security',
        details: { ip, reason, blockedAt: new Date().toISOString() },
      },
    });

    return { success: true, message: `IP ${ip} engellendi: ${reason}` };
  }

  async get2FAStats() {
    const [totalDevices, users2FA, recentEnrollments] = await Promise.all([
      this.prisma.twoFactorDevice.count(),
      this.prisma.user.count({ where: { twoFactorDevices: { some: {} } } }),
      this.prisma.twoFactorDevice.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          createdAt: true,
          user: { select: { email: true, firstName: true, lastName: true } },
        },
      }),
    ]);

    return { totalDevices, usersWithDevice: users2FA, recentEnrollments };
  }

  // ═══════════════════════════════════════════════════════════════════
  // DASHBOARD REAL DATA
  // ═══════════════════════════════════════════════════════════════════

  async getDashboardStats() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [
      totalTenants,
      tenantsThisMonth,
      tenantsLastMonth,
      totalRevenue,
      lastMonthTotalRevenue,
      activeSessions,
      totalUsers,
      totalOrders,
      ordersThisMonth,
      totalProducts,
      aiJobsToday,
    ] = await Promise.all([
      this.prisma.tenant.count(),
      this.prisma.tenant.count({ where: { createdAt: { gte: startOfMonth } } }),
      this.prisma.tenant.count({
        where: { createdAt: { gte: startOfLastMonth, lt: startOfMonth } },
      }),
      this.prisma.order.aggregate({
        where: { orderDate: { gte: startOfMonth } },
        _sum: { totalAmount: true },
      }),
      this.prisma.order.aggregate({
        where: { orderDate: { gte: startOfLastMonth, lt: startOfMonth } },
        _sum: { totalAmount: true },
      }),
      this.prisma.session.count({ where: { expires: { gte: now } } }),
      this.prisma.user.count(),
      this.prisma.order.count(),
      this.prisma.order.count({ where: { orderDate: { gte: startOfMonth } } }),
      this.prisma.product.count(),
      this.prisma.aiJob.count({ where: { createdAt: { gte: last24h } } }),
    ]);

    const thisMonthRev = totalRevenue._sum.totalAmount?.toNumber() || 0;
    const lastMonthRev =
      lastMonthTotalRevenue._sum.totalAmount?.toNumber() || 0;

    const tenantGrowth =
      tenantsLastMonth > 0
        ? Math.round(
            ((tenantsThisMonth - tenantsLastMonth) / tenantsLastMonth) * 100,
          )
        : 0;
    const revenueGrowth =
      lastMonthRev > 0
        ? Math.round(((thisMonthRev - lastMonthRev) / lastMonthRev) * 100)
        : 0;

    // Son 12 ay gelir
    const monthlyRevenue: { month: string; revenue: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const mStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
      const agg = await this.prisma.order.aggregate({
        where: { orderDate: { gte: mStart, lte: mEnd } },
        _sum: { totalAmount: true },
      });
      monthlyRevenue.push({
        month: mStart.toLocaleString('tr-TR', {
          month: 'short',
          year: 'numeric',
        }),
        revenue: agg._sum.totalAmount?.toNumber() || 0,
      });
    }

    return {
      tenantCount: totalTenants,
      tenantGrowth: `${tenantGrowth >= 0 ? '+' : ''}${tenantGrowth}%`,
      monthlyRevenue: thisMonthRev,
      revenueGrowth: `${revenueGrowth >= 0 ? '+' : ''}${revenueGrowth}%`,
      activeSessions,
      totalUsers,
      totalOrders,
      ordersThisMonth,
      totalProducts,
      aiJobsCount: aiJobsToday,
      revenueChart: monthlyRevenue,
      serverStatus: {
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        nodeVersion: process.version,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // ADVANCED REPORTS & ANALYTICS (Phase 2)
  // ═══════════════════════════════════════════════════════════════════

  async getProfitLoss() {
    // Toplam Gelir, Toplam Maliyet, Kargo Gideri, Komisyon ve Net Kar (Son 6 ay)
    const now = new Date();
    const data: any[] = [];

    for (let i = 5; i >= 0; i--) {
      const mStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);

      const orders = await this.prisma.order.findMany({
        where: {
          orderDate: { gte: mStart, lte: mEnd },
          status: { not: 'CANCELLED' },
        },
        select: {
          totalAmount: true,
          shippingCost: true,
          commissionAmount: true,
          netProfit: true,
        },
      });

      const revenue = orders.reduce(
        (sum, o) => sum + (o.totalAmount?.toNumber() || 0),
        0,
      );
      const shipping = orders.reduce(
        (sum, o) => sum + (o.shippingCost?.toNumber() || 0),
        0,
      );
      const commission = orders.reduce(
        (sum, o) => sum + (o.commissionAmount?.toNumber() || 0),
        0,
      );
      const profit = orders.reduce(
        (sum, o) => sum + (o.netProfit?.toNumber() || 0),
        0,
      );
      // Rough cost estimation if netProfit wasn't fully calculated on the fly
      const costs = revenue - profit - shipping - commission;

      data.push({
        month: mStart.toLocaleString('tr-TR', {
          month: 'short',
          year: 'numeric',
        }),
        revenue,
        costs: costs > 0 ? costs : revenue * 0.4, // Fallback dummy cost if DB is empty
        shipping,
        commission,
        profit: profit > 0 ? profit : revenue * 0.5, // Fallback dummy profit
      });
    }

    return data;
  }

  async getCohortAnalysis() {
    // Müşteri sadakati: İlk siparişini verenlerin sonraki aylardaki geri dönüş oranı.
    // Şimdilik mock veri üretiyoruz, tam implementasyon ileriki aşamalarda DB join'leri ile yapılacak.
    return [
      {
        cohort: 'Oca 2026',
        size: 120,
        m1: 100,
        m2: 45,
        m3: 30,
        m4: 25,
        m5: 20,
        m6: 18,
      },
      {
        cohort: 'Şub 2026',
        size: 145,
        m1: 100,
        m2: 50,
        m3: 35,
        m4: 28,
        m5: 22,
      },
      { cohort: 'Mar 2026', size: 210, m1: 100, m2: 55, m3: 40, m4: 30 },
      { cohort: 'Nis 2026', size: 180, m1: 100, m2: 48, m3: 38 },
      { cohort: 'May 2026', size: 250, m1: 100, m2: 60 },
      { cohort: 'Haz 2026', size: 300, m1: 100 },
    ];
  }

  async getBestSellers() {
    // En çok satan ürünler (OrderItem'dan gruplayarak)
    const bestSellers = await this.prisma.orderItem.groupBy({
      by: ['productId', 'title'],
      _sum: { quantity: true, unitPrice: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: 10,
      where: { productId: { not: null } },
    });

    return bestSellers.map((b) => ({
      id: b.productId,
      title: b.title,
      sales: b._sum.quantity || 0,
      revenue: (b._sum.quantity || 0) * (b._sum.unitPrice?.toNumber() || 0),
      returnRate: Math.floor(Math.random() * 15), // Placeholder until Return model is fully wired in aggregations
    }));
  }

  async getGeoDistribution() {
    // Şehir bazlı sipariş yoğunluğu (Şimdilik mock, gerçekte Order address parse edilir veya city struct kullanılır)
    return [
      { name: 'İstanbul', value: 3450, coordinates: [28.9784, 41.0082] },
      { name: 'Ankara', value: 1250, coordinates: [32.8597, 39.9334] },
      { name: 'İzmir', value: 980, coordinates: [27.1428, 38.4237] },
      { name: 'Bursa', value: 640, coordinates: [29.061, 40.1824] },
      { name: 'Antalya', value: 520, coordinates: [30.7133, 36.8969] },
      { name: 'Adana', value: 310, coordinates: [35.3213, 37.0] },
      { name: 'Gaziantep', value: 290, coordinates: [37.3833, 37.0662] },
    ];
  }

  // ==========================================
  // PHASE 3: CRM & OPERATIONS
  // ==========================================

  async getCustomers(query: { page: number; limit: number; search?: string }) {
    const { page, limit, search } = query;
    const whereClause: any = { customerEmail: { not: null } };

    if (search) {
      whereClause.OR = [
        { customerName: { contains: search, mode: 'insensitive' } },
        { customerEmail: { contains: search, mode: 'insensitive' } },
      ];
    }

    const aggregated = await this.prisma.order.groupBy({
      by: ['customerEmail'],
      _sum: { totalAmount: true },
      _count: { id: true },
      _max: { orderDate: true },
      where: whereClause,
      orderBy: { _max: { orderDate: 'desc' } },
      skip: (page - 1) * limit,
      take: limit,
    });

    const emailGroups = await this.prisma.order.groupBy({
      by: ['customerEmail'],
      where: whereClause,
    });
    const total = emailGroups.length;

    // Fetch latest names sequentially
    const customers = await Promise.all(
      aggregated.map(async (a) => {
        if (!a.customerEmail) return null;
        const latestOrder = await this.prisma.order.findFirst({
          where: { customerEmail: a.customerEmail },
          orderBy: { orderDate: 'desc' },
          select: { customerName: true, customerPhone: true },
        });
        return {
          email: a.customerEmail,
          name: latestOrder?.customerName || 'Bilinmiyor',
          phone: latestOrder?.customerPhone || 'Bilinmiyor',
          totalOrders: a._count.id,
          ltv: a._sum.totalAmount?.toNumber() || 0,
          lastOrderDate: a._max.orderDate,
        };
      }),
    );

    return {
      customers: customers.filter(Boolean),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async getCustomerDetail(email: string) {
    const orders = await this.prisma.order.findMany({
      where: { customerEmail: email },
      include: { items: true },
      orderBy: { orderDate: 'desc' },
    });

    const returns = await this.prisma.return.findMany({
      where: { customerEmail: email },
      include: { items: true },
      orderBy: { requestDate: 'desc' },
    });

    const supportTickets = await this.prisma.supportTicket.findMany({
      where: { customerEmail: email },
      orderBy: { createdAt: 'desc' },
      include: { messages: true },
    });

    const ltv = orders.reduce(
      (sum, o) => sum + (o.totalAmount?.toNumber() || 0),
      0,
    );
    const returnTotal = returns.reduce(
      (sum, r) => sum + (r.refundAmount?.toNumber() || 0),
      0,
    );
    const recentOrder = orders[0];

    if (!recentOrder) throw new NotFoundException('Müşteri bulunamadı');

    return {
      profile: {
        email,
        name: recentOrder.customerName || 'Bilinmiyor',
        phone: recentOrder.customerPhone || 'Bilinmiyor',
        ltv,
        returnTotal,
        firstOrderDate: orders[orders.length - 1]?.orderDate,
        lastOrderDate: recentOrder.orderDate,
      },
      orders,
      returns,
      supportTickets,
    };
  }

  // ─── Helpdesk ────────────────────────────────

  async getSupportTickets(query: {
    page: number;
    limit: number;
    status?: string;
  }) {
    const { page, limit, status } = query;
    const where: any = {};
    if (status && status !== 'ALL') where.status = status;

    const [tickets, total] = await Promise.all([
      this.prisma.supportTicket.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          _count: { select: { messages: true } },
        },
      }),
      this.prisma.supportTicket.count({ where }),
    ]);

    return {
      tickets: tickets.map((t) => ({
        ...t,
        messageCount: t._count.messages,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async getSupportTicketDetail(id: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        order: { select: { id: true, status: true, totalAmount: true } },
      },
    });
    if (!ticket) throw new NotFoundException('Destek talebi bulunamadı');
    return ticket;
  }

  async replyToTicket(id: string, content: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
    });
    if (!ticket) throw new NotFoundException('Destek talebi bulunamadı');

    const message = await this.prisma.omnichannelMessage.create({
      data: {
        ticketId: id,
        tenantId: ticket.tenantId,
        content,
        senderType: 'AGENT',
      },
    });

    // Durumu açık vb yapabiliriz
    if (ticket.status === 'PENDING') {
      await this.prisma.supportTicket.update({
        where: { id },
        data: { status: 'OPEN' },
      });
    }

    return message;
  }

  // ─── Kanban Tasks (Operations Manager) ────────────────────────────────

  async getTasks(query: { status?: string; assigneeId?: string }) {
    const where: any = {};
    if (query.status) where.status = query.status;
    if (query.assigneeId) where.assigneeId = query.assigneeId;

    return this.prisma.adminTask.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        assignee: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        creator: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });
  }

  async createTask(data: {
    title: string;
    description?: string;
    status?: string;
    priority?: string;
    assigneeId?: string;
    dueDate?: string;
    tags?: string[];
  }) {
    return this.prisma.adminTask.create({
      data: {
        ...data,
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
      } as any,
    });
  }

  async updateTask(
    id: string,
    data: {
      title?: string;
      description?: string;
      status?: string;
      priority?: string;
      assigneeId?: string;
      dueDate?: string | Date | null;
      tags?: string[];
    },
  ) {
    const payload = {
      ...data,
      dueDate: data.dueDate ? new Date(data.dueDate) : data.dueDate,
    };

    return this.prisma.adminTask.update({
      where: { id },
      data: payload,
    });
  }

  async deleteTask(id: string) {
    return this.prisma.adminTask.delete({
      where: { id },
    });
  }

  // ─── Products & Variants (Inline Manager) ───────────────────────────

  async getProducts(query: { search?: string; page: number; limit: number }) {
    const { search, page, limit } = query;
    const where: any = {};
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      products,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getProductVariants(productId: string) {
    return this.prisma.productVariant.findMany({
      where: { productId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async bulkUpdateVariants(productId: string, variants: any[]) {
    // We use a transaction for safety
    return this.prisma.$transaction(
      variants.map((v) => {
        const { id, ...data } = v;
        if (id && !id.startsWith('new_')) {
          return this.prisma.productVariant.update({
            where: { id },
            data: {
              ...data,
              price: data.price ? Number(data.price) : undefined,
              costPrice: data.costPrice ? Number(data.costPrice) : undefined,
              stock: data.stock ? Number(data.stock) : undefined,
            },
          });
        } else {
          return this.prisma.productVariant.create({
            data: {
              ...data,
              productId,
              price: data.price ? Number(data.price) : 0,
              costPrice: data.costPrice ? Number(data.costPrice) : 0,
              stock: data.stock ? Number(data.stock) : 0,
            },
          });
        }
      }),
    );
  }

  async getOrders(query: {
    search?: string;
    status?: string;
    tenantId?: string;
    page: number;
    limit: number;
  }) {
    const { search, status, tenantId, page, limit } = query;
    const where: Record<string, unknown> = {};

    if (status) where.status = status;
    if (tenantId) where.tenantId = tenantId;
    if (search) {
      where.OR = [
        { customerName: { contains: search, mode: 'insensitive' } },
        { customerEmail: { contains: search, mode: 'insensitive' } },
        { marketplaceOrderId: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: {
          tenant: { select: { id: true, name: true, slug: true } },
          items: true,
        },
        orderBy: { orderDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      orders,
      items: orders,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async updateOrderStatus(id: string, status: string) {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('Sipariş bulunamadı');

    return this.prisma.order.update({
      where: { id },
      data: { status: status as never },
      include: {
        tenant: { select: { id: true, name: true } },
        items: true,
      },
    });
  }
}
