import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { MongoRepository } from 'typeorm';
import axios from 'axios';
import { UserEntity } from '../database/entities';
import { IfoodAuthService } from './ifood-auth.service';

@Injectable()
export class IfoodPollingService {
  private readonly logger = new Logger(IfoodPollingService.name);
  private static readonly MAX_MERCHANTS_PER_POLLING_REQUEST = 100;
  private static readonly DEFAULT_BATCH_DELAY_MS = 250;
  private pollingQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly ifoodAuthService: IfoodAuthService,
    private readonly configService: ConfigService,
    @InjectRepository(UserEntity)
    private readonly userRepository: MongoRepository<UserEntity>,
  ) {}

  async pollEvents() {
    const { events } = await this.pollEventsWithMetadata();
    return events;
  }

  async pollEventsWithMetadata() {
    return this.withTokenRateLimit(async () => {
      const merchantIds = await this.resolvePollingMerchants();

      if (!Array.isArray(merchantIds) || merchantIds.length === 0) {
        throw new InternalServerErrorException(
          'Configure IFOOD_POLLING_MERCHANTS, IFOOD_TEST_MERCHANT_ID ou IFOOD_MERCHANT_ID no .env.',
        );
      }

      const merchantAuthContexts = await Promise.all(
        merchantIds.map(async (merchantId) => ({
          merchantId,
          authContext: await this.ifoodAuthService.resolveAuthContext({
            merchantId,
          }),
        })),
      );
      
      const merchantsByAuthContext = merchantAuthContexts.reduce(
        (acc, entry) => {
          if (!acc[entry.authContext.cacheKey]) {
            acc[entry.authContext.cacheKey] = {
              authContext: entry.authContext,
              merchants: [],
            };
          }

          acc[entry.authContext.cacheKey].merchants.push(entry.merchantId);
          return acc;
        },
        {} as Record<
          string,
          {
            authContext: Awaited<
              ReturnType<typeof this.ifoodAuthService.resolveAuthContext>
            >;
            merchants: string[];
          }
        >,
      );

      const delayBetweenBatchesMs = this.resolveBatchDelayMs();
      const pollingParams = this.resolvePollingParams();
      const events: any[] = [];
      const pollingProfilesSummary: Array<{
        profileKey: string;
        merchants: number;
        batches: number;
      }> = [];

      try {
        const authContextEntries = Object.values(merchantsByAuthContext);

        for (
          let contextIndex = 0;
          contextIndex < authContextEntries.length;
          contextIndex += 1
        ) {
          const currentContextEntry = authContextEntries[contextIndex];
          const profileMerchants = currentContextEntry.merchants;
          const accessToken = await this.ifoodAuthService.getAccessToken({
            merchantId: currentContextEntry.authContext.merchantId,
            profileKey: currentContextEntry.authContext.profileKey,
          });
          const merchantBatches = this.chunkMerchants(
            profileMerchants,
            IfoodPollingService.MAX_MERCHANTS_PER_POLLING_REQUEST,
          );

          for (let index = 0; index < merchantBatches.length; index += 1) {
            const batch = merchantBatches[index];

            if (
              batch.length >
              IfoodPollingService.MAX_MERCHANTS_PER_POLLING_REQUEST
            ) {
              this.logger.error(
                `Lote de merchants acima do limite do iFood (${batch.length} > ${IfoodPollingService.MAX_MERCHANTS_PER_POLLING_REQUEST}).`,
              );
            }

            const response = await axios.get(
              'https://merchant-api.ifood.com.br/events/v1.0/events:polling',
              {
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                  'x-polling-merchants': batch.join(','),
                },
                params: pollingParams,
              },
            );

            if (Array.isArray(response.data)) {
              events.push(...response.data);
            }

            const hasNextBatchInProfile = index < merchantBatches.length - 1;
            const hasMoreProfilesToRun =
              contextIndex < authContextEntries.length - 1;

            if (
              (hasNextBatchInProfile || hasMoreProfilesToRun) &&
              delayBetweenBatchesMs > 0
            ) {
              await this.sleep(delayBetweenBatchesMs);
            }
          }
          
          pollingProfilesSummary.push({
            profileKey:
              currentContextEntry.authContext.profileKey ||
              currentContextEntry.authContext.merchantId ||
              currentContextEntry.authContext.source,
            merchants: profileMerchants.length,
            batches: merchantBatches.length,
          });
        }

        return {
          events,
          metadata: {
            totalMerchants: merchantIds.length,
            profiles: pollingProfilesSummary,
            batches: pollingProfilesSummary.reduce(
              (acc, profile) => acc + profile.batches,
              0,
            ),
            maxMerchantsPerBatch: Math.max(
              ...pollingProfilesSummary.map((profile) =>
                Math.ceil(profile.merchants / Math.max(profile.batches, 1)),
              ),
              0,
            ),
            batchDelayMs: delayBetweenBatchesMs,
          },
        };
      } catch (error: any) {
        const status = error?.response?.status;
        const data = error?.response?.data;
        const unauthorizedMerchants = Array.isArray(
          data?.error?.unauthorizedMerchants,
        )
          ? data.error.unauthorizedMerchants
          : [];

        this.logger.error('Erro ao consultar eventos no polling do iFood', {
          status,
          data,
        });

        throw new InternalServerErrorException(
          this.buildPollingErrorMessage(status, unauthorizedMerchants),
        );
      }
    });
  }

  async acknowledgeEvents(eventIds: string[]) {
    if (!Array.isArray(eventIds) || eventIds.length === 0) {
      return;
    }

    const accessToken = await this.ifoodAuthService.getAccessToken();

    try {
      await axios.post(
        'https://merchant-api.ifood.com.br/events/v1.0/events/acknowledgment',
        eventIds.map((eventId) => ({ id: eventId })),
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        },
      );

      this.logger.log(
        `ACK enviado ao iFood com sucesso. Eventos: ${eventIds.length}`,
      );
    } catch (error: any) {
      const status = error?.response?.status;
      const data = error?.response?.data;

      this.logger.error('Erro ao enviar ACK para o iFood', {
        status,
        data,
        eventIds,
      });

      throw new InternalServerErrorException(
        'Não foi possível enviar ACK dos eventos ao iFood.',
      );
    }
  }

  private async resolvePollingMerchants(): Promise<string[]> {
    const rawPollingMerchants = this.configService.get<string>(
      'IFOOD_POLLING_MERCHANTS',
    );
    const rawTestMerchant = this.configService.get<string>(
      'IFOOD_TEST_MERCHANT_ID',
    );
    const rawMerchant = this.configService.get<string>('IFOOD_MERCHANT_ID');
    const usersWithIfoodIntegration = await this.userRepository.find({
      where: {
        useIfoodIntegration: true,
        isActive: true,
      } as any,
    });

    const merchantIdsFromUsers = usersWithIfoodIntegration
      .map((user) => String(user.ifoodMerchantId || '').trim())
      .filter(Boolean);
    const merchants = [
      rawPollingMerchants,
      rawTestMerchant,
      rawMerchant,
      ...merchantIdsFromUsers,
    ]
      .filter(Boolean)
      .flatMap((item) => String(item).split(','))
      .map((item) => item.trim())
      .filter(Boolean);

    return Array.from(new Set(merchants));
  }

  private chunkMerchants(merchants: string[], chunkSize: number) {
    if (!Array.isArray(merchants) || merchants.length === 0 || chunkSize <= 0) {
      return [];
    }

    const chunks: string[][] = [];

    for (let index = 0; index < merchants.length; index += chunkSize) {
      chunks.push(merchants.slice(index, index + chunkSize));
    }

    return chunks;
  }

  private resolvePollingParams() {
    const types = this.readCsvEnv('IFOOD_POLLING_TYPES');
    const groups = this.readCsvEnv('IFOOD_POLLING_GROUPS');
    const fallbackAllCategoriesEnabled =
      String(
        this.configService.get('IFOOD_POLLING_ALL_CATEGORIES_FALLBACK') ??
          'true',
      ) !== 'false';

    const params: Record<string, any> = {
      excludeHeartbeat: true,
    };

    if (types.length > 0) {
      params.types = types.join(',');
    }

    if (groups.length > 0) {
      params.groups = groups.join(',');
    }

    if (
      types.length === 0 &&
      groups.length === 0 &&
      fallbackAllCategoriesEnabled
    ) {
      params.categories = 'ALL';
      this.logger.warn(
        'IFOOD_POLLING_TYPES/IFOOD_POLLING_GROUPS não informados; aplicando fallback categories=ALL.',
      );
    }

    return params;
  }

  private resolveBatchDelayMs() {
    const rawDelay = Number(
      this.configService.get('IFOOD_POLLING_BATCH_DELAY_MS') ??
        IfoodPollingService.DEFAULT_BATCH_DELAY_MS,
    );

    if (!Number.isFinite(rawDelay) || rawDelay < 0) {
      return IfoodPollingService.DEFAULT_BATCH_DELAY_MS;
    }

    return rawDelay;
  }

  private readCsvEnv(key: string) {
    const value = this.configService.get<string>(key);

    if (!value) {
      return [];
    }

    return String(value)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private async withTokenRateLimit<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.pollingQueue;
    let release: () => void = () => undefined;
    this.pollingQueue = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;

    try {
      return await operation();
    } finally {
      release();
    }
  }

  private async sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private buildPollingErrorMessage(
    status?: number,
    unauthorizedMerchants: string[] = [],
  ) {
    if (status === 403 && unauthorizedMerchants.length > 0) {
      return `Não foi possível consultar os eventos do iFood. Os merchants ${unauthorizedMerchants.join(', ')} não estão autorizados para o clientId informado. Revise o IFOOD_POLLING_MERCHANTS, IFOOD_MERCHANT_AUTH_PROFILE_MAP e os ifoodMerchantId de usuários ativos.`;
    }

    return 'Não foi possível consultar os eventos do iFood.';
  }
}