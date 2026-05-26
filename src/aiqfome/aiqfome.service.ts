import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { AxiosError } from 'axios';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { MongoRepository } from 'typeorm';
import axios from 'axios';
import { DeliveryEntity, UserEntity } from '../database/entities';
import { AiqfomeAuthService } from './aiqfome-auth.service';
import { UserRequest } from '../shared/interfaces';
import { UserType, StatusDelivery } from '../shared/constants/enums.constants';
import { AiqfomeOrderMapperService } from './aiqfome-order-mapper.service';
import { OrdersGateway } from '../gateway/orders.gateway';
import { DeliveryResult } from '../delivery/dto';
import { addHours } from 'date-fns';

@Injectable()
export class AiqfomeService {
  private readonly logger = new Logger(AiqfomeService.name);

  constructor(
    private readonly authService: AiqfomeAuthService,
    private readonly config: ConfigService,
    @InjectRepository(UserEntity)
    private readonly userRepository: MongoRepository<UserEntity>,
    @InjectRepository(DeliveryEntity)
    private readonly deliveryRepository: MongoRepository<DeliveryEntity>,
    private readonly mapper: AiqfomeOrderMapperService,
    private readonly gateway: OrdersGateway,
  ) {}

  async oauthStart(companyId: string, user: UserRequest) {
    this.ensureCompanyAccess(user, companyId);
    return this.authService.buildOAuthUrlByCompany(companyId);
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
    const configuredScopes = Array.isArray(company?.aiqfomeScopes)
      ? company.aiqfomeScopes
      : String(company?.aiqfomeScope || '').split(/\s+/).filter(Boolean);
    const hasReadScope = configuredScopes.includes('aqf:order:read');

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
      this.logger.error('[AiqfomeWebhook] Reautorização necessária: o token atual não possui aqf:order:read. Faça uma nova autorização da loja no OAuth do aiqfome.');
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

  async getStatus(companyId: string, user?: UserRequest) {
    if (user) this.ensureCompanyAccess(user, companyId);
    const c = await this.userRepository.findOneBy({ id: companyId });
    const scopes = Array.isArray(c?.aiqfomeScopes)
      ? c.aiqfomeScopes
      : String(c?.aiqfomeScope || '').split(/\s+/).filter(Boolean);
    const hasOrderReadScope = scopes.includes('aqf:order:read');

    return {
      companyId,
      aiqfomeEnabled: !!c?.aiqfomeEnabled,
      aiqfomeStoreId: c?.aiqfomeStoreId || null,
      aiqfomeIntegrationStatus: c?.aiqfomeIntegrationStatus || 'not_configured',
      aiqfomeTokenExpiresAt: c?.aiqfomeTokenExpiresAt || null,
      hasAiqfomeAccessToken: !!c?.aiqfomeAccessToken,
      aiqfomeConnected:
        !!c?.aiqfomeAccessToken &&
        !!c?.aiqfomeTokenExpiresAt &&
        new Date(c.aiqfomeTokenExpiresAt).getTime() > Date.now(),
      hasOrderReadScope,
      aiqfomeScopes: scopes,
      reauthorizationRequired: !hasOrderReadScope,
      reauthorizationMessage: hasOrderReadScope
        ? null
        : 'Token aiqfome sem scope aqf:order:read. Reautorize a loja pelo OAuth do aiqfome para liberar leitura de pedidos.',
    };
  }

  async testConnection(companyId: string, user: UserRequest) {
    this.ensureCompanyAccess(user, companyId);
    const c = await this.userRepository.findOneBy({ id: companyId });
    if (!c) return { success: false };
    const token = await this.authService.getValidAccessToken(companyId).catch(() => '');
    return { success: !!token };
  }

  async registerWebhook(companyId: string, user: UserRequest) {
    this.ensureCompanyAccess(user, companyId);
    const c = await this.userRepository.findOneBy({ id: companyId });
    if (!c) return { success: false };
    const webhookUrl = String(this.config.get('AIQFOME_WEBHOOK_URL') || '').trim();
    await this.userRepository.update({ id: companyId }, {
      aiqfomeWebhookUrl: webhookUrl,
      aiqfomeIntegrationStatus: 'connected',
    } as any);
    return { success: true, webhookUrl };
  }

  async updateConfig(companyId: string, body: any, user: UserRequest) {
    this.ensureCompanyAccess(user, companyId);
    const current = await this.userRepository.findOneBy({ id: companyId });
    if (!current) return { success: false };
    await this.userRepository.update({ id: companyId }, {
      aiqfomeEnabled: Boolean(body?.aiqfomeEnabled),
      aiqfomeStoreId: String(body?.aiqfomeStoreId || current.aiqfomeStoreId || '').trim(),
      aiqfomeWebhookUrl: String(this.config.get('AIQFOME_WEBHOOK_URL') || current.aiqfomeWebhookUrl || '').trim(),
      aiqfomeIntegrationStatus: Boolean(body?.aiqfomeEnabled) ? 'connected' : 'not_configured',
    } as any);
    return this.getStatus(companyId);
  }

  async syncOrder(companyId: string, orderId: string, user: UserRequest) {
    this.ensureCompanyAccess(user, companyId);
    const c = await this.userRepository.findOneBy({ id: companyId });
    if (!c) return { success: false, message: 'Empresa não encontrada' };
    const order = await this.fetchOrderByCompany(c, orderId);
    if (!order) {
      return { success: false, message: 'Pedido aiqfome não encontrado ou não disponível na API V2' };
    }
    const storeId = String(c.aiqfomeStoreId || '').trim();
    const existingDelivery = await this.deliveryRepository.findOneBy({
      $or: [
        { aiqfomeOrderId: orderId, aiqfomeStoreId: storeId } as any,
        { externalOrderId: orderId, externalPlatform: 'aiqfome' } as any,
      ] as any,
    } as any);
    let delivery = existingDelivery as any;
    if (delivery) {
      delivery.logisticsStatus = String(order?.status || delivery.logisticsStatus || '').trim();
      delivery.updatedAt = addHours(new Date(), -3);
    } else {
      delivery = this.mapper.toDelivery(order, c, orderId, storeId) as any;
      delivery.status = StatusDelivery.PENDING;
    }

    const saved = await this.deliveryRepository.save(delivery as any);
    if (existingDelivery) {
      this.gateway.emitDeliveryUpdated(DeliveryResult.fromEntity(saved as any), c.cityId);
    } else {
      this.gateway.emitDeliveryCreated(DeliveryResult.fromEntity(saved as any), c.cityId);
    }
    return { success: true, delivery: DeliveryResult.fromEntity(saved as any), order };
  }

  private ensureCompanyAccess(user: UserRequest, companyId: string) {
    const isAdmin = user.type === UserType.ADMIN || user.type === UserType.SUPERADMIN;
    if (isAdmin) return;
    if (user.type === UserType.SHOPKEEPER || user.type === UserType.SHOPKEEPERADMIN) {
      if (user.id === companyId) return;
      throw new ForbiddenException('Acesso negado.');
    }
    throw new ForbiddenException('Acesso negado.');
  }
}
