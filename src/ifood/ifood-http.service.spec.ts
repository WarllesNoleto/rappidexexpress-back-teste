import axios from 'axios';
import { IfoodHttpService } from './ifood-http.service';

jest.mock('axios');

describe('IfoodHttpService', () => {
  const mockedAxios = axios as jest.Mocked<typeof axios>;

  const buildService = (config?: Record<string, any>) => {
    const configService = {
      get: jest.fn((key: string) => config?.[key]),
    } as any;

    return new IfoodHttpService(configService);
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('deve aplicar retry exponencial com jitter para 429/5xx', async () => {
    const service = buildService({ IFOOD_HTTP_MAX_ATTEMPTS: 3 });

    mockedAxios.request
      .mockRejectedValueOnce({ response: { status: 429 } } as any)
      .mockRejectedValueOnce({ response: { status: 503 } } as any)
      .mockResolvedValueOnce({ data: { ok: true }, status: 200 } as any);

    const sleepSpy = jest
      .spyOn(service as any, 'sleep')
      .mockResolvedValue(undefined as never);

    const response = await service.request('events_polling', {
      method: 'GET',
      url: 'https://merchant-api.ifood.com.br/events/v1.0/events:polling',
    });

    expect(response.data).toEqual({ ok: true });
    expect(mockedAxios.request).toHaveBeenCalledTimes(3);
    expect(sleepSpy).toHaveBeenCalledTimes(2);
  });

  it('deve respeitar limite de tentativas por endpoint', async () => {
    const service = buildService({ IFOOD_HTTP_MAX_ATTEMPTS_EVENTS_POLLING: 2 });

    mockedAxios.request
      .mockRejectedValueOnce({ response: { status: 500 } } as any)
      .mockRejectedValueOnce({ response: { status: 500 } } as any);

    const sleepSpy = jest
      .spyOn(service as any, 'sleep')
      .mockResolvedValue(undefined as never);

    await expect(
      service.request('events_polling', {
        method: 'GET',
        url: 'https://merchant-api.ifood.com.br/events/v1.0/events:polling',
      }),
    ).rejects.toEqual(expect.objectContaining({ response: { status: 500 } }));

    expect(mockedAxios.request).toHaveBeenCalledTimes(2);
    expect(sleepSpy).toHaveBeenCalledTimes(1);
  });

  it('deve aplicar controle de rate limit por endpoint a cada tentativa', async () => {
    const service = buildService({ IFOOD_HTTP_MAX_ATTEMPTS: 2 });

    mockedAxios.request
      .mockRejectedValueOnce({ response: { status: 429 } } as any)
      .mockResolvedValueOnce({ data: { ok: true }, status: 200 } as any);

    const rateLimitSpy = jest
      .spyOn(service as any, 'waitForEndpointRateLimit')
      .mockResolvedValue(undefined as never);
    const sleepSpy = jest
      .spyOn(service as any, 'sleep')
      .mockResolvedValue(undefined as never);

    await service.request('events_polling', {
      method: 'GET',
      url: 'https://merchant-api.ifood.com.br/events/v1.0/events:polling',
    });

    expect(rateLimitSpy).toHaveBeenCalledTimes(2);
    expect(rateLimitSpy).toHaveBeenNthCalledWith(1, 'events_polling');
    expect(rateLimitSpy).toHaveBeenNthCalledWith(2, 'events_polling');
    expect(sleepSpy).toHaveBeenCalledTimes(1);
  });
});