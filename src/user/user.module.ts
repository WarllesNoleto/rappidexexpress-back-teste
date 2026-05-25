import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  UserEntity,
  DeliveryEntity,
  LogEntity,
  CityEntity,
} from '../database/entities';
import { IfoodModule } from '../ifood/ifood.module';

@Module({
  imports: [
    IfoodModule,
    TypeOrmModule.forFeature([UserEntity, DeliveryEntity, LogEntity, CityEntity]),
  ],
  controllers: [UserController],
  providers: [UserService],
})
export class UserModule {}
