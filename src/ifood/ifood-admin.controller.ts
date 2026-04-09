import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Param,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeliveryService } from '../delivery/delivery.service';
import { IfoodAuthService } from './ifood-auth.service';
import { IfoodOrderLinkService } from './ifood-order-link.service';
import { IfoodOrdersService } from './ifood-orders.service';
import { IfoodPollingService } from './ifood-polling.service';
import { IfoodReadinessService } from './ifood-readiness.service';

@Controller('ifood')
export class IfoodAdminController {
  constructor(
    private readonly configService: ConfigService,
    private readonly deliveryService: DeliveryService,
    private readonly ifoodAuthService: IfoodAuthService,
    private readonly ifoodOrdersService: IfoodOrdersService,
    private readonly ifoodPollingService: IfoodPollingService,
    private readonly ifoodOrderLinkService: IfoodOrderLinkService,
    private readonly ifoodReadinessService: IfoodReadinessService,
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

    const targetShopkeeperId = this.configService.get<string>(
      'IFOOD_TARGET_SHOPKEEPER_ID',
    );

    if (!targetShopkeeperId) {
      throw new BadRequestException(
        'IFOOD_TARGET_SHOPKEEPER_ID não configurado no .env.',
      );
    }

    const order = await this.ifoodOrdersService.getOrderDetails(orderId);
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
}