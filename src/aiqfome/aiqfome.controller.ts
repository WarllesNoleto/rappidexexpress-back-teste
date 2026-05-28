import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query } from '@nestjs/common';
import { AiqfomeService } from './aiqfome.service';

@Controller('api/aiqfome')
export class AiqfomeController {
  constructor(private readonly aiqfomeService: AiqfomeService) {}

  @Get('connect-url')
  getConnectUrl(@Query('shopkeeperId') shopkeeperId: string) { return this.aiqfomeService.generateConnectUrl(shopkeeperId); }

  @Get('callback')
  callback(@Query('code') code: string, @Query('shopkeeperId') shopkeeperId: string) { return this.aiqfomeService.handleOAuthCallback(code, shopkeeperId); }

  @Post('token/refresh/:integrationId')
  refresh(@Param('integrationId') integrationId: string) { return this.aiqfomeService.refreshToken(integrationId); }

  @Get('stores')
  list(@Query('shopkeeperId') shopkeeperId: string) { return this.aiqfomeService.listStores(shopkeeperId); }

  @Post('bind-store')
  bind(@Body() body: any) { return this.aiqfomeService.bindStore(body); }

  @Post('fetch-order')
  fetchOrder(@Body() body: any) { return this.aiqfomeService.fetchOrderDetails(body.integrationId, body.orderId); }

  @Post('import-order')
  importOrder(@Body() body: any) { return this.aiqfomeService.importOrder(body.integrationId, body.orderId); }

  @Post('sync-status')
  syncStatus(@Body() body: any) { return this.aiqfomeService.syncStatus(body.deliveryId, body.status); }

  @Post('webhook')
  @HttpCode(200)
  webhook(@Headers() headers: Record<string, string>, @Body() payload: any) {
    void this.aiqfomeService.handleWebhook(headers, payload);
    return { success: true };
  }
}
