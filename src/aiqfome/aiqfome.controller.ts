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
  @UseGuards(JwtAuthGuard)
  status(@Param('companyId') companyId: string, @User() user: UserRequest) {
    if (!onlyForAdmin(user.type) && user.id !== companyId) {
      throw new ForbiddenException('Acesso negado.');
    }
    return this.aiqfomeService.getStatus(companyId, user);
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
  @UseGuards(JwtAuthGuard)
  syncOrder(
    @Param('companyId') companyId: string,
    @Param('orderId') orderId: string,
    @User() user: UserRequest,
  ) {
    return this.aiqfomeService.syncOrder(companyId, orderId, user);
  }
}
