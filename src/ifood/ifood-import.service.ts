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
    'CFM',
    'CONFIRMED',
    'PLC',
    'PLACED',
    'DSP',
    'DISPATCHED',
    'RTP',
    'READY_TO_PICKUP',
  ]);
  private static readonly IFOOD_CANCELLATION_EVENT_CODES = new Set([
    'CAN',
    'CANCELLED',
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
      const code = String(event?.code || '').toUpperCase().trim();
      const fullCode = String(event?.fullCode || '').toUpperCase().trim();
      return this.isEligibleImportEventCode(code, fullCode);
    });

    if (eligibleEvents.length === 0) {
      this.logger.log('iFood: nenhum evento elegível encontrado para importação');
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
      const eventCode = String(eventReference?.code || '').toUpperCase().trim();
      const eventFullCode = String(eventReference?.fullCode || '')
        .toUpperCase()
        .trim();
      try {
        this.logger.log(
          `iFood: evento recebido para merchant ativo merchantId=${merchantId ?? ''} orderId=${orderId} code=${eventCode} fullCode=${eventFullCode}`,
        );

        if (this.isCancellationEventCode(eventCode, eventFullCode)) {
          const existingCancellationLink =
            await this.ifoodOrderLinkService.findByIfoodOrderId(
              orderId,
              merchantId,
            );
          this.logger.log(
            existingCancellationLink
              ? `iFood: evento de cancelamento recebido para pedido já vinculado merchantId=${merchantId ?? ''} orderId=${orderId} code=${eventCode} fullCode=${eventFullCode}`
              : `iFood: pedido ignorado porque está cancelado merchantId=${merchantId ?? ''} orderId=${orderId} code=${eventCode} fullCode=${eventFullCode}`,
          );
          continue;
        }

        this.logger.log(
          `iFood: tentando importar pedido merchantId=${merchantId ?? ''} orderId=${orderId} code=${eventCode} fullCode=${eventFullCode}`,
        );
        const existingLink = await this.ifoodOrderLinkService.findByIfoodOrderId(
          orderId,
          merchantId,
        );

        if (existingLink) {
          this.logger.log(
            `iFood: pedido ignorado porque já existe vínculo merchantId=${merchantId ?? ''} orderId=${orderId} code=${eventCode} fullCode=${eventFullCode}`,
          );
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
            `iFood: pedido não importado merchantId=${merchantId ?? ''} orderId=${orderId} code=${eventCode} fullCode=${eventFullCode} reason=${readiness?.reason}`,
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
          this.logger.warn(
            `iFood: loja não encontrada para merchantId merchantId=${order?.merchant?.id ?? merchantId ?? ''} orderId=${orderId} code=${eventCode} fullCode=${eventFullCode}`,
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

        await this.ifoodOrderLinkService.createLink({
          ifoodOrderId: orderId,
          ifoodDisplayId: order?.displayId ?? orderId,
          merchantId: order?.merchant?.id ?? '',
          merchantName: order?.merchant?.name ?? '',
          deliveryId: createdDelivery.id,
          shopkeeperId: targetShopkeeperId,
        });

        this.logger.log(
          `iFood: pedido importado e entrega criada merchantId=${order?.merchant?.id ?? merchantId ?? ''} orderId=${orderId} deliveryId=${createdDelivery.id} displayId=${order?.displayId ?? ''}`,
        );
      } catch (error: any) {
        const reason = String(error?.message || error || '');
        if (reason.toLowerCase().includes('créditos')) {
          this.logger.warn(
            `iFood: loja sem créditos disponíveis merchantId=${merchantId ?? ''} orderId=${orderId} code=${eventCode} fullCode=${eventFullCode} reason=${reason}`,
          );
          continue;
        }
        if (reason.toLowerCase().includes('detalhes do pedido')) {
          this.logger.error(
            `iFood: erro ao buscar detalhes do pedido merchantId=${merchantId ?? ''} orderId=${orderId} code=${eventCode} fullCode=${eventFullCode} reason=${reason}`,
          );
          continue;
        }
        this.logger.error(
          `iFood: erro ao processar importação merchantId=${merchantId ?? ''} orderId=${orderId} code=${eventCode} fullCode=${eventFullCode} reason=${reason}`,
        );
      }
    }
  }

  private isEligibleImportEventCode(code: string, fullCode: string): boolean {
    return (
      IfoodImportService.IFOOD_IMPORT_EVENT_CODES.has(code) ||
      IfoodImportService.IFOOD_IMPORT_EVENT_CODES.has(fullCode)
    );
  }

  private isCancellationEventCode(code: string, fullCode: string): boolean {
    return (
      IfoodImportService.IFOOD_CANCELLATION_EVENT_CODES.has(code) ||
      IfoodImportService.IFOOD_CANCELLATION_EVENT_CODES.has(fullCode)
    );
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
