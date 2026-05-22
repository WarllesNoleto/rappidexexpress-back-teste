import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { addHours } from 'date-fns';
import { MongoRepository } from 'typeorm';
import { UserEntity } from '../database/entities';
import axios from 'axios';

@Injectable()
export class AiqfomeAuthService {
  private readonly logger = new Logger(AiqfomeAuthService.name);
  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(UserEntity)
    private readonly userRepository: MongoRepository<UserEntity>,
  ) {}
  buildOAuthUrl(storeId?: string) {
    const clientId = String(this.configService.get<string>('AIQFOME_CLIENT_ID') || '').trim();
    const redirectUri = String(this.configService.get<string>('AIQFOME_REDIRECT_URI') || '').trim();
    const normalizedStoreId = String(storeId || '').trim();

    if (!normalizedStoreId) throw new BadRequestException('storeId é obrigatório em /api/aiqfome/oauth/start?storeId=ID_DA_LOJA_DO_RAPIDDEX');
    if (!clientId) throw new BadRequestException('AIQFOME_CLIENT_ID não configurado. Defina a variável de ambiente AIQFOME_CLIENT_ID.');
    if (!redirectUri) throw new BadRequestException('AIQFOME_REDIRECT_URI não configurado. Defina a variável de ambiente AIQFOME_REDIRECT_URI.');

    const scope = 'aqf:order:read';

    this.logger.log(`[AiqfomeAuth] AIQFOME_CLIENT_ID=${clientId}`);
    this.logger.log(`[AiqfomeAuth] AIQFOME_REDIRECT_URI=${redirectUri}`);
    this.logger.log(`[AiqfomeAuth] scope usado=${scope}`);
    this.logger.log(`[AiqfomeAuth] state/storeId=${normalizedStoreId}`);

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope,
      state: normalizedStoreId,
    });

    return `https://id.magalu.com/oauth/authorize?${params.toString()}`;
  }

  async handleCallback(code?: string, state?: string) {
    if (!code) throw new BadRequestException('code é obrigatório');

    const rappidexStoreId =
      String(state || '').trim() ||
      String(this.configService.get<string>('AIQFOME_DEFAULT_RAPIDDEX_STORE_ID') || '').trim();

    if (!rappidexStoreId) {
      throw new BadRequestException(
        'storeId não informado. Use state ou configure AIQFOME_DEFAULT_RAPIDDEX_STORE_ID',
      );
    }

    const tokenData = await this.exchangeCodeForToken(code);
    await this.saveTokens(rappidexStoreId, tokenData);
    return { success: true, storeId: rappidexStoreId };
  }
  async exchangeCodeForToken(code: string) {
    const clientId = String(this.configService.get<string>('AIQFOME_CLIENT_ID') || '').trim();
    const clientSecret = String(this.configService.get<string>('AIQFOME_CLIENT_SECRET') || '').trim();
    const redirectUri = String(this.configService.get<string>('AIQFOME_REDIRECT_URI') || '').trim();

    this.logger.log(`[AiqfomeAuth] exchangeCodeForToken - client_id presente: ${Boolean(clientId)}`);
    this.logger.log(`[AiqfomeAuth] exchangeCodeForToken - client_secret presente: ${Boolean(clientSecret)}`);
    this.logger.log(`[AiqfomeAuth] exchangeCodeForToken - redirect_uri usado: ${redirectUri}`);
    this.logger.log(`[AiqfomeAuth] exchangeCodeForToken - code presente: ${Boolean(code)}`);

    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
      grant_type: 'authorization_code',
    });

    try {
      const response = await axios.post(
        'https://id.magalu.com/oauth/token',
        body.toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
      );
      return response.data;
    } catch (error: any) {
      this.logger.error(
        `[AiqfomeAuth] exchangeCodeForToken falhou - status: ${error?.response?.status}, data: ${JSON.stringify(
          error?.response?.data,
        )}`,
      );
      throw error;
    }
  }
  async refreshToken(storeId: string) { const store = await this.userRepository.findOneBy({ id: storeId }); const refreshToken = String(store?.aiqfomeRefreshToken || '').trim(); if (!refreshToken) throw new BadRequestException('refresh_token não encontrado'); const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: this.configService.get<string>('AIQFOME_CLIENT_ID') || '', client_secret: this.configService.get<string>('AIQFOME_CLIENT_SECRET') || '' }); const response = await axios.post('https://id.magalu.com/oauth/token', body.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }); await this.saveTokens(storeId, response.data); this.logger.log(`[AiqfomeAuth] token renovado para loja ${storeId}`); return response.data; }
  async getValidAccessToken(storeId: string) { const store = await this.userRepository.findOneBy({ id: storeId }); if (!store?.aiqfomeAccessToken) throw new BadRequestException('Loja sem token aiqfome'); if (store.aiqfomeTokenExpiresAt && new Date(store.aiqfomeTokenExpiresAt).getTime() <= Date.now() + 60_000) { const refreshed = await this.refreshToken(storeId); return refreshed.access_token; } return store.aiqfomeAccessToken; }
  private async saveTokens(storeId: string, tokenData: any) { const expiresIn = Number(tokenData?.expires_in || 3600); const aiqfomeStoreId = String(this.configService.get<string>('AIQFOME_TEST_STORE_ID') || '').trim() || '140703'; await this.userRepository.update({ id: storeId }, { aiqfomeEnabled: true, aiqfomeStoreId, aiqfomeAccessToken: tokenData?.access_token, aiqfomeRefreshToken: tokenData?.refresh_token, aiqfomeTokenExpiresAt: new Date(Date.now() + expiresIn * 1000), updatedAt: addHours(new Date(), -3) } as any); }
}
