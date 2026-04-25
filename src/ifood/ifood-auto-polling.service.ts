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
import { IfoodPollingService } from './ifood-polling.service';

@Injectable()
export class IfoodAutoPollingService
  implements OnModuleInit, OnModuleDestroy
{
  private static readonly DEFAULT_INTERVAL_MS = 30000;
  private static readonly MAX_PRODUCTION_INTERVAL_MS = 30000;
  private readonly logger = new Logger(IfoodAutoPollingService.name);
  private intervalRef: NodeJS.Timeout | null = null;
  private lastCycleStartedAt: number | null = null;
  private metrics = {
    eventsReceived: 0,
    eventsAcked: 0,
    pollingToAckMs: [] as number[],
    errors429: 0,
    errors403: 0,
    errors400: 0,
  };

  constructor(
    private readonly configService: ConfigService,
    private readonly ifoodPollingService: IfoodPollingService,
    private readonly ifoodImportService: IfoodImportService,
    private readonly ifoodEventService: IfoodEventService,
    @Inject(forwardRef(() => DeliveryService))
    private readonly deliveryService: DeliveryService,
  ) {}

  async onModuleInit() {
    const pollingEnabled =
      String(this.configService.get('IFOOD_POLLING_ENABLED')) === 'true';

    const pollingIntervalMs = this.resolvePollingIntervalMs();

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
    const cycleStartedAt = Date.now();

    if (this.lastCycleStartedAt) {
      const effectiveIntervalMs = cycleStartedAt - this.lastCycleStartedAt;
      if (effectiveIntervalMs > IfoodAutoPollingService.MAX_PRODUCTION_INTERVAL_MS) {
        this.logger.error(
          `ALERTA: intervalo efetivo de polling acima do limite (${effectiveIntervalMs}ms > ${IfoodAutoPollingService.MAX_PRODUCTION_INTERVAL_MS}ms).`,
        );
      }
    }

    this.lastCycleStartedAt = cycleStartedAt;

    try {
      const { events, metadata } =
        await this.ifoodPollingService.pollEventsWithMetadata();
      const allEvents = Array.isArray(events) ? events : [];
      this.metrics.eventsReceived += allEvents.length;

      this.logger.log(
        `Polling executado com sucesso. Eventos encontrados: ${allEvents.length}`,
      );

      if (
        metadata?.maxMerchantsPerBatch >
        100
      ) {
        this.logger.error(
          `ALERTA: lote com merchants acima do limite por request (${metadata.maxMerchantsPerBatch} > 100).`,
        );
      }

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
          event?.code === 'CAN' ||
          event?.fullCode === 'CANCELLED' ||
          event?.code === 'CAR' ||
          event?.fullCode === 'CANCELLATION_REQUESTED',
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

      const localPendingAckEventIds =
        await this.ifoodEventService.findUnacknowledgedEventIds();
      const ackEvents = [...freshEvents, ...pendingAckEvents];

      const eventIds = [
        ...new Set(ackEvents.map((event) => event?.id).filter(Boolean)),
        ...localPendingAckEventIds,
      ];

      if (eventIds.length === 0) {
        return;
      }

      await this.ifoodPollingService.acknowledgeEvents(eventIds);
      this.metrics.eventsAcked += eventIds.length;
      this.metrics.pollingToAckMs.push(Date.now() - cycleStartedAt);

      for (const eventId of eventIds) {
        await this.ifoodEventService.markAsAcknowledged(eventId);
      }

      this.logger.log(
        `ACK enviado ao iFood e confirmado localmente: ${eventIds.length}`,
      );
      
      this.logObservabilitySnapshot();
    } catch (error: any) {
      this.captureHttpErrorMetrics(error);
      this.logger.error(
        `Erro no polling automático do iFood: ${error?.message || error}`,
      );
    }
  }

  private resolvePollingIntervalMs() {
    const rawInterval = Number(
      this.configService.get('IFOOD_POLLING_INTERVAL_MS') ??
        IfoodAutoPollingService.DEFAULT_INTERVAL_MS,
    );
    const intervalMs = Number.isFinite(rawInterval) && rawInterval > 0
      ? rawInterval
      : IfoodAutoPollingService.DEFAULT_INTERVAL_MS;
    const nodeEnv = String(this.configService.get('NODE_ENV') ?? '').toLowerCase();
    const isProduction = nodeEnv === 'production';

    if (
      isProduction &&
      intervalMs > IfoodAutoPollingService.MAX_PRODUCTION_INTERVAL_MS
    ) {
      this.logger.error(
        `IFOOD_POLLING_INTERVAL_MS=${intervalMs} excede o máximo permitido em produção (${IfoodAutoPollingService.MAX_PRODUCTION_INTERVAL_MS}ms). Aplicando fallback.`,
      );

      return IfoodAutoPollingService.MAX_PRODUCTION_INTERVAL_MS;
    }

    return intervalMs;
  }

  private captureHttpErrorMetrics(error: any) {
    const status = error?.response?.status;

    if (status === 429) {
      this.metrics.errors429 += 1;
    }

    if (status === 403) {
      this.metrics.errors403 += 1;
    }

    if (status === 400) {
      this.metrics.errors400 += 1;
    }
  }

  private logObservabilitySnapshot() {
    const avgPollingToAckMs =
      this.metrics.pollingToAckMs.length > 0
        ? Math.round(
            this.metrics.pollingToAckMs.reduce((sum, value) => sum + value, 0) /
              this.metrics.pollingToAckMs.length,
          )
        : 0;
    const ackRatio = this.metrics.eventsReceived
      ? this.metrics.eventsAcked / this.metrics.eventsReceived
      : 1;

    this.logger.log(
      `Métricas iFood polling: recebidos=${this.metrics.eventsReceived} ack=${this.metrics.eventsAcked} avgPollingToAckMs=${avgPollingToAckMs} erros(429/403/400)=${this.metrics.errors429}/${this.metrics.errors403}/${this.metrics.errors400}`,
    );

    if (ackRatio < 1) {
      this.logger.error(
        `ALERTA: taxa de ACK abaixo de 100% (${(ackRatio * 100).toFixed(2)}%).`,
      );
    }
  }
}