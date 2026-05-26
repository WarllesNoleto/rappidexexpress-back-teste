import { Injectable, Logger } from '@nestjs/common';
import { DeliveryService } from '../delivery/delivery.service';
import { IfoodEventService } from './ifood-event.service';
import { IfoodOrderLinkService } from './ifood-order-link.service';
import { IfoodOrdersService } from './ifood-orders.service';
import { IfoodReadinessService } from './ifood-readiness.service';

@Injectable()
export class IfoodImportService {
  private readonly logger = new Logger(IfoodImportService.name);
  private static readonly IFOOD_IMPORT_EVENT_CODES = new Set([
    'CONFIRMED',
    'ORDER_CONFIRMED',
    'PREPARATION_STARTED',
    'SEPARATION_STARTED',
  ]);

  constructor(
    private readonly deliveryService: DeliveryService,
    private readonly ifoodOrdersService: IfoodOrdersService,
    private readonly ifoodOrderLinkService: IfoodOrderLinkService,
    private readonly ifoodReadinessService: IfoodReadinessService,
    private readonly ifoodEventService: IfoodEventService,
  ) {}

  async importFromEvents(events: any[]) {
    if (!Array.isArray(events) || events.length === 0) {
      this.logger.log(
        'Importação automática: nenhum evento recebido do iFood.',
      );
      return;
    }

    const eligibleEvents = events.filter((event) => {
      const code = String(event?.code || '').toUpperCase();
      const fullCode = String(event?.fullCode || '').toUpperCase();
      return (
        IfoodImportService.IFOOD_IMPORT_EVENT_CODES.has(code) ||
        IfoodImportService.IFOOD_IMPORT_EVENT_CODES.has(fullCode) ||
        code === 'DSP' ||
        fullCode === 'DISPATCHED'
      );
    });

    if (eligibleEvents.length === 0) {
      this.logger.log(
        'Importação automática: nenhum evento elegível encontrado. Códigos monitorados: RTP, DSP',
      );
      return;
    }

    const uniqueOrders = [
      ...new Map(
        eligibleEvents
          .filter((event) => event?.orderId)
          .map((event) => [event.orderId, event]),
      ).values(),
    ];

    for (const eventReference of uniqueOrders) {
      const orderId = eventReference?.orderId;
      const merchantId = eventReference?.merchantId ?? null;
      try {
        const existingLink = await this.ifoodOrderLinkService.findByIfoodOrderId(
          orderId,
          merchantId,
        );

        if (existingLink) {
          this.logger.log(`ifood_event action=duplicate_ignored orderId=${orderId}`);
          continue;
        }

        const orderEvents = events.filter(
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

        const order = await this.ifoodOrdersService.getOrderDetails(
          orderId,
          merchantId,
        );
        const targetShopkeeperId: string | null =
          await this.ifoodOrdersService.resolveTargetShopkeeperId(
            order?.merchant?.id,
          );

        if (!targetShopkeeperId) {
          this.logger.error(
            `Importação automática: nenhum lojista configurado para o merchantId ${order?.merchant?.id ?? '(vazio)'}.`,
          );
          continue;
        }

        const deliveryDto =
          await this.ifoodOrdersService.buildCreateDeliveryDto(
            orderId,
            merchantId,
          );

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

        this.logger.log(
          `ifood_import_created orderId=${orderId} deliveryId=${createdDelivery.id} shopkeeperId=${targetShopkeeperId}`,
        );

        await this.ifoodOrderLinkService.createLink({
          ifoodOrderId: orderId,
          ifoodDisplayId: order?.displayId ?? orderId,
          merchantId: order?.merchant?.id ?? '',
          merchantName: order?.merchant?.name ?? '',
          deliveryId: createdDelivery.id,
          shopkeeperId: targetShopkeeperId,
        });

        this.logger.log(`ifood_event action=imported orderId=${orderId} displayId=${order?.displayId ?? ''}`);
      } catch (error: any) {
        this.logger.error(
          `Importação automática: erro ao processar pedido ${orderId}: ${error?.message || error}`,
        );
      }
    }
  }
  async retryPendingImportsForCompany(companyId: string, limit = 500) {
    const recentEvents =
      await this.ifoodEventService.findRecentEligibleImportEvents(limit);

    if (recentEvents.length === 0) {
      this.logger.log(
        `Reprocessamento pós-crédito: nenhum evento elegível encontrado para a empresa ${companyId}.`,
      );
      return;
    }

    const filteredEvents: any[] = [];

    for (const event of recentEvents) {
      if (!event?.merchantId || !event?.orderId) {
        continue;
      }

      const targetShopkeeperId =
        await this.ifoodOrdersService.resolveTargetShopkeeperId(
          event.merchantId,
        );

      if (targetShopkeeperId !== companyId) {
        continue;
      }

      filteredEvents.push({
        id: event.eventId,
        orderId: event.orderId,
        merchantId: event.merchantId,
        code: event.code,
        fullCode: event.fullCode,
        salesChannel: event.salesChannel,
        createdAt: event.createdAt,
      });
    }

    if (filteredEvents.length === 0) {
      this.logger.log(
        `Reprocessamento pós-crédito: sem eventos pendentes para a empresa ${companyId}.`,
      );
      return;
    }

    this.logger.log(
      `Reprocessamento pós-crédito: ${filteredEvents.length} evento(s) serão reavaliados para a empresa ${companyId}.`,
    );

    await this.importFromEvents(filteredEvents);
  }
}
