import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { UserModule } from './user/user.module';
import { AuthenticatorModule } from './authenticator/authenticator.module';
import { DeliveryModule } from './delivery/delivery.module';
import { CityModule } from './city/city.module';
import { IfoodModule } from './ifood/ifood.module';
import { AiqfomeModule } from './aiqfome/aiqfome.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    DatabaseModule,
    UserModule,
    AuthenticatorModule,
    DeliveryModule,
    CityModule,
    IfoodModule,
    AiqfomeModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
