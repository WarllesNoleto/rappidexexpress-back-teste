import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { AnotaAiService } from './anota-ai.service';

@Controller('anota-ai')
export class AnotaAiController {
  constructor(private readonly anotaAiService: AnotaAiService) {}

  @Get('health')
  health() {
    return this.anotaAiService.getHealth();
  }

  @Post('webhook')
  @HttpCode(200)
  webhook(@Body() payload: any, @Headers() headers: Record<string, any>) {
    if (!this.anotaAiService.validateWebhookToken(headers)) {
      throw new UnauthorizedException('[ANOTA AI] Token externo inválido');
    }

    void this.anotaAiService.processWebhook(payload, headers);
    return { status: 'ok' };
  }
}
