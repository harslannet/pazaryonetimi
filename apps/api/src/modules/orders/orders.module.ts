import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { DatabaseModule } from '../../database/database.module';
import { EInvoiceModule } from '../e-invoice/e-invoice.module';
import { RbacModule } from '../rbac/rbac.module';

@Module({
  imports: [DatabaseModule, EInvoiceModule, RbacModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
