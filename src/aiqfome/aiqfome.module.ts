import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeliveryEntity } from '../database/entities';
import { DeliveryModule } from '../delivery/delivery.module';
import { AiqfomeController } from './aiqfome.controller';
import { AiqfomeAuthService } from './aiqfome-auth.service';
import { AiqfomeOrderService } from './aiqfome-order.service';
import { AiqfomeLogisticService } from './aiqfome-logistic.service';
import { AiqfomeWebhookService } from './aiqfome-webhook.service';
import { AiqfomeStoreTokenEntity } from './entities/aiqfome-store-token.entity';
import { AiqfomeEventEntity } from './entities/aiqfome-event.entity';

@Module({
  imports: [
    forwardRef(() => DeliveryModule),
    TypeOrmModule.forFeature([AiqfomeStoreTokenEntity, AiqfomeEventEntity, DeliveryEntity]),
  ],
  controllers: [AiqfomeController],
  providers: [AiqfomeAuthService, AiqfomeOrderService, AiqfomeLogisticService, AiqfomeWebhookService],
  exports: [AiqfomeAuthService, AiqfomeOrderService, AiqfomeLogisticService, AiqfomeWebhookService],
})
export class AiqfomeModule {}