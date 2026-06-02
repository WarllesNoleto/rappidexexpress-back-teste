import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  CityEntity,
  DeliveryEntity,
  FinancialSettlementHistoryEntity,
  UserEntity,
} from '../database/entities';
import { FinancialSettlementController } from './financial-settlement.controller';
import { FinancialSettlementService } from './financial-settlement.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DeliveryEntity,
      UserEntity,
      CityEntity,
      FinancialSettlementHistoryEntity,
    ]),
  ],
  controllers: [FinancialSettlementController],
  providers: [FinancialSettlementService],
})
export class FinancialSettlementModule {}
