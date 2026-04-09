import { Injectable } from '@nestjs/common';
import { IfoodEventService } from './ifood-event.service';
import { IfoodOrdersService } from './ifood-orders.service';
import { IfoodPollingService } from './ifood-polling.service';

@Injectable()
export class IfoodReadinessService {
  constructor(
    private readonly ifoodOrdersService: IfoodOrdersService,
    private readonly ifoodPollingService: IfoodPollingService,
    private readonly ifoodEventService: IfoodEventService,
  ) {}

  async getOrderReadiness(orderId: string, knownEvents: any[] = []) {
    const orderAnalysis = await this.ifoodOrdersService.analyzeOrder(orderId);
    const storedEvents = await this.ifoodEventService.findByOrderId(orderId);

    let polledEvents: any[] = [];

    if (!Array.isArray(knownEvents) || knownEvents.length === 0) {
      const events = await this.ifoodPollingService.pollEvents();
      polledEvents = Array.isArray(events)
        ? events.filter((event) => event?.orderId === orderId)
        : [];
    }

    const filteredEvents = [...knownEvents, ...storedEvents, ...polledEvents]
      .filter((event) => event?.orderId === orderId)
      .reduce((acc: any[], event: any) => {
        const eventId = event?.id || event?.eventId;

        if (
          eventId &&
          acc.some(
            (currentEvent) =>
              (currentEvent?.id || currentEvent?.eventId) === eventId,
          )
        ) {
          return acc;
        }

        acc.push(event);
        return acc;
      }, []);

    const hasCancelledEvent = filteredEvents.some(
      (event) =>
        event?.code === 'CAN' ||
        event?.fullCode === 'CANCELLED' ||
        event?.code === 'CAR' ||
        event?.fullCode === 'CANCELLATION_REQUESTED',
    );

    const hasEligibleImportEvent = filteredEvents.some(
      (event) =>
        event?.code === 'RTP' ||
        event?.fullCode === 'READY_TO_PICKUP' ||
        event?.code === 'DSP' ||
        event?.fullCode === 'DISPATCHED',
    );

    const latestEvent =
      filteredEvents.length > 0
        ? [...filteredEvents].sort(
            (a, b) =>
              new Date(b?.createdAt || 0).getTime() -
              new Date(a?.createdAt || 0).getTime(),
          )[0]
        : null;

    const canCreateRappidexDelivery =
      !!orderAnalysis?.canCreateRappidexDelivery &&
      !hasCancelledEvent &&
      hasEligibleImportEvent;

    return {
      success: true,
      orderId,
      summary: orderAnalysis.summary,
      eventSummary: {
        totalEvents: filteredEvents.length,
        latestEventCode: latestEvent?.code ?? null,
        latestEventFullCode: latestEvent?.fullCode ?? null,
        hasCancelledEvent,
        hasEligibleImportEvent,
      },
      canCreateRappidexDelivery,
      reason: hasCancelledEvent
        ? 'Pedido não pode virar entrega no Rappidex porque já possui evento de cancelamento.'
        : !hasEligibleImportEvent
        ? 'Pedido ainda não possui evento elegível para importação. Aguarde RTP ou DSP.'
        : canCreateRappidexDelivery
        ? 'Pedido apto para virar entrega no Rappidex.'
        : 'Pedido não está apto para virar entrega no Rappidex.',
    };
  }
}