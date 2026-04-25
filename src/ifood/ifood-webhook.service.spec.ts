jest.mock('../delivery/delivery.service', () => ({
  DeliveryService: class DeliveryServiceMock {},
}));

import { IfoodWebhookService } from './ifood-webhook.service';

describe('IfoodWebhookService', () => {
  const buildService = () => {
    const ifoodEventService = {
      findByEventId: jest.fn().mockResolvedValue(null),
      markAsProcessed: jest.fn().mockResolvedValue(undefined),
    } as any;

    const ifoodImportService = {
      importFromEvents: jest.fn().mockResolvedValue(undefined),
    } as any;

    const deliveryService = {
      cancelDeliveryFromIfood: jest.fn().mockResolvedValue(undefined),
      finishDeliveryFromIfood: jest.fn().mockResolvedValue(undefined),
    } as any;

    const service = new IfoodWebhookService(
      ifoodEventService,
      ifoodImportService,
      deliveryService,
    );

    return {
      service,
      ifoodEventService,
      ifoodImportService,
      deliveryService,
    };
  };

  it('deve persistir evento novo do webhook como acknowledged', async () => {
    const { service, ifoodEventService, ifoodImportService } = buildService();

    service.enqueueIncomingEvents([
      { id: 'evt-1', orderId: 'order-1', fullCode: 'READY_TO_PICKUP' },
    ]);

    await (service as any).processingQueue;

    expect(ifoodEventService.markAsProcessed).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'evt-1' }),
      true,
    );
    expect(ifoodImportService.importFromEvents).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 'evt-1' })]),
    );
  });

  it('não deve reprocessar evento duplicado', async () => {
    const { service, ifoodEventService, ifoodImportService } = buildService();

    ifoodEventService.findByEventId.mockResolvedValueOnce({ eventId: 'evt-dup' });

    service.enqueueIncomingEvents([{ id: 'evt-dup', orderId: 'order-2' }]);

    await (service as any).processingQueue;

    expect(ifoodEventService.markAsProcessed).not.toHaveBeenCalled();
    expect(ifoodImportService.importFromEvents).not.toHaveBeenCalled();
  });
});