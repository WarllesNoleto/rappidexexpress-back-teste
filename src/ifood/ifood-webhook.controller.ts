import { Body, Controller, HttpCode, Logger, Post } from '@nestjs/common';
import { IfoodWebhookService } from './ifood-webhook.service';

@Controller('ifood')
export class IfoodWebhookController {
  private readonly logger = new Logger(IfoodWebhookController.name);

  constructor(private readonly ifoodWebhookService: IfoodWebhookService) {}

  @Post('webhook')
  @HttpCode(200)
  receiveWebhook(@Body() body: any) {
    const events = this.extractEvents(body);

    this.ifoodWebhookService.enqueueIncomingEvents(events);

    this.logger.log(
      `Webhook do iFood recebido com sucesso. Eventos no payload: ${events.length}.`,
    );

    return {
      success: true,
      processedAsync: true,
      received: events.length,
    };
  }

  private extractEvents(body: any) {
    if (Array.isArray(body)) {
      return body;
    }

    if (Array.isArray(body?.events)) {
      return body.events;
    }

    if (body && typeof body === 'object' && body.id) {
      return [body];
    }

    return [];
  }
}