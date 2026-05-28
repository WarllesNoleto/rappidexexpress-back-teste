import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../authenticator/guards/jwt-auth.guard';
import { User } from '../shared/decorators';
import { UserRequest } from '../shared/interfaces';
import { onlyForAdmin } from '../shared/utils/permissions.function';
import { AiqfomeService } from './aiqfome.service';

@Controller('aiqfome')
export class AiqfomeController {
  constructor(private readonly aiqfomeService: AiqfomeService) {}

  private ensureSensitiveRouteAccess(user: UserRequest) {
    if (process.env.AIQFOME_DEBUG_ROUTES_ENABLED === 'true') {
      return;
    }

    if (!onlyForAdmin(user?.type)) {
      throw new UnauthorizedException('Você não tem permissão para esse recurso.');
    }
  }

  @Get('connect-url')
  @UseGuards(JwtAuthGuard)
  getConnectUrl(
    @User() user: UserRequest,
    @Query('shopkeeperId') shopkeeperId: string,
    @Query('storeId') storeId?: string,
  ) {
    this.ensureSensitiveRouteAccess(user);
    return this.aiqfomeService.generateConnectUrl(shopkeeperId, storeId);
  }

  @Get('integrations')
  @UseGuards(JwtAuthGuard)
  list(@User() user: UserRequest, @Query('shopkeeperId') shopkeeperId: string) {
    this.ensureSensitiveRouteAccess(user);
    return this.aiqfomeService.listStores(shopkeeperId);
  }

  @Get('callback')
  callback(@Query('code') code: string, @Query('state') state: string) { return this.aiqfomeService.handleOAuthCallback(code, state); }

  @Post('import-order')
  @UseGuards(JwtAuthGuard)
  importOrder(@User() user: UserRequest, @Body() body: any) {
    this.ensureSensitiveRouteAccess(user);
    return this.aiqfomeService.importOrder(body.integrationId, body.orderId, body.storeId);
  }

  @Post('sync-status')
  @UseGuards(JwtAuthGuard)
  syncStatus(@User() user: UserRequest, @Body() body: any) {
    this.ensureSensitiveRouteAccess(user);
    return this.aiqfomeService.syncStatus(body.deliveryId);
  }

  @Post('register-webhook/:integrationId')
  @UseGuards(JwtAuthGuard)
  registerWebhook(@User() user: UserRequest, @Param('integrationId') integrationId: string) {
    this.ensureSensitiveRouteAccess(user);
    return this.aiqfomeService.registerWebhookById(integrationId);
  }

  @Get('health')
  @UseGuards(JwtAuthGuard)
  health(@User() user: UserRequest) {
    this.ensureSensitiveRouteAccess(user);
    return { ok: true, at: new Date().toISOString() };
  }

  @Post('webhook')
  @HttpCode(200)
  webhook(@Headers() headers: Record<string, string>, @Body() payload: any) { this.aiqfomeService.handleWebhook(headers, payload).catch((error) => { console.error('[Aiqfome] erro assíncrono no webhook', error?.message || error); }); return { success: true }; }
}
