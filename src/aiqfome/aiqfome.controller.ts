import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import { AiqfomeService } from './aiqfome.service';
import { Response } from 'express';

@Controller('aiqfome')
export class AiqfomeController {
  constructor(private readonly aiqfomeService: AiqfomeService) {}

  @Get('oauth/start')
  oauthStart(@Res() res: Response, @Query('storeId') storeId?: string) {
    const authUrl = this.aiqfomeService.oauthStart(storeId);
    return res.redirect(authUrl);
  }

  @Get('oauth/callback')
  oauthCallback(@Query() query: { code?: string; state?: string }) {
    const { code, state } = query;
    return this.aiqfomeService.oauthCallback(code, state);
  }

  @Post('webhook')
  @HttpCode(200)
  webhook(@Headers() headers: Record<string, string | string[] | undefined>, @Body() payload: any) { return this.aiqfomeService.handleWebhook(headers, payload); }

  @Post('store/:storeId/register-webhooks')
  registerWebhooks(@Param('storeId') storeId: string) {
    const callbackUrl = String(process.env.AIQFOME_WEBHOOK_URL || '').trim();
    const events = ['new-order', 'read-order', 'ready-order', 'cancel-order', 'order-refund', 'order-logistic'];
    if (!callbackUrl) return { success: false, message: 'Defina AIQFOME_WEBHOOK_URL com /api/aiqfome/webhook' };
    return this.aiqfomeService.registerV2Webhooks(storeId, callbackUrl, events);
  }

  @Post('orders/:orderId/sync-status')
  syncStatus(@Param('orderId') orderId: string) { return { success: true, orderId }; }
}
