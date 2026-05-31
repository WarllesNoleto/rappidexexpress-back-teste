import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
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
  webhook(@Body() payload: any) {
    void this.anotaAiService.processWebhook(payload);
    return { status: 'ok' };
  }
}
