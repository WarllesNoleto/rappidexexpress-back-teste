import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { MongoRepository } from 'typeorm';
import { UserEntity } from '../database/entities';
import { IfoodHttpService } from './ifood-http.service';

type AuthProfile = {
  clientId: string;
  clientSecret: string;
};

export type AuthContext = {
  cacheKey: string;
  credentials: AuthProfile;
  source: 'merchant' | 'profile' | 'legacy';
  profileKey?: string;
  merchantId?: string;
};

type TokenCache = {
  value: string;
  expiresAt: number;
};

@Injectable()
export class IfoodAuthService {
  private readonly logger = new Logger(IfoodAuthService.name);
  private readonly cachedTokens: Record<string, TokenCache> = {};

  private static readonly TOKEN_EXPIRATION_BUFFER_MS = 60_000;
  private static readonly DEFAULT_PROFILE_KEY = 'default';

  constructor(
    private readonly configService: ConfigService,
    private readonly ifoodHttpService: IfoodHttpService,
    @InjectRepository(UserEntity)
    private readonly userRepository: MongoRepository<UserEntity>,
  ) {}

  async getAccessToken(options?: {
    merchantId?: string | null;
    profileKey?: string | null;
  }): Promise<string> {
    const context = await this.resolveAuthContext(options);

    const cachedToken = this.cachedTokens[context.cacheKey];

    if (
      cachedToken &&
      Date.now() <
        cachedToken.expiresAt - IfoodAuthService.TOKEN_EXPIRATION_BUFFER_MS
    ) {
      return cachedToken.value;
    }

    const authMode = this.configService.get<string>('IFOOD_AUTH_MODE');

    if (authMode !== 'centralized') {
      throw new BadRequestException(
        'Este serviço foi preparado para IFOOD_AUTH_MODE=centralized.',
      );
    }

    const body = new URLSearchParams({
      grantType: 'client_credentials',
      clientId: context.credentials.clientId,
      clientSecret: context.credentials.clientSecret,
    }).toString();

    try {
      const response = await this.ifoodHttpService.request(
        'auth_token',
        {
          method: 'POST',
          url: 'https://merchant-api.ifood.com.br/authentication/v1.0/oauth/token',
          data: body,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
        {
          retryOnStatuses: [429, 500, 502, 503, 504],
        },
      );

      if (!response.data?.accessToken) {
        throw new InternalServerErrorException(
          'O iFood respondeu, mas não retornou accessToken.',
        );
      }

      const expiresInSeconds = Number(response.data?.expiresIn ?? 0);
      const expiresAt =
        Number.isFinite(expiresInSeconds) && expiresInSeconds > 0
          ? Date.now() + expiresInSeconds * 1000
          : Date.now() + 15 * 60 * 1000;

      this.cachedTokens[context.cacheKey] = {
        value: response.data.accessToken,
        expiresAt,
      };

      return response.data.accessToken;
    } catch (error: any) {
      const status = error?.response?.status;
      const data = error?.response?.data;

      this.logger.error('Erro ao buscar token do iFood', {
        status,
        data,
        source: context.source,
        profileKey: context.profileKey,
        merchantId: context.merchantId,
      });

      throw new InternalServerErrorException(
        'Não foi possível obter o token do iFood.',
      );
    }
  }

  async resolveAuthContext(options?: {
    merchantId?: string | null;
    profileKey?: string | null;
  }): Promise<AuthContext> {
    const normalizedMerchantId = String(options?.merchantId || '').trim();

    if (normalizedMerchantId) {
      const merchantCredentials =
        await this.findMerchantCredentials(normalizedMerchantId);

      if (merchantCredentials) {
        return {
          cacheKey: `merchant:${normalizedMerchantId}`,
          credentials: merchantCredentials,
          source: 'merchant',
          merchantId: normalizedMerchantId,
        };
      }
    }

    const profileKey = this.resolveProfileKey(
      options?.profileKey,
      normalizedMerchantId,
    );
    const profiles = this.getAuthProfiles();
    const profileCredentials = profiles[profileKey];

    if (profileCredentials) {
      return {
        cacheKey: `profile:${profileKey}`,
        credentials: profileCredentials,
        source: 'profile',
        profileKey,
        merchantId: normalizedMerchantId || undefined,
      };
    }

    const legacyClientId = this.configService.get<string>('IFOOD_CLIENT_ID');
    const legacyClientSecret = this.configService.get<string>(
      'IFOOD_CLIENT_SECRET',
    );

    if (legacyClientId && legacyClientSecret) {
      return {
        cacheKey: `legacy:${profileKey}`,
        credentials: {
          clientId: legacyClientId,
          clientSecret: legacyClientSecret,
        },
        source: 'legacy',
        profileKey,
        merchantId: normalizedMerchantId || undefined,
      };
    }

    throw new BadRequestException(
      `Credenciais do iFood não encontradas para o merchant ${normalizedMerchantId || '(não informado)'} e perfil ${profileKey}. Configure credenciais no cadastro da empresa, IFOOD_AUTH_PROFILES ou IFOOD_CLIENT_ID/IFOOD_CLIENT_SECRET.`,
    );
  }

  resolveProfileKey(
    requestedProfileKey?: string | null,
    merchantId?: string | null,
  ): string {
    const normalizedRequestedProfile = String(requestedProfileKey || '').trim();

    if (normalizedRequestedProfile) {
      return normalizedRequestedProfile;
    }

    const merchantProfileMap = this.getMerchantProfileMap();
    const normalizedMerchantId = String(merchantId || '').trim();

    if (normalizedMerchantId && merchantProfileMap[normalizedMerchantId]) {
      return merchantProfileMap[normalizedMerchantId];
    }

    return IfoodAuthService.DEFAULT_PROFILE_KEY;
  }

  private async findMerchantCredentials(
    merchantId: string,
  ): Promise<AuthProfile | null> {
    const mappedUser = await this.userRepository.findOne({
      where: {
        useIfoodIntegration: true,
        ifoodMerchantId: merchantId,
        isActive: true,
      } as any,
      order: {
        updatedAt: 'DESC',
      },
    });

    const clientId = String(mappedUser?.ifoodClientId || '').trim();
    const clientSecret = String(mappedUser?.ifoodClientSecret || '').trim();

    if (!clientId || !clientSecret) {
      return null;
    }

    return {
      clientId,
      clientSecret,
    };
  }

  private getAuthProfiles(): Record<string, AuthProfile> {
    const rawProfiles = this.configService.get<string>('IFOOD_AUTH_PROFILES');

    if (!rawProfiles) {
      return {};
    }

    try {
      const parsed = JSON.parse(rawProfiles);

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        this.logger.warn(
          'IFOOD_AUTH_PROFILES inválido: use um objeto JSON no formato {"perfil":{"clientId":"...","clientSecret":"..."}}.',
        );
        return {};
      }

      return Object.entries(parsed).reduce(
        (acc, [key, profile]) => {
          const normalizedKey = String(key || '').trim();
          const clientId = String((profile as any)?.clientId || '').trim();
          const clientSecret = String(
            (profile as any)?.clientSecret || '',
          ).trim();

          if (normalizedKey && clientId && clientSecret) {
            acc[normalizedKey] = {
              clientId,
              clientSecret,
            };
          }

          return acc;
        },
        {} as Record<string, AuthProfile>,
      );
    } catch (error) {
      this.logger.warn(
        'IFOOD_AUTH_PROFILES inválido: não foi possível fazer parse do JSON.',
      );
      return {};
    }
  }

  private getMerchantProfileMap(): Record<string, string> {
    const rawMap = this.configService.get<string>(
      'IFOOD_MERCHANT_AUTH_PROFILE_MAP',
    );

    if (!rawMap) {
      return {};
    }

    try {
      const parsed = JSON.parse(rawMap);

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        this.logger.warn(
          'IFOOD_MERCHANT_AUTH_PROFILE_MAP inválido: use um objeto JSON no formato {"merchantId":"perfil"}.',
        );
        return {};
      }

      return Object.entries(parsed).reduce(
        (acc, [merchantId, profileKey]) => {
          const normalizedMerchantId = String(merchantId || '').trim();
          const normalizedProfileKey = String(profileKey || '').trim();

          if (normalizedMerchantId && normalizedProfileKey) {
            acc[normalizedMerchantId] = normalizedProfileKey;
          }

          return acc;
        },
        {} as Record<string, string>,
      );
    } catch (error) {
      this.logger.warn(
        'IFOOD_MERCHANT_AUTH_PROFILE_MAP inválido: não foi possível fazer parse do JSON.',
      );
      return {};
    }
  }
}