import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { AiqfomeService } from './aiqfome.service';
import { AiqfomeWebhookService } from './aiqfome-webhook.service';
import { Response } from 'express';

@Controller('aiqfome')
export class AiqfomeController {
  constructor(
    private readonly aiqfomeService: AiqfomeService,
    private readonly webhookService: AiqfomeWebhookService,
  ) {}

  @Get('oauth/start/:companyId')
  async oauthStart(@Res() res: Response, @Param('companyId') companyId: string) {
    const authUrl = await this.aiqfomeService.oauthStart(companyId);
    return res.redirect(authUrl);
  }

  @Get('oauth/callback')
  oauthCallback(@Query() query: { code?: string; state?: string }) {
    const { code, state } = query;
    return this.aiqfomeService.oauthCallback(code, state);
  }

  @Post('webhook')
  @HttpCode(200)
  webhook(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() payload: any,
  ) {
    return this.webhookService.processWebhook(headers, payload);
  }

  @Get('status/:companyId')
  status(@Param('companyId') companyId: string) {
    return this.aiqfomeService.getStatus(companyId);
  }

  @Post('test-connection/:companyId')
  testConnection(@Param('companyId') companyId: string) {
    return this.aiqfomeService.testConnection(companyId);
  }

  @Post('register-webhook/:companyId')
  registerWebhook(@Param('companyId') companyId: string) {
    return this.aiqfomeService.registerWebhook(companyId);
  }

  @Put('config/:companyId')
  updateConfig(@Param('companyId') companyId: string, @Body() body: any) {
    return this.aiqfomeService.updateConfig(companyId, body);
  }

  @Post('sync-order/:companyId/:orderId')
  syncOrder(
    @Param('companyId') companyId: string,
    @Param('orderId') orderId: string,
  ) {
    return this.aiqfomeService.syncOrder(companyId, orderId);
  }
}
