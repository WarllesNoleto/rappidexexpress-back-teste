import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { addHours } from 'date-fns';
import { MongoRepository } from 'typeorm';
import { UserEntity } from '../database/entities';
import axios from 'axios';
import * as crypto from 'crypto';

@Injectable()
export class AiqfomeAuthService {
  private readonly logger = new Logger(AiqfomeAuthService.name);

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(UserEntity)
    private readonly userRepository: MongoRepository<UserEntity>,
  ) {}

  async buildOAuthUrlByCompany(companyId: string) {
    const company = await this.userRepository.findOneBy({ id: companyId });
    if (!company) throw new NotFoundException('Empresa não encontrada');

    const clientId = String(this.configService.get<string>('AIQFOME_CLIENT_ID') || '').trim();
    const redirectUri = String(this.configService.get<string>('AIQFOME_REDIRECT_URI') || '').trim();

    if (!clientId) throw new BadRequestException('AIQFOME_CLIENT_ID não configurado.');
    if (!redirectUri) throw new BadRequestException('AIQFOME_REDIRECT_URI não configurado.');

    const configuredScope = String(this.configService.get<string>('AIQFOME_OAUTH_SCOPE') || '').trim();
    const scopeSet = new Set(configuredScope.split(/\s+/).filter(Boolean));
    scopeSet.add('aqf:order:read');

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: Array.from(scopeSet).join(' '),
      state: this.signState(companyId),
    });

    return `https://id.magalu.com/oauth/authorize?${params.toString()}`;
  }

  async handleCallback(code?: string, state?: string) {
    if (!code) throw new BadRequestException('code é obrigatório');

    const tokenData = await this.exchangeCodeForToken(code);
    const storeIdFromApi = await this.resolveAuthorizedStoreId(tokenData?.access_token);

    if (state) {
      const companyId = this.parseState(state);
      await this.saveTokens(companyId, tokenData, storeIdFromApi);
      this.logger.log(`[AiqfomeAuth] OAuth salvo via state companyId=${companyId} storeId=${storeIdFromApi || 'n/a'} status=connected`);
      return { success: true, companyId, storeId: storeIdFromApi || null, mappedBy: 'state' };
    }

    const mappedCompany = await this.handleCallbackWithoutState(tokenData, storeIdFromApi);
    if (!mappedCompany) {
      return {
        success: false,
        message:
          'Integração autorizada, mas nenhuma empresa Rappidex está cadastrada com esta loja aiqfome. Cadastre o Store ID da loja no painel e tente novamente.',
      };
    }

    return { success: true, companyId: mappedCompany.id, storeId: storeIdFromApi || mappedCompany.aiqfomeStoreId || null, mappedBy: 'storeId' };
  }

  async exchangeCodeForToken(code: string) {
    const body = new URLSearchParams();
    body.append('client_id', String(process.env.AIQFOME_CLIENT_ID || '').trim());
    body.append('client_secret', String(process.env.AIQFOME_CLIENT_SECRET || '').trim());
    body.append('redirect_uri', String(process.env.AIQFOME_REDIRECT_URI || '').trim());
    body.append('code', String(code || '').trim());
    body.append('grant_type', 'authorization_code');

    const response = await axios.post('https://id.magalu.com/oauth/token', body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    return response.data;
  }

  async refreshToken(companyId: string) { /* unchanged */
    const company = await this.userRepository.findOneBy({ id: companyId });
    const refreshToken = String(company?.aiqfomeRefreshToken || '').trim();
    if (!refreshToken) throw new BadRequestException('refresh_token não encontrado');
    const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: String(this.configService.get<string>('AIQFOME_CLIENT_ID') || ''), client_secret: String(this.configService.get<string>('AIQFOME_CLIENT_SECRET') || '') });
    const response = await axios.post('https://id.magalu.com/oauth/token', body.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    await this.saveTokens(companyId, response.data, company?.aiqfomeStoreId);
    this.logger.log(`[AiqfomeAuth] token renovado para empresa ${companyId}`);
    return response.data;
  }

  async getValidAccessToken(companyId: string) { const company = await this.userRepository.findOneBy({ id: companyId }); if (!company?.aiqfomeAccessToken) throw new BadRequestException('Empresa sem token aiqfome'); if (company.aiqfomeTokenExpiresAt && new Date(company.aiqfomeTokenExpiresAt).getTime() <= Date.now() + 60_000) { const refreshed = await this.refreshToken(companyId); return refreshed.access_token; } return company.aiqfomeAccessToken; }

  private parseState(state: string) {
    const [companyId, signature] = String(state || '').split('.');
    if (!companyId || !signature) throw new BadRequestException('state inválido');
    const expected = this.hmac(companyId);
    if (signature !== expected) throw new BadRequestException('state inválido');
    return companyId;
  }

  private signState(companyId: string) {
    return `${companyId}.${this.hmac(companyId)}`;
  }

  private hmac(value: string) {
    const secret = String(this.configService.get<string>('AIQFOME_OAUTH_STATE_SECRET') || this.configService.get<string>('JWT_SECRET_KEY') || '').trim();
    if (!secret) throw new BadRequestException('JWT_SECRET_KEY ou AIQFOME_OAUTH_STATE_SECRET não configurado.');
    return crypto.createHmac('sha256', secret).update(value).digest('hex');
  }

  private async resolveAuthorizedStoreId(accessToken?: string) {
    if (!accessToken) return '';
    const baseUrl = String(this.configService.get<string>('AIQFOME_API_BASE_URL') || 'https://plataforma.aiqfome.com').trim().replace(/\/$/, '');
    try {
      const res = await axios.get(`${baseUrl}/api/v2/stores`, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } });
      const firstStore = Array.isArray(res.data) ? res.data[0] : Array.isArray(res.data?.data) ? res.data.data[0] : res.data;
      return String(firstStore?.id || firstStore?.storeId || firstStore?.store_id || '').trim();
    } catch {
      return '';
    }
  }

  private async handleCallbackWithoutState(tokenData: any, resolvedStoreId?: string) {
    const storeId = String(resolvedStoreId || '').trim();
    if (!storeId) return null;
    const company = await this.userRepository.findOneBy({ aiqfomeStoreId: storeId });
    if (!company) return null;
    await this.saveTokens(company.id, tokenData, storeId);
    this.logger.log(`[AiqfomeAuth] OAuth sem state mapeado por storeId=${storeId} companyId=${company.id} status=connected`);
    return company;
  }

  private async saveTokens(companyId: string, tokenData: any, existingStoreId?: string) {
    const company = await this.userRepository.findOneBy({ id: companyId });
    const expiresIn = Number(tokenData?.expires_in || 3600);
    const scope = String(tokenData?.scope || '').trim();
    const scopes = scope.split(/\s+/).filter(Boolean);

    await this.userRepository.update({ id: companyId }, {
      aiqfomeEnabled: true,
      aiqfomeStoreId: String(existingStoreId || company?.aiqfomeStoreId || this.configService.get<string>('AIQFOME_DEFAULT_RAPIDDEX_STORE_ID') || '').trim(),
      aiqfomeAccessToken: tokenData?.access_token,
      aiqfomeRefreshToken: tokenData?.refresh_token,
      aiqfomeScope: scope || undefined,
      aiqfomeScopes: scopes.length ? scopes : undefined,
      aiqfomeTokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
      aiqfomeIntegrationStatus: 'connected',
      updatedAt: addHours(new Date(), -3),
    } as any);
  }
}
