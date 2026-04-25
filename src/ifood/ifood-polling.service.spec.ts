import { IfoodPollingService } from './ifood-polling.service';

describe('IfoodPollingService', () => {
  const buildService = (config?: Record<string, any>) => {
    const ifoodAuthService = {
      resolveAuthContext: jest.fn().mockResolvedValue({
        cacheKey: 'profile:default',
        profileKey: 'default',
        source: 'profile',
        merchantId: 'merchant-1',
      }),
      getAccessToken: jest.fn().mockResolvedValue('token-123'),
    } as any;
    const ifoodHttpService = {
      request: jest.fn().mockResolvedValue({ data: [] }),
    } as any;
    const configService = {
      get: jest.fn((key: string) => config?.[key]),
    } as any;
    const userRepository = {
      find: jest.fn().mockResolvedValue([]),
    } as any;

    const service = new IfoodPollingService(
      ifoodAuthService,
      ifoodHttpService,
      configService,
      userRepository,
    );

    return {
      service,
      ifoodAuthService,
      ifoodHttpService,
    };
  };

  it('deve enviar polling com excludeHeartbeat e header x-polling-merchants', async () => {
    const { service, ifoodHttpService } = buildService({
      IFOOD_POLLING_MERCHANTS: 'merchant-1',
      IFOOD_POLLING_TYPES: 'CON,DSP',
      IFOOD_POLLING_GROUPS: 'ORDER,DELIVERY',
    });

    await service.pollEventsWithMetadata();

    expect(ifoodHttpService.request).toHaveBeenCalledWith(
      'events_polling',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          'x-polling-merchants': 'merchant-1',
        }),
        params: expect.objectContaining({
          excludeHeartbeat: true,
          types: 'CON,DSP',
          groups: 'ORDER,DELIVERY',
        }),
      }),
    );
  });
});