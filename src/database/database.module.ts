import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'path';
import { DeliveryEntity, UserEntity } from './entities';
import { CityEntity } from './entities/city.entity';
import { CitySeedService } from './seeds/city-seed.service';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        type: 'mongodb',
        url: configService.get<string>('MONGODB_URI'),
        entities: [join(__dirname, '**/*.entity{.ts,.js}')],
        useFactory: async (configService: ConfigService) => {
          const isProduction = configService.get<string>('NODE_ENV') === 'production';

          return {
            type: 'mongodb',
            url: configService.get<string>('MONGODB_URI'),
            entities: [join(__dirname, '**/*.entity{.ts,.js}')],
            synchronize: !isProduction && configService.get<string>('TYPEORM_SYNCHRONIZE') === 'true',
            useNewUrlParser: true,
            logging: !isProduction && configService.get<string>('TYPEORM_LOGGING') === 'true',
          };
        },
      }),
      inject: [ConfigService],
    }),
    TypeOrmModule.forFeature([UserEntity, DeliveryEntity, CityEntity]),
  ],
  providers: [CitySeedService],
  exports: [TypeOrmModule.forFeature([UserEntity, DeliveryEntity, CityEntity])],
})
export class DatabaseModule {}
