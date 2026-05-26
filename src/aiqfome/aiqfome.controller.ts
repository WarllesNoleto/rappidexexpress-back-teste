import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AiqfomeService } from './aiqfome.service';
import { AiqfomeWebhookService } from './aiqfome-webhook.service';
import { Response } from 'express';
import { JwtAuthGuard } from '../authenticator/guards/jwt-auth.guard';
import { User } from '../shared/decorators';
import { UserRequest } from '../shared/interfaces';
import { onlyForAdmin } from '../shared/utils/permissions.function';

@Controller('aiqfome')
export class AiqfomeController {
  constructor(
    private readonly aiqfomeService: AiqfomeService,
    private readonly webhookService: AiqfomeWebhookService,
  ) {}

  @Get('oauth/start/:companyId')
  @UseGuards(JwtAuthGuard)
  async oauthStart(
    @Res() res: Response,
    @Param('companyId') companyId: string,
    @User() user: UserRequest,
  ) {
    const authUrl = await this.aiqfomeService.oauthStart(companyId, user);
    return res.redirect(authUrl);
  }

  @Get('oauth/callback')
  async oauthCallback(@Query() query: { code?: string; state?: string }, @Res() res: Response) {
    const { code, state } = query;
    try {
      const result = await this.aiqfomeService.oauthCallback(code, state);
      const mapped = (result as any)?.success;
      const message = mapped
        ? 'Integração aiqfome concluída com sucesso. Pode fechar esta janela.'
        : 'Integração autorizada, mas nenhuma empresa Rappidex está cadastrada com esta loja aiqfome. Cadastre o Store ID da loja no Rappidex e tente novamente.';
      return res.status(200).send(`<html><body style="font-family:Arial,sans-serif;padding:24px;"><h3>${message}</h3></body></html>`);
    } catch {
      return res.status(400).send('<html><body style="font-family:Arial,sans-serif;padding:24px;"><h3>Não foi possível concluir a integração aiqfome.</h3></body></html>');
    }
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
  @UseGuards(JwtAuthGuard)
  status(@Param('companyId') companyId: string, @User() user: UserRequest) {
    if (!onlyForAdmin(user.type) && user.id !== companyId) {
      throw new ForbiddenException('Acesso negado.');
    }
    return this.aiqfomeService.getStatus(companyId, user);
  }

  @Post('test-connection/:companyId')
  @UseGuards(JwtAuthGuard)
  testConnection(@Param('companyId') companyId: string, @User() user: UserRequest) {
    return this.aiqfomeService.testConnection(companyId, user);
  }

  @Post('register-webhook/:companyId')
  @UseGuards(JwtAuthGuard)
  registerWebhook(@Param('companyId') companyId: string, @User() user: UserRequest) {
    return this.aiqfomeService.registerWebhook(companyId, user);
  }

  @Put('config/:companyId')
  @UseGuards(JwtAuthGuard)
  updateConfig(@Param('companyId') companyId: string, @Body() body: any, @User() user: UserRequest) {
    return this.aiqfomeService.updateConfig(companyId, body, user);
  }

  @Post('sync-order/:companyId/:orderId')
  @UseGuards(JwtAuthGuard)
  syncOrder(
    @Param('companyId') companyId: string,
    @Param('orderId') orderId: string,
    @User() user: UserRequest,
  ) {
    return this.aiqfomeService.syncOrder(companyId, orderId, user);
  }
}
