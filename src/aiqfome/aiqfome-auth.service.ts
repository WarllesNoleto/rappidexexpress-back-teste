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

    const scopes = 'aqf:order:read aqf:order:create aqf:store:read';

    this.logger.log(`[AiqfomeAuth] AIQFOME_CLIENT_ID=${clientId}`);
    this.logger.log(`[AiqfomeAuth] AIQFOME_REDIRECT_URI=${redirectUri}`);
    this.logger.log(`[AiqfomeAuth] scopes usados=${scopes}`);
    this.logger.log(`[AiqfomeAuth] state/storeId=${normalizedStoreId}`);

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: scopes,
      state: normalizedStoreId,
    });

    return `https://id.magalu.com/oauth/authorize?${params.toString()}`;
  }

  async handleCallback(code: string, state: string) {
    if (!code || !state) throw new BadRequestException('code e state são obrigatórios');
    const storeId = state;
    const tokenData = await this.exchangeCodeForToken(code);
    await this.saveTokens(storeId, tokenData);
    return { success: true, storeId };
  }
  async exchangeCodeForToken(code: string) { const body = new URLSearchParams({ grant_type: 'authorization_code', code, client_id: this.configService.get<string>('AIQFOME_CLIENT_ID') || '', client_secret: this.configService.get<string>('AIQFOME_CLIENT_SECRET') || '', redirect_uri: this.configService.get<string>('AIQFOME_REDIRECT_URI') || '' }); const response = await axios.post('https://id.magalu.com/oauth/token', body.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }); return response.data; }
  async refreshToken(storeId: string) { const store = await this.userRepository.findOneBy({ id: storeId }); const refreshToken = String(store?.aiqfomeRefreshToken || '').trim(); if (!refreshToken) throw new BadRequestException('refresh_token não encontrado'); const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: this.configService.get<string>('AIQFOME_CLIENT_ID') || '', client_secret: this.configService.get<string>('AIQFOME_CLIENT_SECRET') || '' }); const response = await axios.post('https://id.magalu.com/oauth/token', body.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }); await this.saveTokens(storeId, response.data); this.logger.log(`[AiqfomeAuth] token renovado para loja ${storeId}`); return response.data; }
  async getValidAccessToken(storeId: string) { const store = await this.userRepository.findOneBy({ id: storeId }); if (!store?.aiqfomeAccessToken) throw new BadRequestException('Loja sem token aiqfome'); if (store.aiqfomeTokenExpiresAt && new Date(store.aiqfomeTokenExpiresAt).getTime() <= Date.now() + 60_000) { const refreshed = await this.refreshToken(storeId); return refreshed.access_token; } return store.aiqfomeAccessToken; }
  private async saveTokens(storeId: string, tokenData: any) { const expiresIn = Number(tokenData?.expires_in || 3600); await this.userRepository.update({ id: storeId }, { aiqfomeEnabled: true, aiqfomeStoreId: storeId, aiqfomeAccessToken: tokenData?.access_token, aiqfomeRefreshToken: tokenData?.refresh_token, aiqfomeTokenExpiresAt: new Date(Date.now() + expiresIn * 1000), updatedAt: addHours(new Date(), -3) } as any); }
}
