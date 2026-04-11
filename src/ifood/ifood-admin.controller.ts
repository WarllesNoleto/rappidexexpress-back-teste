import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../authenticator/guards/jwt-auth.guard';
import { DeliveryService } from '../delivery/delivery.service';
import { User } from '../shared/decorators';
import { onlyForAdmin } from '../shared/utils/permissions.function';
import { UserRequest } from '../shared/interfaces';
import { IfoodCreditAdjustDto } from './dto/ifood-credit-adjust.dto';
import { IfoodCreditsService } from './ifood-credits.service';
import { IfoodAuthService } from './ifood-auth.service';
import { IfoodOrderLinkService } from './ifood-order-link.service';
import { IfoodOrdersService } from './ifood-orders.service';
import { IfoodPollingService } from './ifood-polling.service';
import { IfoodImportService } from './ifood-import.service';
import { IfoodReadinessService } from './ifood-readiness.service';

@Controller('ifood')
export class IfoodAdminController {
  constructor(
    private readonly configService: ConfigService,
    private readonly deliveryService: DeliveryService,
    private readonly ifoodAuthService: IfoodAuthService,
    private readonly ifoodOrdersService: IfoodOrdersService,
    private readonly ifoodPollingService: IfoodPollingService,
    private readonly ifoodImportService: IfoodImportService,
    private readonly ifoodOrderLinkService: IfoodOrderLinkService,
    private readonly ifoodReadinessService: IfoodReadinessService,
    private readonly ifoodCreditsService: IfoodCreditsService,
  ) {}

  private ensureDebugRoutesEnabled() {
    const enabled =
      String(this.configService.get('IFOOD_DEBUG_ROUTES_ENABLED')) === 'true';

    if (!enabled) {
      throw new ForbiddenException(
        'As rotas de debug do iFood estão desativadas neste ambiente.',
      );
    }
  }

  @Get('token-test')
  async tokenTest() {
    this.ensureDebugRoutesEnabled();

    const accessToken = await this.ifoodAuthService.getAccessToken();

    return {
      success: true,
      message: 'Token do iFood gerado com sucesso.',
      tokenPreview: `${accessToken.slice(0, 20)}...`,
    };
  }

  @Get('order-test/:orderId')
  async orderTest(@Param('orderId') orderId: string) {
    this.ensureDebugRoutesEnabled();

    const order = await this.ifoodOrdersService.getOrderDetails(orderId);

    return {
      success: true,
      message: 'Pedido encontrado com sucesso.',
      order,
    };
  }

  @Get('order-analyze/:orderId')
  async orderAnalyze(@Param('orderId') orderId: string) {
    this.ensureDebugRoutesEnabled();

    return this.ifoodOrdersService.analyzeOrder(orderId);
  }

  @Get('delivery-preview/:orderId')
  async deliveryPreview(@Param('orderId') orderId: string) {
    this.ensureDebugRoutesEnabled();

    return this.ifoodOrdersService.buildDeliveryPreview(orderId);
  }

  @Get('polling-test')
  async pollingTest() {
    this.ensureDebugRoutesEnabled();

    const events = await this.ifoodPollingService.pollEvents();

    return {
      success: true,
      message: 'Eventos consultados com sucesso.',
      events,
    };
  }

  @Get('polling-test/order/:orderId')
  async pollingTestByOrder(@Param('orderId') orderId: string) {
    this.ensureDebugRoutesEnabled();

    const events = await this.ifoodPollingService.pollEvents();

    const filteredEvents = Array.isArray(events)
      ? events.filter((event) => event?.orderId === orderId)
      : [];

    return {
      success: true,
      message: 'Eventos do pedido consultados com sucesso.',
      orderId,
      total: filteredEvents.length,
      events: filteredEvents,
    };
  }

  @Get('order-readiness/:orderId')
  async orderReadiness(@Param('orderId') orderId: string) {
    this.ensureDebugRoutesEnabled();

    return this.ifoodReadinessService.getOrderReadiness(orderId);
  }

  @Get('dispatch-test/:orderId')
  async dispatchTest(@Param('orderId') orderId: string) {
    this.ensureDebugRoutesEnabled();

    return this.ifoodOrdersService.dispatchOrder(orderId);
  }

