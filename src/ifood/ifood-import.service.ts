import { Injectable, Logger } from '@nestjs/common';
import { DeliveryService } from '../delivery/delivery.service';
import { IfoodEventService } from './ifood-event.service';
import { IfoodOrderLinkService } from './ifood-order-link.service';
import { IfoodOrdersService } from './ifood-orders.service';
import { IfoodPollingService } from './ifood-polling.service';
import { IfoodReadinessService } from './ifood-readiness.service';

@Injectable()
export class IfoodImportService {
  private readonly logger = new Logger(IfoodImportService.name);
  private static readonly MAX_EVENT_AGE_HOURS = 24;
  private static readonly IFOOD_IMPORT_EVENT_CODES = new Set([
    'CONFIRMED',
    'ORDER_CONFIRMED',
    'PREPARATION_STARTED',
    'SEPARATION_STARTED',
  ]);

  constructor(
    private readonly deliveryService: DeliveryService,
    private readonly ifoodOrdersService: IfoodOrdersService,
    private readonly ifoodPollingService: IfoodPollingService,
    private readonly ifoodOrderLinkService: IfoodOrderLinkService,
    private readonly ifoodReadinessService: IfoodReadinessService,
    private readonly ifoodEventService: IfoodEventService,
  ) {}

  private isEventEligible(event: any) {
    const code = String(event?.code || '').toUpperCase();
    const fullCode = String(event?.fullCode || '').toUpperCase();
    return (
      IfoodImportService.IFOOD_IMPORT_EVENT_CODES.has(code) ||
      IfoodImportService.IFOOD_IMPORT_EVENT_CODES.has(fullCode) ||
      code === 'RTP' ||
      fullCode === 'READY_TO_PICKUP' ||
      code === 'DSP' ||
      fullCode === 'DISPATCHED'
    );
  }

  async importFromEvents(events: any[]) {
    if (!Array.isArray(events) || events.length === 0) {
      this.logger.log(
        'Importação automática: nenhum evento recebido do iFood.',
      );
      return;
    }

    const eligibleEvents = events.filter((event) => this.isEventEligible(event));

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

  async importPendingOrdersForMerchant(merchantId: string, shopkeeperId: string) {
    const normalizedMerchantId = String(merchantId || '').trim();
    const normalizedShopkeeperId = String(shopkeeperId || '').trim();
    this.logger.log(
      `[iFood Backfill] Iniciando busca de pedidos pendentes merchantId=${normalizedMerchantId}`,
    );

    const polledEvents = await this.ifoodPollingService.pollEvents();
    const merchantEvents = (Array.isArray(polledEvents) ? polledEvents : []).filter(
      (event) => String(event?.merchantId || '').trim() === normalizedMerchantId,
    );
    this.logger.log(`[iFood Backfill] Eventos encontrados: ${merchantEvents.length}`);

    const pendingAck: Array<{ id: string; merchantId: string }> = [];
    const ignoredByReason: Record<string, number> = {};
    let imported = 0;
    let ignored = 0;

    const addIgnored = (reason: string, orderId = '') => {
      ignored += 1;
      ignoredByReason[reason] = (ignoredByReason[reason] || 0) + 1;
      this.logger.log(`[iFood Backfill] Pedido ignorado porque ${reason} orderId=${orderId}`);
    };

    const uniqueOrders = [
      ...new Map(
        merchantEvents
          .filter((event) => this.isEventEligible(event) && event?.orderId)
          .map((event) => [event.orderId, event]),
      ).values(),
    ];

    for (const event of uniqueOrders) {
      const eventId = String(event?.id || '').trim();
      if (eventId) {
        pendingAck.push({ id: eventId, merchantId: normalizedMerchantId });
      }

      const orderId = String(event?.orderId || '').trim();
      if (!orderId) {
        addIgnored('sem orderId válido');
        continue;
      }

      const createdAt = event?.createdAt ? new Date(event.createdAt) : null;
      const ageHours = createdAt
        ? (Date.now() - createdAt.getTime()) / (1000 * 60 * 60)
        : 0;
      if (ageHours > IfoodImportService.MAX_EVENT_AGE_HOURS) {
        addIgnored('evento antigo demais', orderId);
        continue;
      }

      const existingLink = await this.ifoodOrderLinkService.findByIfoodOrderId(
        orderId,
        normalizedMerchantId,
      );
      if (existingLink) {
        addIgnored('já existe', orderId);
        continue;
      }

      const readiness = await this.ifoodReadinessService.getOrderReadiness(orderId, [
        event,
      ]);
      if (!readiness?.canCreateRappidexDelivery) {
        addIgnored('status não elegível', orderId);
        continue;
      }

      try {
        const order = await this.ifoodOrdersService.getOrderDetails(
          orderId,
          normalizedMerchantId,
        );
        const orderMerchantId = String(order?.merchant?.id || '').trim();
        if (orderMerchantId !== normalizedMerchantId) {
          addIgnored('sem vínculo com a loja cadastrada', orderId);
          continue;
        }
        if (!order?.delivery?.deliveryAddress) {
          addIgnored('sem endereço válido', orderId);
          continue;
        }

        const deliveryDto = await this.ifoodOrdersService.buildCreateDeliveryDto(
          orderId,
          normalizedMerchantId,
        );
        const createdDelivery = await this.deliveryService.createDelivery(
          deliveryDto,
          {
            id: normalizedShopkeeperId,
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
          merchantId: normalizedMerchantId,
          deliveryId: createdDelivery.id,
          shopkeeperId: normalizedShopkeeperId,
        });
        imported += 1;
        this.logger.log(
          `[iFood Backfill] Pedido importado orderId=${orderId} displayId=${order?.displayId ?? ''}`,
        );
      } catch (error) {
        addIgnored('falha ao processar pedido', orderId);
      }
    }

    if (pendingAck.length > 0) {
      await this.ifoodPollingService.acknowledgeEvents(pendingAck);
      await Promise.all(
        pendingAck.map((event) =>
          this.ifoodEventService.markAsProcessed(
            { id: event.id, merchantId: event.merchantId },
            true,
          ),
        ),
      );
    }

    this.logger.log(`[iFood Backfill] Finalizado imported=${imported} ignored=${ignored}`);
    return {
      merchantId: normalizedMerchantId,
      shopkeeperId: normalizedShopkeeperId,
      eventsFound: merchantEvents.length,
      imported,
      ignored,
      ignoredByReason,
    };
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
