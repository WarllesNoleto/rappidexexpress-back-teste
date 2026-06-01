import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { SaiposService } from './saipos.service';

@Controller('saipos')
export class SaiposController {
  constructor(private readonly saiposService: SaiposService) {}

  @Post('webhook')
  @HttpCode(200)
  async webhook(@Body() payload: any, @Headers() headers: Record<string, any>) {
    await this.saiposService.processWebhook(payload, headers);
    return { status: 'ok' };
  }
}
