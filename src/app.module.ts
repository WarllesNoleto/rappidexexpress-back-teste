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
import { AnotaAiModule } from './modules/anota-ai/anota-ai.module';
import { SaiposModule } from './saipos/saipos.module';

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
    AnotaAiModule,
    SaiposModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
