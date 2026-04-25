import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  IfoodCreditHistoryEntity,
  IfoodEventEntity,
  IfoodOrderLinkEntity,
  UserEntity,
} from '../database/entities';
import { DeliveryModule } from '../delivery/delivery.module';
import { IfoodAdminController } from './ifood-admin.controller';
import { IfoodWebhookController } from './ifood-webhook.controller';
import { IfoodAuthService } from './ifood-auth.service';
import { IfoodAutoPollingService } from './ifood-auto-polling.service';
import { IfoodEventService } from './ifood-event.service';
import { IfoodImportService } from './ifood-import.service';
import { IfoodCreditsService } from './ifood-credits.service';
import { IfoodOrderLinkService } from './ifood-order-link.service';
import { IfoodOrdersService } from './ifood-orders.service';
import { IfoodPollingService } from './ifood-polling.service';
import { IfoodReadinessService } from './ifood-readiness.service';
import { IfoodWebhookService } from './ifood-webhook.service';

@Module({
  imports: [
    ConfigModule,
    forwardRef(() => DeliveryModule),
    TypeOrmModule.forFeature([
      IfoodOrderLinkEntity,
      IfoodEventEntity,
      IfoodCreditHistoryEntity,
      UserEntity,
    ]),
  ],
  controllers: [IfoodAdminController, IfoodWebhookController],
  providers: [
    IfoodAuthService,
    IfoodOrdersService,
    IfoodPollingService,
    IfoodOrderLinkService,
    IfoodImportService,
    IfoodAutoPollingService,
    IfoodReadinessService,
    IfoodEventService,
    IfoodCreditsService,
    IfoodWebhookService,
  ],
  exports: [
    IfoodAuthService,
    IfoodOrdersService,
    IfoodPollingService,
    IfoodOrderLinkService,
    IfoodImportService,
    IfoodReadinessService,
    IfoodEventService,
    IfoodCreditsService,
    IfoodWebhookService,
  ],
})
export class IfoodModule {}