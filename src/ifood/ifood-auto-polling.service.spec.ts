jest.mock('../delivery/delivery.service', () => ({
  DeliveryService: class DeliveryServiceMock {},
}));

import { IfoodAutoPollingService } from './ifood-auto-polling.service';

describe('IfoodAutoPollingService', () => {
  const buildService = (overrides?: {
    config?: Record<string, any>;
    pollingResult?: any;
  }) => {
    const config = overrides?.config ?? {};
    const pollingResult = overrides?.pollingResult ?? {
      events: [],
      metadata: {
        maxMerchantsPerBatch: 1,
      },
    };

    const configService = {
      get: jest.fn((key: string) => config[key]),
    } as any;
    const ifoodPollingService = {
      pollEventsWithMetadata: jest.fn().mockResolvedValue(pollingResult),
      acknowledgeEvents: jest.fn().mockResolvedValue(undefined),
    } as any;
    const ifoodImportService = {
      importFromEvents: jest.fn().mockResolvedValue(undefined),
    } as any;
    const ifoodEventService = {
      findByEventId: jest.fn().mockResolvedValue(null),
      markAsProcessed: jest.fn().mockResolvedValue(undefined),
      markAsAcknowledged: jest.fn().mockResolvedValue(undefined),
      findUnacknowledgedEventIds: jest.fn().mockResolvedValue([]),
    } as any;
    const deliveryService = {
      cancelDeliveryFromIfood: jest.fn().mockResolvedValue(undefined),
      finishDeliveryFromIfood: jest.fn().mockResolvedValue(undefined),
    } as any;

    const service = new IfoodAutoPollingService(
      configService,
      ifoodPollingService,
      ifoodImportService,
      ifoodEventService,
      deliveryService,
    );

    return {
      service,
      configService,
      ifoodPollingService,
      ifoodImportService,
      ifoodEventService,
      deliveryService,
    };
  };

  it('deve limitar intervalo para 30000ms em produção quando configuração exceder limite', async () => {
    const { service } = buildService({
      config: {
        IFOOD_POLLING_ENABLED: 'true',
        IFOOD_POLLING_INTERVAL_MS: '30000',
        NODE_ENV: 'production',
      },
    });

    const setIntervalSpy = jest
      .spyOn(global, 'setInterval')
      .mockImplementation((handler: any) => {
        void handler();
        return 1 as any;
      });
    const clearIntervalSpy = jest
      .spyOn(global, 'clearInterval')
      .mockImplementation(() => undefined);

    await service.onModuleInit();

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 30000);
    service.onModuleDestroy();

    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });

  it('deve deduplicar ACK e incluir eventos locais pendentes para retry', async () => {
    const pollingEvents = [
      { id: 'evt-1', orderId: 'o-1', code: 'CON' },
      { id: 'evt-1', orderId: 'o-1', code: 'CON' },
    ];
    const { service, ifoodPollingService, ifoodEventService } = buildService({
      pollingResult: {
        events: pollingEvents,
        metadata: {
          maxMerchantsPerBatch: 2,
        },
      },
    });
    ifoodEventService.findUnacknowledgedEventIds.mockResolvedValue(['evt-2']);

    await (service as any).runPollingCycle();

    expect(ifoodPollingService.acknowledgeEvents).toHaveBeenCalledWith([
      'evt-1',
      'evt-2',
    ]);
  });

  it('deve tentar novamente o ACK em ciclo seguinte quando o ACK anterior falhar', async () => {
    const { service, ifoodPollingService, ifoodEventService } = buildService({
      pollingResult: {
        events: [{ id: 'evt-retry', orderId: 'o-2', code: 'CON' }],
        metadata: {
          maxMerchantsPerBatch: 1,
        },
      },
    });

    ifoodPollingService.acknowledgeEvents
      .mockRejectedValueOnce({ ifoodStatus: 429, message: 'rate limited' })
      .mockResolvedValueOnce(undefined);
    ifoodEventService.findUnacknowledgedEventIds
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(['evt-retry']);
    ifoodPollingService.pollEventsWithMetadata
      .mockResolvedValueOnce({
        events: [{ id: 'evt-retry', orderId: 'o-2', code: 'CON' }],
        metadata: { maxMerchantsPerBatch: 1 },
      })
      .mockResolvedValueOnce({
        events: [],
        metadata: { maxMerchantsPerBatch: 1 },
      });

    await (service as any).runPollingCycle();
    await (service as any).runPollingCycle();

    expect(ifoodPollingService.acknowledgeEvents).toHaveBeenNthCalledWith(1, [
      'evt-retry',
    ]);
    expect(ifoodPollingService.acknowledgeEvents).toHaveBeenNthCalledWith(2, [
      'evt-retry',
    ]);
  });

  it('deve cancelar entrega local também para evento CANCELLATION_REQUESTED', async () => {
    const { service, deliveryService } = buildService({
      pollingResult: {
        events: [
          {
            id: 'evt-car',
            orderId: 'order-car',
            code: 'CAR',
            fullCode: 'CANCELLATION_REQUESTED',
          },
        ],
        metadata: {
          maxMerchantsPerBatch: 1,
        },
      },
    });

    await (service as any).runPollingCycle();

    expect(deliveryService.cancelDeliveryFromIfood).toHaveBeenCalledWith(
      'order-car',
      expect.objectContaining({
        id: 'evt-car',
        code: 'CAR',
        fullCode: 'CANCELLATION_REQUESTED',
      }),
    );
  });
});