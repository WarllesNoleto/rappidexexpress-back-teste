import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';

type IfoodRequestOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
  retryOnStatuses?: number[];
};

type EndpointMetrics = {
  requests: number;
  errors: number;
  status429: number;
  latencyMsTotal: number;
};

@Injectable()
export class IfoodHttpService {
  private readonly logger = new Logger(IfoodHttpService.name);
  private readonly metricsByEndpoint: Record<string, EndpointMetrics> = {};
  private static readonly DEFAULT_MAX_ATTEMPTS = 3;
  private static readonly DEFAULT_BASE_DELAY_MS = 200;
  private static readonly DEFAULT_TIMEOUT_MS = 10000;

  constructor(private readonly configService: ConfigService) {}

  async request<T = any>(
    endpoint: string,
    config: AxiosRequestConfig,
    options?: IfoodRequestOptions,
  ): Promise<AxiosResponse<T>> {
    const startedAt = Date.now();
    const maxAttempts = this.resolveMaxAttempts(endpoint, options?.maxAttempts);
    const baseDelayMs =
      options?.baseDelayMs ?? IfoodHttpService.DEFAULT_BASE_DELAY_MS;
    const timeoutMs = options?.timeoutMs ?? this.resolveTimeoutMs(endpoint);
    const retryOnStatuses = options?.retryOnStatuses ?? [429, 500, 502, 503, 504];

    let attempts = 0;
    let had429 = false;
    let latestError: any;

    while (attempts < maxAttempts) {
      attempts += 1;
      try {
        const response = await axios.request<T>({
          timeout: timeoutMs,
          ...config,
        });

        this.track(endpoint, Date.now() - startedAt, false, had429);
        this.logObservability(endpoint, attempts);
        return response;
      } catch (error: any) {
        latestError = error;
        const status = Number(error?.response?.status || 0);
        if (status === 429) {
          had429 = true;
        }

        const retryable =
          retryOnStatuses.includes(status) || (!status && attempts < maxAttempts);
        const canRetry = retryable && attempts < maxAttempts;

        if (!canRetry) {
          this.track(endpoint, Date.now() - startedAt, true, had429);
          this.logObservability(endpoint, attempts, status);
          throw error;
        }

        const backoffMs = this.computeBackoffWithJitter(baseDelayMs, attempts);
        await this.sleep(backoffMs);
      }
    }

    this.track(endpoint, Date.now() - startedAt, true, had429);
    throw latestError;
  }

  private resolveMaxAttempts(endpoint: string, override?: number) {
    if (Number.isFinite(override) && Number(override) > 0) {
      return Number(override);
    }

    const endpointKey = endpoint.toUpperCase().replace(/[^A-Z0-9]/g, '_');
    const specificRaw = Number(
      this.configService.get(`IFOOD_HTTP_MAX_ATTEMPTS_${endpointKey}`),
    );
    const defaultRaw = Number(this.configService.get('IFOOD_HTTP_MAX_ATTEMPTS'));

    if (Number.isFinite(specificRaw) && specificRaw > 0) {
      return specificRaw;
    }

    if (Number.isFinite(defaultRaw) && defaultRaw > 0) {
      return defaultRaw;
    }

    return IfoodHttpService.DEFAULT_MAX_ATTEMPTS;
  }

  private resolveTimeoutMs(endpoint: string) {
    const endpointKey = endpoint.toUpperCase().replace(/[^A-Z0-9]/g, '_');
    const specificRaw = Number(
      this.configService.get(`IFOOD_HTTP_TIMEOUT_MS_${endpointKey}`),
    );
    const defaultRaw = Number(this.configService.get('IFOOD_HTTP_TIMEOUT_MS'));

    if (Number.isFinite(specificRaw) && specificRaw > 0) {
      return specificRaw;
    }

    if (Number.isFinite(defaultRaw) && defaultRaw > 0) {
      return defaultRaw;
    }

    return IfoodHttpService.DEFAULT_TIMEOUT_MS;
  }

  private computeBackoffWithJitter(baseDelayMs: number, attempt: number) {
    const exponentialBackoff = baseDelayMs * 2 ** (attempt - 1);
    const jitter = Math.floor(Math.random() * baseDelayMs);
    return exponentialBackoff + jitter;
  }

  private track(
    endpoint: string,
    latencyMs: number,
    hasError: boolean,
    has429: boolean,
  ) {
    const current = this.metricsByEndpoint[endpoint] || {
      requests: 0,
      errors: 0,
      status429: 0,
      latencyMsTotal: 0,
    };

    current.requests += 1;
    current.latencyMsTotal += latencyMs;
    if (hasError) {
      current.errors += 1;
    }
    if (has429) {
      current.status429 += 1;
    }

    this.metricsByEndpoint[endpoint] = current;
  }

  private logObservability(endpoint: string, attempts: number, status?: number) {
    const metrics = this.metricsByEndpoint[endpoint];

    if (!metrics || metrics.requests === 0) {
      return;
    }

    const avgLatencyMs = Math.round(metrics.latencyMsTotal / metrics.requests);
    const errorRate = Number((metrics.errors / metrics.requests).toFixed(4));
    const rate429 = Number((metrics.status429 / metrics.requests).toFixed(4));
    const shouldLog =
      metrics.requests % 20 === 0 || typeof status === 'number' || attempts > 1;

    if (!shouldLog) {
      return;
    }

    const logPayload = {
      endpoint,
      attempts,
      requests: metrics.requests,
      avgLatencyMs,
      errorRate,
      rate429,
      status,
    };

    if (typeof status === 'number' && status >= 400) {
      this.logger.warn(
        `Observabilidade HTTP iFood (${endpoint})`,
        JSON.stringify(logPayload),
      );
      return;
    }

    this.logger.log(
      `Observabilidade HTTP iFood (${endpoint})`,
      JSON.stringify(logPayload),
    );
  }

  private async sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}