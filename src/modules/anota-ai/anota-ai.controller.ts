import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../authenticator/guards/jwt-auth.guard';
import { User } from '../../shared/decorators';
import { UserRequest } from '../../shared/interfaces';
import { onlyForAdmin } from '../../shared/utils/permissions.function';
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
  webhook(
    @Body() payload: any,
    @Headers() headers: Record<string, any>,
    @Req() request: any,
  ) {
    if (!this.anotaAiService.validateWebhookToken(headers)) {
      throw new UnauthorizedException('[ANOTA AI] Token externo inválido');
    }

    void this.anotaAiService.processWebhook(payload, headers, {
      ip: request?.ip,
      origin: request?.headers?.origin || request?.headers?.referer,
    });
    return { status: 'ok' };
  }

  // Endpoint administrativo para teste manual do polling de segurança da Anota AI.
  @Post('polling/run')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async runPolling(@User() user: UserRequest) {
    if (!onlyForAdmin(user.type)) {
      throw new UnauthorizedException(
        'Você não tem permissão para esse recurso.',
      );
    }

    await this.anotaAiService.runPollingForAllStores();
    return {
      status: 'ok',
      message: 'Polling Anota AI executado',
    };
  }
}
