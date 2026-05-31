import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeliveryEntity, UserEntity } from '../../database/entities';
import { DeliveryModule } from '../../delivery/delivery.module';
import { AnotaAiController } from './anota-ai.controller';
import { AnotaAiService } from './anota-ai.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserEntity, DeliveryEntity]),
    DeliveryModule,
  ],
  controllers: [AnotaAiController],
  providers: [AnotaAiService],
  exports: [AnotaAiService],
})
export class AnotaAiModule {}
