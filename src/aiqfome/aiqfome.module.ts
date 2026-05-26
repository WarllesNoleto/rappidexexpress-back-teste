import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiqfomePendingAuthorizationEntity, DeliveryEntity, UserEntity } from '../database/entities';
import { DeliveryModule } from '../delivery/delivery.module';
import { AiqfomeAuthService } from './aiqfome-auth.service';
import { AiqfomeController } from './aiqfome.controller';
import { AiqfomeService } from './aiqfome.service';
import { AiqfomeWebhookService } from './aiqfome-webhook.service';
import { AiqfomeOrderMapperService } from './aiqfome-order-mapper.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserEntity, DeliveryEntity, AiqfomePendingAuthorizationEntity]),
    forwardRef(() => DeliveryModule),
  ],
  controllers: [AiqfomeController],
  providers: [
    AiqfomeService,
    AiqfomeAuthService,
    AiqfomeWebhookService,
    AiqfomeOrderMapperService,
  ],
  exports: [],
})
export class AiqfomeModule {}
