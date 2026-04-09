import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IfoodEventEntity, IfoodOrderLinkEntity } from '../database/entities';
import { DeliveryModule } from '../delivery/delivery.module';
import { IfoodAdminController } from './ifood-admin.controller';
import { IfoodAuthService } from './ifood-auth.service';
import { IfoodAutoPollingService } from './ifood-auto-polling.service';
import { IfoodEventService } from './ifood-event.service';
import { IfoodImportService } from './ifood-import.service';
import { IfoodOrderLinkService } from './ifood-order-link.service';
import { IfoodOrdersService } from './ifood-orders.service';
import { IfoodPollingService } from './ifood-polling.service';
import { IfoodReadinessService } from './ifood-readiness.service';

@Module({
  imports: [
    ConfigModule,
    forwardRef(() => DeliveryModule),
    TypeOrmModule.forFeature([IfoodOrderLinkEntity, IfoodEventEntity]),
  ],
  controllers: [IfoodAdminController],
  providers: [
    IfoodAuthService,
    IfoodOrdersService,
    IfoodPollingService,
    IfoodOrderLinkService,
    IfoodImportService,
    IfoodAutoPollingService,
    IfoodReadinessService,
    IfoodEventService,
  ],
  exports: [
    IfoodAuthService,
    IfoodOrdersService,
    IfoodPollingService,
    IfoodOrderLinkService,
    IfoodImportService,
    IfoodReadinessService,
    IfoodEventService,
  ],
})
export class IfoodModule {}