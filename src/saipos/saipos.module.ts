import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeliveryEntity, UserEntity } from '../database/entities';
import { DeliveryModule } from '../delivery/delivery.module';
import { SaiposController } from './saipos.controller';
import { SaiposService } from './saipos.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserEntity, DeliveryEntity]),
    DeliveryModule,
  ],
  controllers: [SaiposController],
  providers: [SaiposService],
  exports: [SaiposService],
})
export class SaiposModule {}
