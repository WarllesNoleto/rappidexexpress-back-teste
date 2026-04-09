import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeliveryService } from '../delivery/delivery.service';
import { IfoodOrderLinkService } from './ifood-order-link.service';
import { IfoodOrdersService } from './ifood-orders.service';
import { IfoodReadinessService } from './ifood-readiness.service';

@Injectable()
export class IfoodImportService {
  private readonly logger = new Logger(IfoodImportService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly deliveryService: DeliveryService,
    private readonly ifoodOrdersService: IfoodOrdersService,
    private readonly ifoodOrderLinkService: IfoodOrderLinkService,
    private readonly ifoodReadinessService: IfoodReadinessService,
  ) {}

  async importFromEvents(events: any[]) {
    if (!Array.isArray(events) || events.length === 0) {
      this.logger.log('Importação automática: nenhum evento recebido do iFood.');
      return;
    }

    const eligibleEvents = events.filter(
      (event) =>
        event?.code === 'RTP' ||
        event?.fullCode === 'READY_TO_PICKUP' ||
        event?.code === 'DSP' ||
        event?.fullCode === 'DISPATCHED',
    );

    if (eligibleEvents.length === 0) {
      this.logger.log(
        'Importação automática: nenhum evento elegível encontrado. Códigos monitorados: RTP, DSP',
      );
      return;
    }

    const uniqueOrderIds = [
      ...new Set(eligibleEvents.map((event) => event?.orderId).filter(Boolean)),
    ];

    const targetShopkeeperId = this.configService.get<string>(
      'IFOOD_TARGET_SHOPKEEPER_ID',
    );

    if (!targetShopkeeperId) {
      this.logger.error(
        'Importação automática: IFOOD_TARGET_SHOPKEEPER_ID não configurado.',
      );
      return;
    }

    for (const orderId of uniqueOrderIds) {
      try {
        const existingLink =
          await this.ifoodOrderLinkService.findByIfoodOrderId(orderId);

        if (existingLink) {
          this.logger.log(
            `Importação automática: pedido ${orderId} já importado. DeliveryId ${existingLink.deliveryId}`,
          );
          continue;
        }

        const orderEvents = eligibleEvents.filter(
          (event) => event?.orderId === orderId,
        );

        const readiness = await this.ifoodReadinessService.getOrderReadiness(
          orderId,
          orderEvents,
        );

        if (!readiness?.canCreateRappidexDelivery) {
          this.logger.warn(
            `Importação automática: pedido ${orderId} ignorado. Motivo: ${readiness?.reason}`,
          );
          continue;
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

        this.logger.log(
          `Importação automática: pedido ${orderId} importado com sucesso após evento RTP/DSP. DeliveryId ${createdDelivery.id}`,
        );
      } catch (error: any) {
        this.logger.error(
          `Importação automática: erro ao processar pedido ${orderId}: ${error?.message || error}`,
        );
      }
    }
  }
}