import { Body, Controller, Headers, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiqfomeWebhookService } from './aiqfome-webhook.service';

@Controller('aiqfome')
export class AiqfomeController {
  constructor(
    private readonly configService: ConfigService,
    private readonly webhookService: AiqfomeWebhookService,
  ) {}

  @Post('webhook')
  @HttpCode(200)
  async webhook(@Body() payload: any, @Headers('authorization') authorization?: string) {
    const secret = this.configService.get<string>('AIQFOME_WEBHOOK_SECRET');
    if (secret && authorization !== secret) {
      throw new UnauthorizedException('Webhook não autorizado');
    }

    const valid = payload && (payload.event || payload.id || payload.event_id);
    if (!valid) {
      return { ok: false };
    }

    await this.webhookService.processWebhook(payload);
    return { ok: true };
  }
}