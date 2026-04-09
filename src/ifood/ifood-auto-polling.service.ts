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
  private readonly logger = new Logger(IfoodAutoPollingService.name);
  private intervalRef: NodeJS.Timeout | null = null;

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

    const pollingIntervalMs = Number(
      this.configService.get('IFOOD_POLLING_INTERVAL_MS') || 30000,
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

      for (const event of cancellationEvents) {
        await this.deliveryService.cancelDeliveryFromIfood(
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

      if (eventIds.length === 0) {
        return;
      }

      await this.ifoodPollingService.acknowledgeEvents(eventIds);

      for (const eventId of eventIds) {
        await this.ifoodEventService.markAsAcknowledged(eventId);
      }

      this.logger.log(
        `ACK enviado ao iFood e confirmado localmente: ${eventIds.length}`,
      );
    } catch (error: any) {
      this.logger.error(
        `Erro no polling automático do iFood: ${error?.message || error}`,
      );
    }
  }
}