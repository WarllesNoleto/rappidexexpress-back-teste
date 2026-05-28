import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query } from '@nestjs/common';
import { AiqfomeService } from './aiqfome.service';

@Controller('aiqfome')
export class AiqfomeController {
  constructor(private readonly aiqfomeService: AiqfomeService) {}

  @Get('connect-url')
  getConnectUrl(@Query('shopkeeperId') shopkeeperId: string, @Query('storeId') storeId?: string) { return this.aiqfomeService.generateConnectUrl(shopkeeperId, storeId); }

  @Get('integrations')
  list(@Query('shopkeeperId') shopkeeperId: string) { return this.aiqfomeService.listStores(shopkeeperId); }

  @Get('callback')
  callback(@Query('code') code: string, @Query('state') state: string) { return this.aiqfomeService.handleOAuthCallback(code, state); }


  @Post('import-order')
  importOrder(@Body() body: any) { return this.aiqfomeService.importOrder(body.integrationId, body.orderId, body.storeId); }

  @Post('sync-status')
  syncStatus(@Body() body: any) { return this.aiqfomeService.syncStatus(body.deliveryId); }

  @Post('register-webhook/:integrationId')
  registerWebhook(@Param('integrationId') integrationId: string) { return this.aiqfomeService.registerWebhookById(integrationId); }

  @Get('health')
  health() { return { ok: true, at: new Date().toISOString() }; }

  @Post('webhook')
  @HttpCode(200)
  webhook(@Headers() headers: Record<string, string>, @Body() payload: any) { this.aiqfomeService.handleWebhook(headers, payload).catch((error) => { console.error('[Aiqfome] erro assíncrono no webhook', error?.message || error); }); return { success: true }; }
}
