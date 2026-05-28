import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiqfomeController } from './aiqfome.controller';
import { AiqfomeService } from './aiqfome.service';
import {
  AiqfomeIntegrationEntity,
  AiqfomeOrderLinkEntity,
  AiqfomePendingAuthorizationEntity,
  DeliveryEntity,
  UserEntity,
} from '../database/entities';
import { DeliveryModule } from '../delivery/delivery.module';
import { AiqfomeOrderLinkService } from './aiqfome-order-link.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AiqfomeIntegrationEntity,
      AiqfomeOrderLinkEntity,
      AiqfomePendingAuthorizationEntity,
      UserEntity,
      DeliveryEntity,
    ]),
    forwardRef(() => DeliveryModule),
  ],
  controllers: [AiqfomeController],
  providers: [AiqfomeService, AiqfomeOrderLinkService],
  exports: [AiqfomeService],
})
export class AiqfomeModule {}
