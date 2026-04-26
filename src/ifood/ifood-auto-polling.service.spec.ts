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
      findUnacknowledgedEvents: jest.fn().mockResolvedValue([]),
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

  it('deve enviar ACK imediato dos eventos do polling e depois reenviar pendências locais', async () => {
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
    ifoodEventService.findUnacknowledgedEvents.mockResolvedValue([
      { eventId: 'evt-2', merchantId: 'm-2' },
    ]);

    await (service as any).runPollingCycle();

    expect(ifoodPollingService.acknowledgeEvents).toHaveBeenNthCalledWith(1, [
      { id: 'evt-1', merchantId: '' },
    ]);
    expect(ifoodPollingService.acknowledgeEvents).toHaveBeenNthCalledWith(2, [
      { id: 'evt-2', merchantId: 'm-2' },
    ]);
  });

  it('deve deduplicar eventos no ACK imediato do polling', async () => {
    const pollingEvents = [
      { id: 'evt-1', orderId: 'o-1', code: 'CON' },
      { id: 'evt-1', orderId: 'o-1', code: 'CON' },
    ];
    const { service, ifoodPollingService } = buildService({
      pollingResult: {
        events: pollingEvents,
        metadata: {
          maxMerchantsPerBatch: 2,
        },
      },
    });

    await (service as any).runPollingCycle();

    expect(ifoodPollingService.acknowledgeEvents).toHaveBeenCalledWith([
      { id: 'evt-1', merchantId: '' },
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
    ifoodEventService.findUnacknowledgedEvents.mockResolvedValueOnce([
      { eventId: 'evt-retry', merchantId: '' },
    ]);
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
      { id: 'evt-retry', merchantId: '' },
    ]);
    expect(ifoodPollingService.acknowledgeEvents).toHaveBeenNthCalledWith(2, [
      { id: 'evt-retry', merchantId: '' },
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

  it('não deve alertar quando intervalo efetivo estiver dentro da tolerância de 2000ms', async () => {
    const { service } = buildService();
    const loggerErrorSpy = jest
      .spyOn((service as any).logger, 'error')
      .mockImplementation(() => undefined);
    (service as any).lastCycleStartedAt = 1000;
    const dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(32000);

    await (service as any).runPollingCycle();

    expect(loggerErrorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('intervalo efetivo de polling acima do limite'),
    );

    loggerErrorSpy.mockRestore();
    dateNowSpy.mockRestore();
  });

  it('deve alertar quando intervalo efetivo ultrapassar tolerância de 2000ms', async () => {
    const { service } = buildService();
    const loggerErrorSpy = jest
      .spyOn((service as any).logger, 'error')
      .mockImplementation(() => undefined);
    (service as any).lastCycleStartedAt = 1000;
    const dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(33001);

    await (service as any).runPollingCycle();

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('(32001ms > 32000ms)'),
    );

    loggerErrorSpy.mockRestore();
    dateNowSpy.mockRestore();
  });

  it('deve aplicar fallback de ACK por lotes quando deadline for excedido', async () => {
    const { service, ifoodPollingService } = buildService({
      config: {
        IFOOD_ACK_DEADLINE_MS: 5,
      },
      pollingResult: {
        events: [{ id: 'evt-timeout', orderId: 'o-timeout', code: 'CON' }],
        metadata: {
          maxMerchantsPerBatch: 1,
        },
      },
    });

    ifoodPollingService.acknowledgeEvents
      .mockImplementationOnce(() => new Promise(() => undefined))
      .mockResolvedValueOnce(undefined);

    await (service as any).runPollingCycle();

    expect(ifoodPollingService.acknowledgeEvents).toHaveBeenNthCalledWith(1, [
      { id: 'evt-timeout', merchantId: '' },
    ]);
    expect(ifoodPollingService.acknowledgeEvents).toHaveBeenNthCalledWith(2, [
      { id: 'evt-timeout', merchantId: '' },
    ]);
  });
});