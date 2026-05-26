import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
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
    const company = await this.userRepository.findOneBy({ id: companyId });
    if (!company?.aiqfomeEnabled || !String(company?.aiqfomeStoreId || '').trim()) {
      throw new BadRequestException(
        'Integração aiqfome ainda não configurada pelo administrador.',
      );
    }
    return this.authService.buildOAuthUrlByCompany(companyId);
  }

  oauthCallback(code?: string, state?: string) {
    return this.authService.handleCallback(code, state);
  }

  async fetchOrderByCompany(company: UserEntity, orderId: string) {
    const storeId = String(company?.aiqfomeStoreId || '').trim();
    const baseUrl = String(this.config.get('AIQFOME_API_BASE_URL') || 'https://plataforma.aiqfome.com').trim().replace(/\/$/, '');
    const path = `/api/v2/orders/${encodeURIComponent(orderId)}`;
    const searchPath = `/api/v2/orders/search?filter[store_id]=${encodeURIComponent(storeId)}&filter[order_id]=${encodeURIComponent(orderId)}`;
    const listPath = `/api/v2/orders?filter[store_ids]=${encodeURIComponent(storeId)}`;
    const url = `${baseUrl}${path}`;
    const searchUrl = `${baseUrl}${searchPath}`;
    const listUrl = `${baseUrl}${listPath}`;
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
    if (!this.hasValidCompanyIntegrationConfig(company, storeId)) {
      this.logger.error('[AiqfomeWebhook] configuração da empresa inválida para buscar pedido', JSON.stringify({
        storeId,
        orderId,
        hasAccessToken,
        tokenExpired,
      }));
      return null;
    }

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

    const requestHeaders = {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'RappidexExpress/1.0',
      ...(storeId ? { 'x-store-id': storeId, 'x-aiqfome-store-id': storeId } : {}),
    };

    try {
      const res = await axios.get(url, { headers: requestHeaders });
      return res.data;
    } catch (rawError) {
      const error = rawError as AxiosError;
      const statusCode = error?.response?.status;
      const { contentType, apiMessage, htmlPreview } = this.summarizeErrorPayload(error);

      this.logger.error('[AiqfomeWebhook] erro ao buscar pedido V2', JSON.stringify({
        storeId,
        orderId,
        baseUrl,
        path,
        hasAccessToken,
        tokenExpired,
        hasReadScope,
        statusCode: statusCode || null,
        contentType,
        htmlPreview,
        apiMessage: typeof apiMessage === 'string' ? apiMessage.slice(0, 300) : JSON.stringify(apiMessage || '').slice(0, 300),
      }));

      try {
        const fallbackRes = await axios.get(searchUrl, { headers: requestHeaders });
        const fallbackData = fallbackRes?.data;
        const fallbackOrder = Array.isArray(fallbackData?.data)
          ? fallbackData.data[0]
          : Array.isArray(fallbackData?.orders)
            ? fallbackData.orders[0]
            : fallbackData?.order || fallbackData?.data || fallbackData;
        this.logger.log('[AiqfomeWebhook] fallback de busca do pedido via search executado com sucesso', JSON.stringify({
          baseUrl,
          path: searchPath,
          storeId,
          orderId,
          statusCode: fallbackRes?.status || null,
          contentType: String(fallbackRes?.headers?.['content-type'] || '').trim() || null,
          tokenExpired,
          hasReadScope,
        }));
        return fallbackOrder || null;
      } catch (fallbackError: any) {
        const fallbackStatusCode = fallbackError?.response?.status || null;
        const fallbackContentType = String(fallbackError?.response?.headers?.['content-type'] || '').trim() || null;
        const fallbackSummary = this.summarizeErrorPayload(fallbackError);
        this.logger.error('[AiqfomeWebhook] fallback de busca do pedido via search falhou', JSON.stringify({
          baseUrl,
          path: searchPath,
          storeId,
          orderId,
          statusCode: fallbackStatusCode,
          contentType: fallbackContentType,
          htmlPreview: fallbackSummary.htmlPreview,
          apiMessage: fallbackSummary.apiMessage,
          tokenExpired,
          hasReadScope,
        }));
      }

      try {
        const fallbackListRes = await axios.get(listUrl, { headers: requestHeaders });
        const fallbackListData = fallbackListRes?.data;
        const fallbackOrder = Array.isArray(fallbackListData?.data)
          ? fallbackListData.data.find((order: any) => String(order?.id || order?.order_id || '') === String(orderId))
          : Array.isArray(fallbackListData?.orders)
            ? fallbackListData.orders.find((order: any) => String(order?.id || order?.order_id || '') === String(orderId))
            : null;
        this.logger.log('[AiqfomeWebhook] fallback de busca do pedido via listagem de pedidos executado', JSON.stringify({
          baseUrl,
          path: listPath,
          storeId,
          orderId,
          statusCode: fallbackListRes?.status || null,
          contentType: String(fallbackListRes?.headers?.['content-type'] || '').trim() || null,
          hasOrder: Boolean(fallbackOrder),
          tokenExpired,
          hasReadScope,
        }));
        if (fallbackOrder) return fallbackOrder;
      } catch (fallbackListError: any) {
        const fallbackListStatusCode = fallbackListError?.response?.status || null;
        const fallbackListContentType = String(fallbackListError?.response?.headers?.['content-type'] || '').trim() || null;
        const fallbackListSummary = this.summarizeErrorPayload(fallbackListError);
        this.logger.error('[AiqfomeWebhook] fallback de busca do pedido via listagem falhou', JSON.stringify({
          baseUrl,
          path: listPath,
          storeId,
          orderId,
          statusCode: fallbackListStatusCode,
          contentType: fallbackListContentType,
          htmlPreview: fallbackListSummary.htmlPreview,
          apiMessage: fallbackListSummary.apiMessage,
          tokenExpired,
          hasReadScope,
        }));
      }

      if (statusCode === 403) {
        this.logger.error('[AiqfomeWebhook] acesso negado ao buscar pedido no endpoint principal', JSON.stringify({
          statusCode,
          companyId: company?.id || null,
          storeId,
          orderId,
          hasReadScope,
        }));
        throw new ForbiddenException(
          'A API aiqfome negou acesso ao pedido. Verifique se o pedido pertence à loja autorizada, se o app possui aqf:order:read e se a loja teste permite consulta de pedidos via API.',
        );
      }

      if (statusCode === 404) {
        this.logger.warn('Pedido aiqfome não encontrado ou não disponível na API V2');
      }

      return null;
    }
  }


  private summarizeErrorPayload(error: any) {
    const contentType = String(error?.response?.headers?.['content-type'] || '').trim() || null;
    const raw = error?.response?.data;
    const responseText = typeof raw === 'string' ? raw : JSON.stringify(raw || '');
    const compact = responseText.replace(/\s+/g, ' ').trim();

    return {
      contentType,
      apiMessage: typeof raw?.message === 'string' ? raw.message.slice(0, 300) : compact.slice(0, 300) || null,
      htmlPreview: contentType?.includes('text/html') ? compact.slice(0, 180) : null,
    };
  }

  async debugFetchOrderByCompanyId(companyId: string, orderId: string, user: UserRequest) {
    this.ensureCompanyAccess(user, companyId);
    const company = await this.userRepository.findOneBy({ id: companyId });
    if (!company) throw new BadRequestException('Empresa não encontrada.');

    const storeId = String(company?.aiqfomeStoreId || '').trim();
    const baseUrl = String(this.config.get('AIQFOME_API_BASE_URL') || 'https://plataforma.aiqfome.com').trim().replace(/\/$/, '');
    const path = `/api/v2/orders/${encodeURIComponent(orderId)}`;
    const searchPath = `/api/v2/orders/search?filter[store_id]=${encodeURIComponent(storeId)}&filter[order_id]=${encodeURIComponent(orderId)}`;
    const listPath = `/api/v2/orders?filter[store_ids]=${encodeURIComponent(storeId)}`;
    const url = `${baseUrl}${path}`;
    const searchUrl = `${baseUrl}${searchPath}`;
    const listUrl = `${baseUrl}${listPath}`;
    const token = await this.authService.getValidAccessToken(companyId);

    try {
      const requestHeaders = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'RappidexExpress/1.0',
        ...(storeId ? { 'x-store-id': storeId, 'x-aiqfome-store-id': storeId } : {}),
      };
      const res = await axios.get(url, { headers: requestHeaders });
      const data = res?.data;
      return [{
        statusCode: res.status,
        path,
        contentType: String(res.headers?.['content-type'] || '').trim() || null,
        hasOrder: !!data,
        message: 'Pedido obtido com sucesso.',
      }];
    } catch (error: any) {
      const results: Array<{ statusCode: number; path: string; contentType: string | null; message: string; hasOrder: boolean }> = [];
      const requestHeaders = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'RappidexExpress/1.0',
        ...(storeId ? { 'x-store-id': storeId, 'x-aiqfome-store-id': storeId } : {}),
      };
      const pushErrorResult = (requestPath: string, err: any) => {
        const statusCode = err?.response?.status || 500;
        const contentType = String(err?.response?.headers?.['content-type'] || '').trim() || null;
        results.push({
          statusCode,
          path: requestPath,
          contentType,
          hasOrder: false,
          message:
            statusCode === 403
              ? 'Acesso negado ao pedido/loja.'
              : statusCode === 404
                ? 'Pedido/rota não encontrado.'
                : 'Falha ao consultar endpoint.',
        });
      };
      pushErrorResult(path, error);
      try {
        const fallbackRes = await axios.get(searchUrl, { headers: requestHeaders });
        results.push({
          statusCode: fallbackRes.status,
          path: searchPath,
          contentType: String(fallbackRes.headers?.['content-type'] || '').trim() || null,
          hasOrder: Boolean(fallbackRes?.data),
          message: 'Busca via search executada.',
        });
      } catch (searchError: any) {
        pushErrorResult(searchPath, searchError);
      }
      try {
        const listRes = await axios.get(listUrl, { headers: requestHeaders });
        const listData = listRes?.data;
        const orderFromList = Array.isArray(listData?.data)
          ? listData.data.find((order: any) => String(order?.id || order?.order_id || '') === String(orderId))
          : Array.isArray(listData?.orders)
            ? listData.orders.find((order: any) => String(order?.id || order?.order_id || '') === String(orderId))
            : null;
        results.push({
          statusCode: listRes.status,
          path: listPath,
          contentType: String(listRes.headers?.['content-type'] || '').trim() || null,
          hasOrder: Boolean(orderFromList),
          message: orderFromList ? 'Pedido encontrado via listagem.' : 'Listagem retornada sem pedido alvo.',
        });
      } catch (listError: any) {
        pushErrorResult(listPath, listError);
      }
      return results;
    }
  }

  private hasValidCompanyIntegrationConfig(company: UserEntity, storeId: string) {
    const aiqfomeEnabled = !!company?.aiqfomeEnabled;
    const aiqfomeStoreId = String(company?.aiqfomeStoreId || '').trim();
    const aiqfomeIntegrationStatus = String(company?.aiqfomeIntegrationStatus || '').trim();
    const hasAccessToken = !!String(company?.aiqfomeAccessToken || '').trim();
    const tokenExpiresAt = company?.aiqfomeTokenExpiresAt ? new Date(company.aiqfomeTokenExpiresAt).getTime() : 0;
    const tokenExpiresAtValid = !!tokenExpiresAt && !Number.isNaN(tokenExpiresAt);
    const isConnected = aiqfomeIntegrationStatus === 'connected';

    return aiqfomeEnabled && aiqfomeStoreId === storeId && isConnected && hasAccessToken && tokenExpiresAtValid;
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
    if (!c) throw new NotFoundException('Empresa não encontrada');

    const webhookUrl = String(this.config.get('AIQFOME_WEBHOOK_URL') || '').trim();
    const storeId = String(c.aiqfomeStoreId || '').trim();
    if (!webhookUrl || !storeId) {
      throw new BadRequestException('Configure AIQFOME_WEBHOOK_URL e ID da loja para registrar webhook.');
    }

    const token = await this.authService.getValidAccessToken(companyId);
    const baseUrl = String(this.config.get('AIQFOME_API_BASE_URL') || 'https://plataforma.aiqfome.com').trim().replace(/\/$/, '');

    const payload = { url: webhookUrl, event: ['ready-order'] };
    const endpoints = [
      { method: 'post', path: `/api/v2/store/${encodeURIComponent(storeId)}/webhooks` },
      { method: 'post', path: `/store/${encodeURIComponent(storeId)}/webhooks` },
      { method: 'put', path: `/api/v2/store/${encodeURIComponent(storeId)}/webhooks` },
    ] as const;

    let registeredByApi = false;
    let lastError: any = null;
    for (const endpoint of endpoints) {
      try {
        const url = `${baseUrl}${endpoint.path}`;
        const requestHeaders = {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'x-store-id': storeId,
          'x-aiqfome-store-id': storeId,
        };

        if (endpoint.method === 'post') await axios.post(url, payload, { headers: requestHeaders });
        else await axios.put(url, payload, { headers: requestHeaders });

        registeredByApi = true;
        this.logger.log(`[AiqfomeWebhookRegister] webhook registrado automaticamente endpoint=${endpoint.path} storeId=${storeId}`);
        break;
      } catch (error: any) {
        lastError = error;
        const status = error?.response?.status || 'n/a';
        this.logger.warn(`[AiqfomeWebhookRegister] tentativa de registro automático falhou endpoint=${endpoint.path} status=${status}`);
      }
    }

    const manualSetupRequired = !registeredByApi;
    await this.userRepository.update({ id: companyId }, {
      aiqfomeWebhookUrl: webhookUrl,
      aiqfomeIntegrationStatus: 'connected',
    } as any);

    if (manualSetupRequired) {
      this.logger.warn('[AiqfomeWebhookRegister] API não permitiu cadastro automático. Cadastro manual necessário no portal aiqfome.');
    }

    return {
      success: true,
      webhookUrl,
      registeredByApi,
      manualSetupRequired,
      manualSetupUrl: webhookUrl,
      message: manualSetupRequired
        ? 'Não foi possível registrar webhook automaticamente pela API V2. Cadastre manualmente a URL no portal/developer aiqfome.'
        : 'Webhook registrado automaticamente na API aiqfome.',
      lastErrorStatus: manualSetupRequired ? (lastError?.response?.status || null) : null,
    };
  }

  async updateConfig(companyId: string, body: { aiqfomeEnabled?: boolean; aiqfomeStoreId?: string }, user: UserRequest) {
    const isAdmin = user.type === UserType.ADMIN || user.type === UserType.SUPERADMIN;
    if (!isAdmin) {
      throw new ForbiddenException('Acesso negado.');
    }

    this.ensureCompanyAccess(user, companyId);
    const current = await this.userRepository.findOneBy({ id: companyId });
    if (!current) return { success: false };

    const aiqfomeEnabled = Boolean(body?.aiqfomeEnabled);
    const aiqfomeStoreId = String(body?.aiqfomeStoreId || '').trim();

    if (aiqfomeEnabled && !aiqfomeStoreId) {
      throw new BadRequestException('Informe o ID da loja aiqfome.');
    }

    await this.userRepository.update({ id: companyId }, {
      aiqfomeEnabled,
      aiqfomeStoreId: aiqfomeEnabled ? aiqfomeStoreId : '',
      aiqfomeWebhookUrl: String(this.config.get('AIQFOME_WEBHOOK_URL') || current.aiqfomeWebhookUrl || '').trim(),
      aiqfomeIntegrationStatus: aiqfomeEnabled ? (current.aiqfomeAccessToken ? 'connected' : 'not_connected') : 'not_configured',
    } as any);

    return this.getStatus(companyId);
  }


  async completePendingAuthorization(pendingId: string, body: { companyId?: string }, user: UserRequest) {
    const isAdmin = user.type === UserType.ADMIN || user.type === UserType.SUPERADMIN;
    const isShopkeeper = user.type === UserType.SHOPKEEPER || user.type === UserType.SHOPKEEPERADMIN;

    if (user.type === UserType.MOTOBOY) throw new ForbiddenException('Acesso negado.');

    const targetCompanyId = isAdmin ? String(body?.companyId || '').trim() : user.id;
    if (!targetCompanyId) throw new BadRequestException('Informe companyId para concluir a autorização pendente.');
    if (!isAdmin && !isShopkeeper) throw new ForbiddenException('Acesso negado.');

    return this.authService.completePendingAuthorization(pendingId, targetCompanyId);
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
