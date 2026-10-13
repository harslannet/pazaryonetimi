import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SchedulerService } from './scheduler.service';
import { SchedulerController } from './scheduler.controller';
import { ReportJobProcessor } from './processors/report-job.processor';
import { SyncJobProcessor } from './processors/sync-job.processor';
import { EmailJobProcessor } from './processors/email-job.processor';
import { DatabaseModule } from '../../database/database.module';
import { MarketIntelligenceModule } from '../market-intelligence/market-intelligence.module';
import { MarketplaceModule } from '../marketplace/marketplace.module';
import { CompetitorAnalysisService } from '../marketplace/competitor-analysis.service';
import { EncryptionModule } from '../../common/encryption.module';
import { ScrapingModule } from '../scraping/scraping.module';

@Module({
  imports: [
    DatabaseModule,
    EncryptionModule,
    MarketIntelligenceModule,
    MarketplaceModule,
    ScrapingModule,
    BullModule.registerQueue(
      { name: 'reports' },
      { name: 'sync' },
      { name: 'emails' },
      { name: 'scheduled-tasks' },
    ),
  ],
  controllers: [SchedulerController],
  providers: [
    SchedulerService,
    ReportJobProcessor,
    SyncJobProcessor,
    EmailJobProcessor,
    CompetitorAnalysisService,
  ],
  exports: [SchedulerService],
})
export class SchedulerModule {}
