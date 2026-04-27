import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { DeliveryService } from '../delivery/delivery.service';
import { IfoodEventService } from './ifood-event.service';
import { IfoodImportService } from './ifood-import.service';

@Injectable()
export class IfoodWebhookService {
  private readonly logger = new Logger(IfoodWebhookService.name);
  private processingQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly ifoodEventService: IfoodEventService,
    private readonly ifoodImportService: IfoodImportService,
    @Inject(forwardRef(() => DeliveryService))
    private readonly deliveryService: DeliveryService,
  ) {}

  enqueueIncomingEvents(events: any[]) {
    const payload = Array.isArray(events) ? events : [];

    const previous = this.processingQueue;
    let release: () => void = () => undefined;

    this.processingQueue = new Promise<void>((resolve) => {
      release = resolve;
    });

    void previous
      .then(async () => {
        await this.processIncomingEvents(payload);
      })
      .catch((error: any) => {
        this.logger.error(
          `Falha ao processar fila de webhook do iFood: ${error?.message || error}`,
        );
      })
      .finally(() => {
        release();
      });
  }

  private async processIncomingEvents(events: any[]) {
    const normalizedEvents = events.filter((event) => Boolean(event?.id));

    if (normalizedEvents.length === 0) {
      return;
    }

    const freshEvents: any[] = [];

    for (const event of normalizedEvents) {
      const eventId = String(event?.id || '').trim();

      if (!eventId) {
        continue;
      }

      const existingEvent = await this.ifoodEventService.findByEventId(eventId);

      if (existingEvent) {
        continue;
      }

      await this.ifoodEventService.markAsProcessed(event, true);
      freshEvents.push(event);
    }

    if (freshEvents.length === 0) {
      return;
    }

    const cancellationEvents = freshEvents.filter(
      (event) =>
        event?.code === 'CAN' ||
        event?.fullCode === 'CANCELLED' ||
        event?.code === 'CAR' ||
        event?.fullCode === 'CANCELLATION_REQUESTED',
    );

    const conclusionEvents = freshEvents.filter(
      (event) => event?.code === 'CON' || event?.fullCode === 'CONCLUDED',
    );

    const dropCodeRequestedEvents = freshEvents.filter(
      (event) => event?.fullCode === 'DELIVERY_DROP_CODE_REQUESTED',
    );

    for (const event of dropCodeRequestedEvents) {
      this.logger.log(
        `Evento DELIVERY_DROP_CODE_REQUESTED recebido via webhook. OrderId: ${event?.orderId}. MerchantId: ${event?.merchantId || 'N/A'}.`,
      );
    }

    for (const event of cancellationEvents) {
      await this.deliveryService.cancelDeliveryFromIfood(event.orderId, event);
    }

    for (const event of conclusionEvents) {
      await this.deliveryService.finishDeliveryFromIfood(event.orderId, event);
    }

    await this.ifoodImportService.importFromEvents(freshEvents);

    this.logger.log(
      `Webhook iFood processado. Eventos recebidos: ${events.length}. Eventos novos: ${freshEvents.length}.`,
    );
  }
}