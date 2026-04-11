import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeliveryService } from '../delivery/delivery.service';
import { IfoodEventService } from './ifood-event.service';
import { IfoodImportService } from './ifood-import.service';
import { IfoodOrderLinkService } from './ifood-order-link.service';
import { IfoodOrdersService } from './ifood-orders.service';
import { IfoodPollingService } from './ifood-polling.service';

@Injectable()
export class IfoodAutoPollingService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(IfoodAutoPollingService.name);
  private intervalRef: NodeJS.Timeout | null = null;
    private isRunning = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly ifoodPollingService: IfoodPollingService,
    private readonly ifoodOrdersService: IfoodOrdersService,
    private readonly ifoodOrderLinkService: IfoodOrderLinkService,
    private readonly ifoodImportService: IfoodImportService,
    private readonly ifoodEventService: IfoodEventService,
    @Inject(forwardRef(() => DeliveryService))
    private readonly deliveryService: DeliveryService,
  ) {}

  async onModuleInit() {
    const pollingEnabled =
      String(this.configService.get('IFOOD_POLLING_ENABLED')) === 'true';

    const pollingIntervalMs = Number(
      this.configService.get('IFOOD_POLLING_INTERVAL_MS') || 45000,
    );

    if (!pollingEnabled) {
      this.logger.warn('Polling automático do iFood está desativado.');
      return;
    }

    this.logger.log(
      `Polling automático do iFood ativado a cada ${pollingIntervalMs}ms.`,
    );

    await this.runPollingCycle();

    this.intervalRef = setInterval(async () => {
      await this.runPollingCycle();
    }, pollingIntervalMs);
  }

  onModuleDestroy() {
    if (this.intervalRef) {
      clearInterval(this.intervalRef);
      this.intervalRef = null;
    }
  }

  private async runPollingCycle() {
    if (this.isRunning) {
      this.logger.warn(
        'Ciclo automático do iFood ainda em execução. Novo ciclo ignorado para preservar idempotência.',
      );
      return;
    }

    this.isRunning = true;

    try {
      const events = await this.ifoodPollingService.pollEvents();
      const allEvents = Array.isArray(events) ? events : [];

      this.logger.log(
        `Polling executado com sucesso. Eventos encontrados: ${allEvents.length}`,
      );

      const freshEvents: any[] = [];
      const pendingAckEvents: any[] = [];

      for (const event of allEvents) {
        if (!event?.id) {
          continue;
        }

        const existingEvent = await this.ifoodEventService.findByEventId(
          event.id,
        );

        if (!existingEvent) {
          freshEvents.push(event);
          continue;
        }

        if (!existingEvent.acknowledged) {
          pendingAckEvents.push(event);
        }
      }

      this.logger.log(
        `Eventos novos para processar neste ciclo: ${freshEvents.length}`,
      );

      this.logger.log(
        `Eventos pendentes de ACK neste ciclo: ${pendingAckEvents.length}`,
      );

      const cancellationEvents = freshEvents.filter(
        (event) =>
          event?.code === 'CAN' || event?.fullCode === 'CANCELLED',
      );

      const conclusionEvents = freshEvents.filter(
        (event) =>
          event?.code === 'CON' || event?.fullCode === 'CONCLUDED',
      );

      for (const event of cancellationEvents) {
        await this.deliveryService.cancelDeliveryFromIfood(
          event.orderId,
          event,
        );
      }

      for (const event of conclusionEvents) {
        await this.deliveryService.finishDeliveryFromIfood(
          event.orderId,
          event,
        );
      }

      if (freshEvents.length > 0) {
        await this.ifoodImportService.importFromEvents(freshEvents);

        for (const event of freshEvents) {
          await this.ifoodEventService.markAsProcessed(event);
        }
      }

      const ackEvents = [...freshEvents, ...pendingAckEvents];

      const eventIds = [
        ...new Set(ackEvents.map((event) => event?.id).filter(Boolean)),
      ];

      if (eventIds.length > 0) {
        await this.ifoodPollingService.acknowledgeEvents(eventIds);

        for (const eventId of eventIds) {
          await this.ifoodEventService.markAsAcknowledged(eventId);
        }

      this.logger.log(
          `ACK enviado ao iFood e confirmado localmente: ${eventIds.length}`,
        );
      }

      await this.runStatusReconciliation(allEvents);
    } catch (error: any) {
      this.logger.error(
        `Erro no polling automático do iFood: ${error?.message || error}`,
      );
      } finally {
      this.isRunning = false;
    }
  }

  private async runStatusReconciliation(latestPolledEvents: any[]) {
    const lookbackMinutes = Number(
      this.configService.get('IFOOD_RECONCILIATION_LOOKBACK_MINUTES') || 180,
    );

    const staleThresholdMinutes = Number(
      this.configService.get('IFOOD_STALE_ORDER_ALERT_MINUTES') || 20,
    );

    const recentOrderIdsFromDb = await this.ifoodEventService.findRecentOrderIds(
      lookbackMinutes,
      1200,
    );

    const polledOrderIds = (Array.isArray(latestPolledEvents)
      ? latestPolledEvents
      : []
    )
      .map((event) => event?.orderId)
      .filter(Boolean);

    const candidateOrderIds = [
      ...new Set([...recentOrderIdsFromDb, ...polledOrderIds]),
    ];

    if (candidateOrderIds.length === 0) {
      return;
    }

    const links = await this.ifoodEventSafeLinks(candidateOrderIds);

    if (links.length === 0) {
      return;
    }

    for (const link of links) {
      await this.reconcileSingleOrder(link.ifoodOrderId);
    }

    await this.emitStaleOrderAlerts(
      links.map((link) => link.ifoodOrderId),
      staleThresholdMinutes,
    );
  }

  private async ifoodEventSafeLinks(orderIds: string[]) {
    try {
      return await this.ifoodOrderLinkService.findByIfoodOrderIds(orderIds);
    } catch (error: any) {
      this.logger.warn(
        `Falha ao buscar vínculos de pedidos na reconciliação automática: ${error?.message || error}`,
      );
      return [];
    }
  }

  private async reconcileSingleOrder(orderId: string) {
    try {
      const order = await this.ifoodOrdersService.getOrderDetails(orderId);
      const remoteStatus = this.normalizeIfoodStatus(order);

      if (!remoteStatus) {
        return;
      }

      if (remoteStatus === 'CANCELED') {
        await this.deliveryService.cancelDeliveryFromIfood(orderId, {
          code: 'CAN',
          fullCode: 'CANCELLED',
          origin: 'RECONCILIATION',
        });
        return;
      }

      if (remoteStatus === 'FINISHED') {
        await this.deliveryService.finishDeliveryFromIfood(orderId, {
          code: 'CON',
          fullCode: 'CONCLUDED',
          origin: 'RECONCILIATION',
        });
      }
    } catch (error: any) {
      this.logger.warn(
        `Reconciliação: falha ao reconciliar pedido ${orderId}: ${error?.message || error}`,
      );
    }
  }

  private normalizeIfoodStatus(order: any): 'CANCELED' | 'FINISHED' | null {
    const status = String(
      order?.orderStatus ?? order?.status ?? order?.metadata?.status ?? '',
    )
      .trim()
      .toUpperCase();

    if (!status) {
      return null;
    }

    if (status.includes('CANCEL')) {
      return 'CANCELED';
    }

    if (
      status.includes('CONCLUDED') ||
      status.includes('DELIVERED') ||
      status.includes('FINISHED')
    ) {
      return 'FINISHED';
    }

    return null;
  }

  private async emitStaleOrderAlerts(
    orderIds: string[],
    staleThresholdMinutes: number,
  ) {
    const links = await this.ifoodOrderLinkService.findByIfoodOrderIds(orderIds);

    if (links.length === 0) {
      return;
    }

    const deliveryIds = links.map((link) => link.deliveryId).filter(Boolean);
    const activeDeliveries = await this.deliveryService.findActiveDeliveriesByIds(
      deliveryIds,
    );

    if (activeDeliveries.length === 0) {
      return;
    }

    const orderIdByDeliveryId = new Map(
      links.map((link) => [link.deliveryId, link.ifoodOrderId]),
    );

    const latestEventByOrder =
      await this.ifoodEventService.findLatestProcessedAtByOrderIds(orderIds);

    const now = Date.now();
    const thresholdMs = staleThresholdMinutes * 60 * 1000;

    for (const delivery of activeDeliveries) {
      const orderId = orderIdByDeliveryId.get(delivery.id);

      if (!orderId) {
        continue;
      }

      const lastEventAt = latestEventByOrder.get(orderId);
      const fallbackUpdatedAt = delivery.updatedAt
        ? new Date(delivery.updatedAt)
        : null;

      const lastReferenceDate = lastEventAt || fallbackUpdatedAt;

      if (!lastReferenceDate) {
        continue;
      }

      const elapsedMs = now - lastReferenceDate.getTime();

      if (elapsedMs < thresholdMs) {
        continue;
      }

      const elapsedMinutes = Math.floor(elapsedMs / 60000);

      this.logger.warn(
        `ALERTA IFOOD_STALE_ORDER: pedido ${orderId} (delivery ${delivery.id}) está há ${elapsedMinutes} minuto(s) sem atualização. Limite configurado: ${staleThresholdMinutes} minuto(s).`,
      );
    }
  }
}