  @Get('create-delivery-test/:orderId')
  async createDeliveryTest(@Param('orderId') orderId: string) {
    this.ensureDebugRoutesEnabled();

    const existingLink =
      await this.ifoodOrderLinkService.findByIfoodOrderId(orderId);

    if (existingLink) {
      throw new BadRequestException(
        `Este pedido do iFood já foi importado para o Rappidex. DeliveryId: ${existingLink.deliveryId}`,
      );
    }

    const readiness =
      await this.ifoodReadinessService.getOrderReadiness(orderId);

    if (!readiness.canCreateRappidexDelivery) {
      throw new BadRequestException(readiness.reason);
    }

    const order = await this.ifoodOrdersService.getOrderDetails(orderId);
    const targetShopkeeperId: string | null =
      await this.ifoodOrdersService.resolveTargetShopkeeperId(
        order?.merchant?.id,
      );

    if (!targetShopkeeperId) {
      throw new BadRequestException(
        `Nenhum lojista configurado para o merchantId ${order?.merchant?.id ?? '(vazio)'}.`,
      );
    }

      const deliveryDto =
        await this.ifoodOrdersService.buildCreateDeliveryDto(orderId);

      const createdDelivery = await this.deliveryService.createDelivery(
        deliveryDto,
      {
        id: targetShopkeeperId,
        phone: '',
        user: 'ifood.integration',
        type: 'shopkeeperadmin' as any,
        permission: 'admin' as any,
        cityId: '',
      },
      { creditOrderId: orderId },
    );

    await this.ifoodOrderLinkService.createLink({
      ifoodOrderId: orderId,
      ifoodDisplayId: order?.displayId ?? orderId,
      merchantId: order?.merchant?.id ?? '',
      deliveryId: createdDelivery.id,
      shopkeeperId: targetShopkeeperId,
    });

    return {
      success: true,
      message: 'Entrega criada no Rappidex com sucesso.',
      orderId,
      delivery: createdDelivery,
    };
  }

  @Get('credits/my-summary')
  @UseGuards(JwtAuthGuard)
  async myCreditsSummary(@User() user: UserRequest) {
    return this.ifoodCreditsService.getMySummary(user);
  }

  @Get('credits/my-history')
  @UseGuards(JwtAuthGuard)
  async myCreditsHistory(@User() user: UserRequest) {
    return this.ifoodCreditsService.getMyHistory(user);
  }

  @Get('credits/companies')
  @UseGuards(JwtAuthGuard)
  async listCompaniesSummary(@User() user: UserRequest) {
    if (!onlyForAdmin(user.type)) {
      throw new UnauthorizedException(
        'Você não tem permissão para esse recurso.',
      );
    }

    return this.ifoodCreditsService.getCreditSummaryForIntegratedCompanies(user);
  }

  @Get('credits/company/:companyId')
  @UseGuards(JwtAuthGuard)
  async companyCreditsSummary(
    @Param('companyId') companyId: string,
    @User() user: UserRequest,
  ) {
    return this.ifoodCreditsService.getCompanySummary(companyId, user);
  }

  @Get('credits/company/:companyId/history')
  @UseGuards(JwtAuthGuard)
  async companyCreditsHistory(
    @Param('companyId') companyId: string,
    @User() user: UserRequest,
  ) {
    return this.ifoodCreditsService.getCompanyHistory(companyId, user);
  }

  @Post('credits/company/:companyId/add')
  @UseGuards(JwtAuthGuard)
  async addCompanyCredits(
    @Param('companyId') companyId: string,
    @Body() body: IfoodCreditAdjustDto,
    @User() user: UserRequest,
  ) {
    if (!onlyForAdmin(user.type)) {
      throw new UnauthorizedException(
        'Você não tem permissão para esse recurso.',
      );
    }

    const summary = await this.ifoodCreditsService.addCredits(
      companyId,
      Number(body.amount),
      user,
      body.reason,
    );
    
    if (summary.useIfoodIntegration) {
      await this.ifoodImportService.retryPendingImportsForCompany(companyId);
    }

    return summary;
  }

  @Post('credits/company/:companyId/remove')
  @UseGuards(JwtAuthGuard)
  async removeCompanyCredits(
    @Param('companyId') companyId: string,
    @Body() body: IfoodCreditAdjustDto,
    @User() user: UserRequest,
  ) {
    if (!onlyForAdmin(user.type)) {
      throw new UnauthorizedException(
        'Você não tem permissão para esse recurso.',
      );
    }

    return this.ifoodCreditsService.removeCredits(
      companyId,
      Number(body.amount),
      user,
      body.reason,
    );
  }
}