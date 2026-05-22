import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { AiqfomeService } from './aiqfome.service';

@Controller('aiqfome')
export class AiqfomeController {
  constructor(private readonly aiqfomeService: AiqfomeService) {}

  @Get('oauth/start')
  oauthStart(@Query('storeId') storeId?: string) { return this.aiqfomeService.oauthStart(storeId); }

  @Get('oauth/callback')
  oauthCallback(@Query('code') code: string, @Query('state') storeId: string) { return this.aiqfomeService.oauthCallback(code, storeId); }

  @Post('webhook')
  webhook(@Headers('authorization') authorization: string, @Body() payload: any) { return this.aiqfomeService.handleWebhook(authorization, payload); }

  @Post('store/:storeId/register-webhooks')
  registerWebhooks(@Param('storeId') storeId: string) { return { success: true, storeId, message: 'Registro de webhook deve ser configurado no painel aiqfome/API.' }; }

  @Post('orders/:orderId/sync-status')
  syncStatus(@Param('orderId') orderId: string) { return { success: true, orderId }; }
}
