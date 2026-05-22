import { Body, Controller, Get, Headers, Param, Post, Query, Res } from '@nestjs/common';
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
  webhook(@Headers('authorization') authorization: string, @Body() payload: any) { return this.aiqfomeService.handleWebhook(authorization, payload); }

  @Post('store/:storeId/register-webhooks')
  registerWebhooks(@Param('storeId') storeId: string) { return { success: true, storeId, message: 'Registro de webhook deve ser configurado no painel aiqfome/API.' }; }

  @Post('orders/:orderId/sync-status')
  syncStatus(@Param('orderId') orderId: string) { return { success: true, orderId }; }
}
