import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiqfomeController } from './aiqfome.controller';
import { AiqfomeService } from './aiqfome.service';
import { AiqfomeIntegrationEntity, DeliveryEntity, UserEntity } from '../database/entities';
import { DeliveryModule } from '../delivery/delivery.module';

@Module({
  imports: [TypeOrmModule.forFeature([AiqfomeIntegrationEntity, UserEntity, DeliveryEntity]), DeliveryModule],
  controllers: [AiqfomeController],
  providers: [AiqfomeService],
  exports: [AiqfomeService],
})
export class AiqfomeModule {}
