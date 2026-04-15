import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class IfoodAuthService {
  private readonly logger = new Logger(IfoodAuthService.name);
  private cachedToken: { value: string; expiresAt: number } | null = null;

  private static readonly TOKEN_EXPIRATION_BUFFER_MS = 60_000;

  constructor(private readonly configService: ConfigService) {}

  async getAccessToken(): Promise<string> {
    if (
      this.cachedToken &&
      Date.now() <
        this.cachedToken.expiresAt -
          IfoodAuthService.TOKEN_EXPIRATION_BUFFER_MS
    ) {
      return this.cachedToken.value;
    }

    const clientId = this.configService.get<string>('IFOOD_CLIENT_ID');
    const clientSecret = this.configService.get<string>('IFOOD_CLIENT_SECRET');
    const authMode = this.configService.get<string>('IFOOD_AUTH_MODE');

    if (!clientId || !clientSecret) {
      throw new BadRequestException(
        'IFOOD_CLIENT_ID ou IFOOD_CLIENT_SECRET não configurados no .env.',
      );
    }

    if (authMode !== 'centralized') {
      throw new BadRequestException(
        'Este serviço foi preparado para IFOOD_AUTH_MODE=centralized.',
      );
    }

    const body = new URLSearchParams({
      grantType: 'client_credentials',
      clientId,
      clientSecret,
    }).toString();

    try {
      const response = await axios.post(
        'https://merchant-api.ifood.com.br/authentication/v1.0/oauth/token',
        body,
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
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

      this.cachedToken = {
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
      });

      throw new InternalServerErrorException(
        'Não foi possível obter o token do iFood.',
      );
    }
  }
}