import {
  All,
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { SaiposService } from './saipos.service';

@Controller('saipos')
export class SaiposController {
  private readonly logger = new Logger(SaiposController.name);

  constructor(private readonly saiposService: SaiposService) {}

  @Post('webhook/oauth/token')
  @HttpCode(200)
  generateWebhookToken(@Body() payload: any) {
    return this.saiposService.generateToken(payload);
  }

  @Post('oauth/token')
  @HttpCode(200)
  generateToken(@Body() payload: any) {
    return this.saiposService.generateToken(payload);
  }

  @Post('webhook')
  @HttpCode(200)
  async webhook(@Body() payload: any, @Headers() headers: Record<string, any>) {
    await this.saiposService.processWebhook(payload, headers);
    return { status: 'ok' };
  }

  @Post('webhook/delivery')
  @HttpCode(200)
  async webhookDelivery(
    @Body() payload: any,
    @Headers() headers: Record<string, any>,
  ) {
    return this.processDeliveryWebhook('/delivery', payload, headers);
  }

  @Post('webhook/deliveries')
  @HttpCode(200)
  async webhookDeliveries(
    @Body() payload: any,
    @Headers() headers: Record<string, any>,
  ) {
    return this.processDeliveryWebhook('/deliveries', payload, headers);
  }

  @Post('webhook/orders')
  @HttpCode(200)
  async webhookOrders(
    @Body() payload: any,
    @Headers() headers: Record<string, any>,
  ) {
    return this.processDeliveryWebhook('/orders', payload, headers);
  }

  @Post('webhook/order')
  @HttpCode(200)
  async webhookOrder(
    @Body() payload: any,
    @Headers() headers: Record<string, any>,
  ) {
    return this.processDeliveryWebhook('/order', payload, headers);
  }

  @All('webhook/*')
  @HttpCode(200)
  async webhookFallback(
    @Body() payload: any,
    @Headers() headers: Record<string, any>,
    @Req() request: Request,
  ) {
    const endpoint = this.extractWebhookEndpoint(request);

    this.logger.log(
      `[SAIPOS WEBHOOK] fallback chamado method=${request.method} path=${request.path}`,
    );
    this.logger.log(
      `[SAIPOS WEBHOOK] fallback body=${JSON.stringify(payload || {})}`,
    );

    if (this.saiposService.looksLikeDelivery(payload)) {
      await this.saiposService.processWebhook(payload, headers);
    }

    return { status: 'ok', endpoint };
  }

  private async processDeliveryWebhook(
    endpoint: string,
    payload: any,
    headers: Record<string, any>,
  ) {
    this.logger.log(`[SAIPOS WEBHOOK] endpoint chamado: ${endpoint}`);
    this.logger.log('[SAIPOS WEBHOOK] payload recebido');
    await this.saiposService.processWebhook(payload, headers);
    this.logger.log('[SAIPOS WEBHOOK] entrega criada com sucesso');
    return { status: 'ok' };
  }

  private extractWebhookEndpoint(request: Request): string {
    const basePath = '/saipos/webhook';
    const path = request.path || request.url || '';
    const [, endpoint] = path.split(basePath);

    return endpoint || path;
  }
}
