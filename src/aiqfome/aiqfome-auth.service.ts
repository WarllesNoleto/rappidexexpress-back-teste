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
      throw new BadRequestException('storeId não informado. Use state ou configure AIQFOME_DEFAULT_RAPIDDEX_STORE_ID');
    }

    const tokenData = await this.exchangeCodeForToken(code);
    await this.saveTokens(rappidexStoreId, tokenData);
    return { success: true, storeId: rappidexStoreId };
  }

  async exchangeCodeForToken(code: string) {
    const clientId = String(process.env.AIQFOME_CLIENT_ID || '').trim();
    const clientSecret = String(process.env.AIQFOME_CLIENT_SECRET || '').trim();
    const redirectUri = String(process.env.AIQFOME_REDIRECT_URI || '').trim();

    const body = new URLSearchParams();
    body.append('client_id', clientId);
    body.append('client_secret', clientSecret);
    body.append('redirect_uri', redirectUri);
    body.append('code', String(code || '').trim());
    body.append('grant_type', 'authorization_code');

    const response = await axios.post('https://id.magalu.com/oauth/token', body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    return response.data;
  }

  async refreshToken(companyId: string) {
    const company = await this.userRepository.findOneBy({ id: companyId });
    const refreshToken = String(company?.aiqfomeRefreshToken || '').trim();

    if (!refreshToken) throw new BadRequestException('refresh_token não encontrado');

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: String(this.configService.get<string>('AIQFOME_CLIENT_ID') || ''),
      client_secret: String(this.configService.get<string>('AIQFOME_CLIENT_SECRET') || ''),
    });

    const response = await axios.post('https://id.magalu.com/oauth/token', body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    await this.saveTokens(companyId, response.data, company?.aiqfomeStoreId);
    this.logger.log(`[AiqfomeAuth] token renovado para empresa ${companyId}`);

    return response.data;
  }

  async getValidAccessToken(companyId: string) {
    const company = await this.userRepository.findOneBy({ id: companyId });
    if (!company?.aiqfomeAccessToken) throw new BadRequestException('Empresa sem token aiqfome');

    if (company.aiqfomeTokenExpiresAt && new Date(company.aiqfomeTokenExpiresAt).getTime() <= Date.now() + 60_000) {
      const refreshed = await this.refreshToken(companyId);
      return refreshed.access_token;
    }

    return company.aiqfomeAccessToken;
  }

  private async saveTokens(companyId: string, tokenData: any, existingStoreId?: string) {
    const expiresIn = Number(tokenData?.expires_in || 3600);
    const fallbackStoreId = String(this.configService.get<string>('AIQFOME_TEST_STORE_ID') || '').trim() || '140703';
    const scope = String(tokenData?.scope || '').trim();

    await this.userRepository.update(
      { id: companyId },
      {
        aiqfomeEnabled: true,
        aiqfomeStoreId: String(existingStoreId || fallbackStoreId).trim(),
        aiqfomeAccessToken: tokenData?.access_token,
        aiqfomeRefreshToken: tokenData?.refresh_token,
        aiqfomeScope: scope || undefined,
        aiqfomeTokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
        updatedAt: addHours(new Date(), -3),
      } as any,
    );
  }
}
