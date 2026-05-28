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

    const eligibleEvents = events.filter((event) => this.isEligibleImportEvent(event));

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
          this.logger.log(`iFood: pedido ignorado porque já existe vínculo | merchantId=${merchantId ?? 'n/a'} orderId=${orderId}`);
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
            `iFood: pedido não importado | merchantId=${merchantId ?? 'n/a'} orderId=${orderId} code=${eventReference?.code ?? ''} fullCode=${eventReference?.fullCode ?? ''} motivo=${readiness?.reason}`,
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
            `iFood: loja não encontrada para merchantId | merchantId=${order?.merchant?.id ?? merchantId ?? '(vazio)'} orderId=${orderId}`,
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
          `iFood: pedido importado e entrega criada | merchantId=${order?.merchant?.id ?? merchantId ?? 'n/a'} orderId=${orderId} deliveryId=${createdDelivery.id} shopkeeperId=${targetShopkeeperId}`,
        );

        await this.ifoodOrderLinkService.createLink({
          ifoodOrderId: orderId,
          ifoodDisplayId: order?.displayId ?? orderId,
          merchantId: order?.merchant?.id ?? '',
          merchantName: order?.merchant?.name ?? '',
          deliveryId: createdDelivery.id,
          shopkeeperId: targetShopkeeperId,
        });

        this.logger.log(`iFood: vínculo criado com sucesso | merchantId=${order?.merchant?.id ?? merchantId ?? 'n/a'} orderId=${orderId} displayId=${order?.displayId ?? ''}`);
      } catch (error: any) {
        this.logger.error(
          `iFood: erro ao buscar detalhes do pedido | merchantId=${merchantId ?? 'n/a'} orderId=${orderId} code=${eventReference?.code ?? ''} fullCode=${eventReference?.fullCode ?? ''} erro=${error?.message || error}`,
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

  async retryPendingImportsForActiveMerchants(limit = 300) {
    const recentEvents =
      await this.ifoodEventService.findRecentEligibleImportEvents(limit);
    if (recentEvents.length === 0) {
      return;
    }

    const replayCandidates = recentEvents.map((event) => ({
      id: event.eventId,
      orderId: event.orderId,
      merchantId: event.merchantId,
      code: event.code,
      fullCode: event.fullCode,
      salesChannel: event.salesChannel,
      createdAt: event.createdAt,
    }));

    this.logger.log(
      `iFood: tentando importar pedido(s) recentes pendentes | total=${replayCandidates.length}`,
    );
    await this.importFromEvents(replayCandidates);
  }

  isEligibleImportEvent(event: any) {
    const code = String(event?.code || '').toUpperCase();
    const fullCode = String(event?.fullCode || '').toUpperCase();
    return (
      IfoodImportService.IFOOD_IMPORT_EVENT_CODES.has(code) ||
      IfoodImportService.IFOOD_IMPORT_EVENT_CODES.has(fullCode)
    );
  }
}
