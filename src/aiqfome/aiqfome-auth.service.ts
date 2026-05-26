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
    scopeSet.add('aqf:store:read');

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: Array.from(scopeSet).join(' '),
      state: this.signState(companyId),
    });

    const authorizeBaseUrl = String(this.configService.get<string>('AIQFOME_OAUTH_AUTHORIZE_URL') || 'https://id.magalu.com/login').trim().replace(/\/$/, '');
    return `${authorizeBaseUrl}?${params.toString()}`;
  }

  async handleCallback(code?: string, state?: string) {
    if (!code) throw new BadRequestException('code é obrigatório');

    const tokenData = await this.exchangeCodeForToken(code);
    const storeIdFromApi = await this.resolveAuthorizedStoreId(tokenData?.access_token);

    if (!state && !storeIdFromApi) {
      return {
        success: false,
        message: 'Não foi possível identificar a loja aiqfome autorizada. Verifique se o app possui o escopo aqf:store:read e tente reconectar.',
      };
    }

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
          'Integração autorizada, mas nenhuma empresa Rappidex está cadastrada com esta loja aiqfome. Cadastre o Store ID da loja no Rappidex e tente novamente.',
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
    const headers = { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' };
    const extractStoreId = (payload: any) => {
      const candidates = [
        payload?.id,
        payload?.storeId,
        payload?.store_id,
        payload?.data?.id,
        payload?.data?.storeId,
        payload?.data?.store_id,
        payload?.data?.[0]?.id,
        payload?.data?.[0]?.storeId,
        payload?.data?.[0]?.store_id,
        payload?.stores?.[0]?.id,
        payload?.stores?.[0]?.storeId,
        payload?.stores?.[0]?.store_id,
        payload?.items?.[0]?.id,
        payload?.items?.[0]?.storeId,
        payload?.items?.[0]?.store_id,
      ];
      const found = candidates.find((value) => String(value || '').trim());
      return String(found || '').trim();
    };

    const checkEndpoint = async (path: string) => {
      try {
        const res = await axios.get(`${baseUrl}${path}`, { headers });
        const storeId = extractStoreId(res.data);
        this.logger.log(`[AiqfomeAuth] resolve storeId endpoint=${path} status=${res.status} found=${Boolean(storeId)}${storeId ? ` storeId=${storeId}` : ''}`);
        return storeId;
      } catch (error: any) {
        const status = error?.response?.status || 'n/a';
        this.logger.warn(`[AiqfomeAuth] não foi possível resolver storeId endpoint=${path} status=${status}`);
        return '';
      }
    };

    const fromStores = await checkEndpoint('/api/v2/stores');
    if (fromStores) return fromStores;

    const fromStore = await checkEndpoint('/api/v2/store');
    return fromStore || '';
  }

  private async handleCallbackWithoutState(tokenData: any, resolvedStoreId?: string) {
    const storeId = String(resolvedStoreId || '').trim();
    if (!storeId) return null;
    const company = await this.userRepository.findOneBy({ aiqfomeStoreId: storeId });
    if (!company) return null;
    if (!company.aiqfomeEnabled) {
      throw new BadRequestException(
        'Esta loja aiqfome existe no Rappidex, mas a integração ainda não foi liberada pelo administrador.',
      );
    }
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
      aiqfomeStoreId: String(existingStoreId || company?.aiqfomeStoreId || '').trim(),
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
