import { Injectable, Logger } from '@nestjs/common';
import { AxiosError } from 'axios';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { MongoRepository } from 'typeorm';
import axios from 'axios';
import { UserEntity } from '../database/entities';
import { AiqfomeAuthService } from './aiqfome-auth.service';

@Injectable()
export class AiqfomeService {
  private readonly logger = new Logger(AiqfomeService.name);

  constructor(
    private readonly authService: AiqfomeAuthService,
    private readonly config: ConfigService,
    @InjectRepository(UserEntity)
    private readonly userRepository: MongoRepository<UserEntity>,
  ) {}

  oauthStart(storeId?: string) {
    return this.authService.buildOAuthUrl(storeId);
  }

  oauthCallback(code?: string, state?: string) {
    return this.authService.handleCallback(code, state);
  }

  async fetchOrderByCompany(company: UserEntity, orderId: string) {
    const storeId = String(company?.aiqfomeStoreId || '').trim();
    const baseUrl = String(this.config.get('AIQFOME_API_BASE_URL') || 'https://plataforma.aiqfome.com').trim().replace(/\/$/, '');
    const path = `/api/v2/orders/${encodeURIComponent(orderId)}`;
    const url = `${baseUrl}${path}`;
    const now = Date.now();
    const expiresAt = company?.aiqfomeTokenExpiresAt ? new Date(company.aiqfomeTokenExpiresAt).getTime() : 0;
    const tokenExpired = !expiresAt || expiresAt <= now + 60_000;

    const hasAccessToken = !!String(company?.aiqfomeAccessToken || '').trim();
    const hasRefreshToken = !!String(company?.aiqfomeRefreshToken || '').trim();
    const hasReadScope = String(company?.aiqfomeScope || '').split(/\s+/).includes('aqf:order:read');

    if (!storeId || !String(orderId || '').trim()) return null;

    if (storeId !== String(company?.aiqfomeStoreId || '').trim() || !hasAccessToken || !hasRefreshToken) {
      this.logger.error('[AiqfomeWebhook] pré-validação de token aiqfome falhou', JSON.stringify({
        storeId,
        orderId,
        baseUrl,
        path,
        hasAccessToken,
        tokenExpired,
      }));
      return null;
    }

    if (!hasReadScope) {
      this.logger.error('[AiqfomeWebhook] token sem scope aqf:order:read', JSON.stringify({ storeId, orderId }));
      return null;
    }

    let accessToken = String(company?.aiqfomeAccessToken || '').trim();

    if (tokenExpired) {
      try {
        const refreshed = await this.authService.refreshToken(company.id);
        accessToken = String(refreshed?.access_token || '').trim();
      } catch {
        this.logger.error('[AiqfomeWebhook] falha ao renovar token aiqfome antes da busca do pedido', JSON.stringify({ storeId, orderId }));
        return null;
      }
    }

    try {
      const res = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      });
      return res.data;
    } catch (rawError) {
      const error = rawError as AxiosError;
      const statusCode = error?.response?.status;
      const apiMessage = (error?.response?.data as any)?.message || (error?.response?.data as any) || error?.message || null;

      this.logger.error('[AiqfomeWebhook] erro ao buscar pedido V2', JSON.stringify({
        storeId,
        orderId,
        baseUrl,
        path,
        hasAccessToken,
        tokenExpired,
        statusCode: statusCode || null,
        apiMessage: typeof apiMessage === 'string' ? apiMessage.slice(0, 300) : JSON.stringify(apiMessage || '').slice(0, 300),
      }));

      if (statusCode === 403) {
        this.logger.error('Acesso negado ao pedido aiqfome. Verifique se o token da loja possui scope aqf:order:read e se a loja autorizou a aplicação.');
      }

      if (statusCode === 404) {
        this.logger.warn('Pedido aiqfome não encontrado ou não disponível na API V2');
      }

      return null;
    }
  }

  async getStatus(companyId: string) {
    const c = await this.userRepository.findOneBy({ id: companyId });
    return {
      companyId,
      enabled: !!c?.aiqfomeEnabled,
      storeId: c?.aiqfomeStoreId || null,
      integrationStatus: c?.aiqfomeIntegrationStatus || 'not_configured',
      hasAccessToken: !!c?.aiqfomeAccessToken,
    };
  }

  async testConnection(companyId: string) {
    const c = await this.userRepository.findOneBy({ id: companyId });
    if (!c) return { success: false };
    const token = await this.authService.getValidAccessToken(companyId).catch(() => '');
    return { success: !!token };
  }

  async registerWebhook(companyId: string) {
    const c = await this.userRepository.findOneBy({ id: companyId });
    if (!c) return { success: false };
    const webhookUrl = String(this.config.get('AIQFOME_WEBHOOK_URL') || '').trim();
    await this.userRepository.update({ id: companyId }, {
      aiqfomeWebhookUrl: webhookUrl,
      aiqfomeIntegrationStatus: 'connected',
    } as any);
    return { success: true, webhookUrl };
  }

  async updateConfig(companyId: string, body: any) {
    const current = await this.userRepository.findOneBy({ id: companyId });
    if (!current) return { success: false };
    await this.userRepository.update({ id: companyId }, {
      aiqfomeEnabled: Boolean(body?.aiqfomeEnabled),
      aiqfomeStoreId: String(body?.aiqfomeStoreId || current.aiqfomeStoreId || '').trim(),
      aiqfomeWebhookSecret: body?.aiqfomeWebhookSecret ? String(body.aiqfomeWebhookSecret).trim() : current.aiqfomeWebhookSecret,
      aiqfomeAccessToken: body?.aiqfomeAccessToken ? String(body.aiqfomeAccessToken).trim() : current.aiqfomeAccessToken,
      aiqfomeIntegrationStatus: Boolean(body?.aiqfomeEnabled) ? 'connected' : 'not_configured',
    } as any);
    return this.getStatus(companyId);
  }

  async syncOrder(companyId: string, orderId: string) {
    const c = await this.userRepository.findOneBy({ id: companyId });
    if (!c) return { success: false, message: 'Empresa não encontrada' };
    const order = await this.fetchOrderByCompany(c, orderId);
    if (!order) {
      return { success: false, message: 'Pedido aiqfome não encontrado ou não disponível na API V2' };
    }
    return { success: true, order };
  }
}
