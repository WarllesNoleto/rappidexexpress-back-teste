import { BadRequestException, forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import axios from 'axios';
import { addMinutes, addSeconds } from 'date-fns';
import { MongoRepository } from 'typeorm';
import { v4 as uuid } from 'uuid';
import {
  AiqfomeIntegrationEntity,
  AiqfomeOrderLinkEntity,
  AiqfomePendingAuthorizationEntity,
  DeliveryEntity,
} from '../database/entities';
import { DeliveryResult } from '../delivery/dto';
import { DeliveryService } from '../delivery/delivery.service';
import { OrdersGateway } from '../gateway/orders.gateway';
import { PaymentType, StatusDelivery } from '../shared/constants/enums.constants';
import { AiqfomeOrderLinkService } from './aiqfome-order-link.service';

@Injectable()
export class AiqfomeService {
  private readonly logger = new Logger(AiqfomeService.name);

  constructor(
    @InjectRepository(AiqfomeIntegrationEntity)
    private readonly repo: MongoRepository<AiqfomeIntegrationEntity>,
    @InjectRepository(DeliveryEntity)
    private readonly deliveries: MongoRepository<DeliveryEntity>,
    @InjectRepository(AiqfomePendingAuthorizationEntity)
    private readonly pendingAuthorizations: MongoRepository<AiqfomePendingAuthorizationEntity>,
    @Inject(forwardRef(() => DeliveryService))
    private readonly deliveryService: DeliveryService,
    private readonly linkService: AiqfomeOrderLinkService,
    private readonly ordersGateway: OrdersGateway,
  ) {}

  private requireEnv(name: string) {
    const value = String(process.env[name] || '').trim();

    if (!value) {
      throw new BadRequestException(`Variável de ambiente ${name} obrigatória para integração aiqfome.`);
    }

    return value;
  }

  /**
   * AIQFOME_API_BASE_URL deve apontar para a base já versionada da API aiqfome.
   * Exemplo: https://BASE_OFICIAL_DA_API_AIQFOME/api/v2 (ou a base V2 oficial equivalente).
   */
  private buildAiqfomeUrl(path: string) {
    const base = this.requireEnv('AIQFOME_API_BASE_URL').replace(/\/+$/, '');
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${base}${normalizedPath}`;
  }

  private summarizeErrorBody(data: any) {
    if (!data) return '';
    const raw = typeof data === 'string' ? data : JSON.stringify(data);

    return raw
      .replace(/(access_token|refresh_token|token)"?\s*:\s*"[^"]+"/gi, '$1":"[redacted]"')
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
      .slice(0, 600);
  }

  private async ensureValidToken(integration: AiqfomeIntegrationEntity) {
    const expiresAt = integration.tokenExpiresAt
      ? new Date(integration.tokenExpiresAt).getTime()
      : 0;
    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;

    if (!expiresAt || expiresAt - now <= fiveMinutes) {
      return this.refreshToken(integration.id);
    }

    return integration;
  }

  async generateConnectUrl(shopkeeperId: string, storeId?: string) {
    const authorizeUrl = this.requireEnv('AIQFOME_AUTHORIZE_URL');
    const clientId = this.requireEnv('AIQFOME_CLIENT_ID');
    const redirectUri = this.requireEnv('AIQFOME_REDIRECT_URI');
    const scopes = this.requireEnv('AIQFOME_SCOPES');
    const nonce = uuid();
    const createdAt = new Date();
    const expiresAt = addMinutes(createdAt, 15);

    await this.pendingAuthorizations.save({
      id: uuid(),
      shopkeeperId,
      storeId: storeId || '',
      nonce,
      used: false,
      createdAt,
      expiresAt,
    });
    this.logger.log('[Aiqfome] autorização pendente criada');

    const state = Buffer.from(
      JSON.stringify({ shopkeeperId, storeId: storeId || '', nonce }),
    ).toString('base64url');

    const params = new URLSearchParams();
    params.set('client_id', clientId);
    params.set('redirect_uri', redirectUri);
    params.set('scope', scopes);
    params.set('response_type', 'code');
    params.set('state', state);
    params.set('choose_tenants', 'true');
    const separator = authorizeUrl.includes('?') ? '&' : '?';
    const url = `${authorizeUrl}${separator}${params.toString()}`;

    this.logger.log('[Aiqfome] connect-url gerada com choose_tenants=true');
    return { url, state };
  }

  private async findValidPendingAuthorizationByNonce(nonce?: string) {
    if (!nonce) return null;

    const pendingAuthorization = await this.pendingAuthorizations.findOneBy({ nonce });
    const now = new Date();

    if (
      pendingAuthorization &&
      !pendingAuthorization.used &&
      new Date(pendingAuthorization.expiresAt).getTime() > now.getTime()
    ) {
      return pendingAuthorization;
    }

    return null;
  }

  private async findLatestValidPendingAuthorization() {
    const pendingAuthorizations = await this.pendingAuthorizations.find({
      where: {
        used: false,
        expiresAt: { $gt: new Date() },
      } as any,
      order: { createdAt: 'DESC' },
      take: 1,
    });

    return Array.isArray(pendingAuthorizations) && pendingAuthorizations.length
      ? pendingAuthorizations[0]
      : null;
  }

  private async markPendingAuthorizationAsUsed(pendingAuthorization?: AiqfomePendingAuthorizationEntity | null) {
    if (!pendingAuthorization) return;

    pendingAuthorization.used = true;
    await this.pendingAuthorizations.save(pendingAuthorization);
    this.logger.log('[Aiqfome] autorização pendente marcada como usada');
  }

  async handleOAuthCallback(code: string, state?: string) {
    this.logger.log('[Aiqfome] callback recebido');
    if (!code) throw new BadRequestException('code obrigatório');

    let decoded: any = null;
    let pendingAuthorization: AiqfomePendingAuthorizationEntity | null = null;
    let shopkeeperId = '';
    let storeId = '';

    if (state) {
      try {
        decoded = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
      } catch {
        throw new BadRequestException('State inválido na conexão aiqfome.');
      }

      pendingAuthorization = await this.findValidPendingAuthorizationByNonce(decoded?.nonce);
      shopkeeperId = String(pendingAuthorization?.shopkeeperId || decoded?.shopkeeperId || '').trim();
      storeId = String(pendingAuthorization?.storeId ?? decoded?.storeId ?? '').trim();
    } else {
      pendingAuthorization = await this.findLatestValidPendingAuthorization();

      if (!pendingAuthorization) {
        this.logger.warn('[Aiqfome] nenhuma autorização pendente encontrada para callback sem state');
        throw new BadRequestException(
          'State ausente e nenhuma autorização aiqfome pendente foi encontrada. Clique novamente em Conectar aiqfome pelo Rappidex.',
        );
      }

      this.logger.log('[Aiqfome] callback recebido sem state, usando autorização pendente mais recente');
      shopkeeperId = String(pendingAuthorization.shopkeeperId || '').trim();
      storeId = String(pendingAuthorization.storeId || '').trim();
    }

    if (!shopkeeperId) {
      throw new BadRequestException('shopkeeperId ausente no state da conexão aiqfome.');
    }

    const integration = await this.exchangeCodeForToken(code, shopkeeperId, storeId);
    await this.markPendingAuthorizationAsUsed(pendingAuthorization);

    try {
      await this.registerWebhook(integration);
    } catch (error: any) {
      const status = error?.response?.status || error?.status || 'N/A';
      const body = this.summarizeErrorBody(error?.response?.data);
      this.logger.error(
        `[Aiqfome] erro ao registrar webhooks automaticamente storeId=${integration.aiqfomeStoreId} status=${status} body=${body || 'sem body'} message=${error?.message || error}`,
      );
    }

    return {
      success: true,
      message: 'Integração aiqfome conectada com sucesso.',
      shopkeeperId: integration.shopkeeperId,
      aiqfomeStoreId: integration.aiqfomeStoreId,
      storeName: integration.storeName,
    };
  }

  async exchangeCodeForToken(code: string, shopkeeperId: string, storeId?: string) {
    const redirectUri = this.requireEnv('AIQFOME_REDIRECT_URI');
    const payload = {
      client_id: this.requireEnv('AIQFOME_CLIENT_ID'),
      client_secret: this.requireEnv('AIQFOME_CLIENT_SECRET'),
      redirect_uri: redirectUri,
      code,
      grant_type: 'authorization_code',
    };
    let tokenResp;

    try {
      tokenResp = await axios.post(
        this.requireEnv('AIQFOME_AUTH_TOKEN_URL'),
        payload,
        { headers: { 'Content-Type': 'application/json' } },
      );
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      const body = axios.isAxiosError(error) ? this.summarizeErrorBody(error.response?.data) : '';

      this.logger.error(
        `[Aiqfome] erro ao trocar code por token. status=${status ?? 'indisponível'} body=${body || 'sem body'} redirectUri=${redirectUri}`,
      );

      throw new BadRequestException(
        'Não foi possível trocar o code por token no aiqfome. Verifique as credenciais OAuth e o redirect_uri.',
      );
    }

    const tokenData = tokenResp.data || {};
    const accessToken = String(tokenData.access_token || '');
    let storesResp;

    try {
      storesResp = await axios.get(this.buildAiqfomeUrl('/store'), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      this.logger.log('[Aiqfome] lojas autorizadas consultadas');
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      const body = axios.isAxiosError(error) ? this.summarizeErrorBody(error.response?.data) : '';
      const message = error instanceof Error ? error.message : String(error);

      this.logger.error(
        `[Aiqfome] erro ao consultar lojas autorizadas no callback. status HTTP: ${status ?? 'indisponível'}; body: ${body || 'sem body'}; mensagem: ${message}`,
      );

      throw new BadRequestException(
        'Não foi possível consultar as lojas autorizadas no aiqfome. Verifique AIQFOME_API_BASE_URL, token e permissões.',
      );
    }
    const stores = Array.isArray(storesResp.data)
      ? storesResp.data
      : Array.isArray(storesResp.data?.data)
        ? storesResp.data.data
        : [];

    if (!stores.length) {
      throw new BadRequestException('Nenhuma loja aiqfome autorizada foi encontrada para este token.');
    }

    const selectedStore = storeId
      ? stores.find((store) =>
          String(store?.id || store?.store_id || store?.storeId || '') === String(storeId)
        )
      : stores[0];

    if (!selectedStore) {
      throw new BadRequestException('O Store ID informado não pertence às lojas autorizadas no aiqfome. Confira o código da loja e conecte novamente.');
    }

    const finalStoreId = String(selectedStore?.id || selectedStore?.store_id || selectedStore?.storeId || '').trim();

    if (!finalStoreId) {
      throw new BadRequestException('Não foi possível identificar o Store ID autorizado do aiqfome.');
    }

    const finalStoreName = String(selectedStore?.name || selectedStore?.store_name || selectedStore?.title || finalStoreId);
    const existingIntegration = await this.repo.findOneBy({
      shopkeeperId,
      aiqfomeStoreId: finalStoreId,
    } as any);
    const entity = await this.repo.save({
      ...(existingIntegration || { id: uuid(), createdAt: new Date() }),
      shopkeeperId,
      aiqfomeStoreId: finalStoreId,
      storeName: finalStoreName,
      accessToken,
      refreshToken: String(tokenData.refresh_token || existingIntegration?.refreshToken || ''),
      tokenExpiresAt: addSeconds(new Date(), Number(tokenData.expires_in || 3600)),
      scopes: Array.isArray(tokenData.scope)
        ? tokenData.scope
        : String(tokenData.scope || '').split(' ').filter(Boolean),
      active: true,
      updatedAt: new Date(),
    });

    if (existingIntegration) {
      this.logger.log('[Aiqfome] integração existente atualizada');
    } else {
      this.logger.log('[Aiqfome] nova integração criada');
    }

    this.logger.log('[Aiqfome] token trocado e salvo');
    return entity;
  }

  async refreshToken(integrationId: string) {
    const integration = await this.repo.findOneBy({ id: integrationId });
    if (!integration) throw new BadRequestException('Integração aiqfome não encontrada.');

    const resp = await axios.post(
      this.requireEnv('AIQFOME_AUTH_TOKEN_URL'),
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: integration.refreshToken,
        client_id: this.requireEnv('AIQFOME_CLIENT_ID'),
        client_secret: this.requireEnv('AIQFOME_CLIENT_SECRET'),
        redirect_uri: this.requireEnv('AIQFOME_REDIRECT_URI') || '',
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );

    integration.accessToken = String(resp.data?.access_token || integration.accessToken);
    integration.refreshToken = String(resp.data?.refresh_token || integration.refreshToken);
    integration.tokenExpiresAt = addSeconds(new Date(), Number(resp.data?.expires_in || 3600));
    integration.updatedAt = new Date();
    this.logger.log('[Aiqfome] token renovado');
    return this.repo.save(integration);
  }

  async listStores(shopkeeperId: string) {
    if (!shopkeeperId) {
      return [];
    }

    const integrations = await this.repo.find({
      where: { shopkeeperId, active: true } as any,
    });

    return integrations.map((integration) => ({
      id: integration.id,
      shopkeeperId: integration.shopkeeperId,
      aiqfomeStoreId: integration.aiqfomeStoreId,
      storeName: integration.storeName,
      active: integration.active,
      tokenExpiresAt: integration.tokenExpiresAt,
      connected: Boolean(integration.accessToken && integration.refreshToken),
      status: integration.tokenExpiresAt && new Date(integration.tokenExpiresAt).getTime() > Date.now()
        ? 'Conectado'
        : 'Token expirado',
    }));
  }

  async registerWebhookById(integrationId: string) {
    const integration = await this.repo.findOneBy({ id: integrationId });
    if (!integration) throw new BadRequestException('Integração aiqfome não encontrada.');
    return this.registerWebhook(integration);
  }

  private extractWebhookEvents(data: any): any[] {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data?.data?.webhook_events)) return data.data.webhook_events;
    if (Array.isArray(data?.data?.webhookEvents)) return data.data.webhookEvents;
    if (Array.isArray(data?.data?.events)) return data.data.events;
    if (Array.isArray(data?.webhook_events)) return data.webhook_events;
    if (Array.isArray(data?.webhookEvents)) return data.webhookEvents;
    if (Array.isArray(data?.events)) return data.events;

    return [];
  }

  private normalizeWebhookEventValue(value: any) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-');
  }

  private webhookEventAliases(event: string) {
    const aliases: Record<string, string[]> = {
      'new-order': ['new-order', 'neworder', 'order-created', 'created-order'],
      'read-order': ['read-order', 'readorder', 'order-read'],
      'ready-order': ['ready-order', 'readyorder', 'order-ready'],
      'cancel-order': ['cancel-order', 'cancelorder', 'order-cancel', 'order-canceled', 'order-cancelled'],
      'order-refund': ['order-refund', 'orderrefund', 'refund-order'],
      'order-logistic': ['order-logistic', 'orderlogistic', 'logistic-order'],
    };

    return aliases[event] || [event];
  }

  private getWebhookEventId(webhookEvent: any) {
    return webhookEvent?.webhook_event_id || webhookEvent?.webhookEventId || webhookEvent?.id || webhookEvent?.event_id || webhookEvent?.eventId;
  }

  private resolveWebhookEventId(webhookEvents: any[], event: string) {
    const aliases = this.webhookEventAliases(event).map((alias) => this.normalizeWebhookEventValue(alias));
    const compactAliases = aliases.map((alias) => alias.replace(/-/g, ''));

    const matchedEvent = webhookEvents.find((webhookEvent) => {
      const searchableValues = [
        webhookEvent?.name,
        webhookEvent?.event,
        webhookEvent?.slug,
        webhookEvent?.code,
        webhookEvent?.description,
      ];

      return searchableValues.some((value) => {
        const normalizedValue = this.normalizeWebhookEventValue(value);
        const compactValue = normalizedValue.replace(/-/g, '');

        return (
          aliases.includes(normalizedValue) ||
          compactAliases.includes(compactValue) ||
          aliases.some((alias) => normalizedValue.includes(alias)) ||
          compactAliases.some((alias) => compactValue.includes(alias))
        );
      });
    });

    return this.getWebhookEventId(matchedEvent);
  }

  async registerWebhook(integration: AiqfomeIntegrationEntity) {
    const validIntegration = await this.ensureValidToken(integration);
    const webhookSecret = this.requireEnv('AIQFOME_WEBHOOK_SECRET');
    const backendPublicUrl = this.requireEnv('BACKEND_PUBLIC_URL').replace(/\/+$/, '');
    const webhookUrl = `${backendPublicUrl}/api/aiqfome/webhook`;
    const requiredEvents = ['new-order', 'read-order', 'ready-order', 'cancel-order', 'order-refund', 'order-logistic'];

    const eventsResponse = await axios.get(this.buildAiqfomeUrl('/auxiliary/webhook-events'), {
      headers: { Authorization: `Bearer ${validIntegration.accessToken}` },
    });
    const availableWebhookEvents = this.extractWebhookEvents(eventsResponse.data);
    this.logger.log('[Aiqfome] eventos de webhook disponíveis consultados');

    const results = [];

    for (const event of requiredEvents) {
      const eventId = this.resolveWebhookEventId(availableWebhookEvents, event);

      if (!eventId) {
        this.logger.error(
          `[Aiqfome] erro ao registrar webhook storeId=${validIntegration.aiqfomeStoreId} status=evento-nao-encontrado body=event=${event}`,
        );
        results.push({ event, success: false, error: 'webhook_event_id não encontrado' });
        continue;
      }

      this.logger.log(
        `[Aiqfome] registrando webhook storeId=${validIntegration.aiqfomeStoreId} event=${event} eventId=${eventId}`,
      );

      try {
        const response = await axios.post(
          this.buildAiqfomeUrl(`/store/${validIntegration.aiqfomeStoreId}/webhooks`),
          {
            webhooks: [
              {
                url: webhookUrl,
                secret_key: webhookSecret,
                webhook_event_id: eventId,
              },
            ],
          },
          { headers: { Authorization: `Bearer ${validIntegration.accessToken}` } },
        );

        this.logger.log(
          `[Aiqfome] webhook registrado com sucesso storeId=${validIntegration.aiqfomeStoreId} event=${event}`,
        );
        results.push({ event, eventId, success: true, status: response.status });
      } catch (error: any) {
        const status = error?.response?.status || error?.status || 'N/A';
        const body = this.summarizeErrorBody(error?.response?.data);
        this.logger.error(
          `[Aiqfome] erro ao registrar webhook storeId=${validIntegration.aiqfomeStoreId} status=${status} body=${body || 'sem body'}`,
        );
        results.push({ event, eventId, success: false, status, error: body || error?.message || String(error) });
      }
    }

    return {
      success: results.some((result) => result.success),
      message: 'Registro de webhooks aiqfome processado.',
      results,
    };
  }

  private extractWebhookEventName(payload: any) {
    const rawEvent =
      payload?.event ||
      payload?.type ||
      payload?.event_type ||
      payload?.eventType ||
      payload?.webhook_event ||
      payload?.webhookEvent ||
      payload?.code ||
      payload?.data?.event ||
      payload?.data?.type ||
      payload?.data?.event_type ||
      payload?.data?.eventType ||
      payload?.data?.webhook_event ||
      payload?.data?.webhookEvent ||
      payload?.data?.code ||
      '';

    if (rawEvent && typeof rawEvent === 'object') {
      return this.normalizeWebhookEventValue(
        rawEvent?.name || rawEvent?.event || rawEvent?.slug || rawEvent?.code || rawEvent?.description || '',
      );
    }

    return this.normalizeWebhookEventValue(rawEvent);
  }

  async handleWebhook(headers: Record<string, string>, payload: any) {
    try {
      const auth = headers.authorization || headers.Authorization;
      const ua = headers['user-agent'] || headers['User-Agent'] || '';
      const secret = process.env.AIQFOME_WEBHOOK_SECRET || '';

      if (!secret || !(auth === secret || auth === `Bearer ${secret}`)) {
        this.logger.warn('[Aiqfome] webhook ignorado por auth inválida');
        return;
      }

      if (ua && !String(ua).toLowerCase().includes('aiqfome')) {
        this.logger.warn('[Aiqfome] webhook ignorado por User-Agent inválido');
        return;
      }

      const event = this.extractWebhookEventName(payload);
      const storeId = String(
        payload?.store_id ||
          payload?.storeId ||
          payload?.store?.id ||
          payload?.data?.store_id ||
          payload?.data?.storeId ||
          payload?.data?.store?.id ||
          '',
      );
      const orderId = String(
        payload?.order_id ||
          payload?.orderId ||
          payload?.order?.id ||
          payload?.data?.order_id ||
          payload?.data?.orderId ||
          payload?.data?.id ||
          payload?.data?.order?.id ||
          '',
      );

      if (!storeId || !orderId) {
        this.logger.warn(`[Aiqfome] webhook sem storeId/orderId. event=${event || 'N/A'}`);
        return;
      }

      const integration = await this.repo.findOneBy({ aiqfomeStoreId: storeId, active: true } as any);
      if (!integration) {
        this.logger.warn(`[Aiqfome] integração não encontrada para storeId=${storeId}`);
        return;
      }

      this.logger.log(`[Aiqfome] webhook recebido event=${event} storeId=${storeId} orderId=${orderId}`);

      if (['new-order', 'read-order', 'ready-order'].includes(event)) {
        await this.importOrder(integration.id, orderId, storeId);
        return;
      }

      const link = await this.linkService.findByAiqfomeOrderId(orderId, storeId);

      if (event === 'cancel-order') {
        if (!link?.deliveryId) {
          this.logger.warn(`[Aiqfome] cancel-order sem vínculo local. orderId=${orderId}`);
          return;
        }

        await this.deliveries.updateOne(
          { id: link.deliveryId } as any,
          {
            $set: {
              status: StatusDelivery.CANCELED,
              isActive: false,
              externalStatus: 'aiqfome:cancel-order',
              updatedAt: new Date(),
            },
          } as any,
        );
        const updatedDelivery = await this.deliveries.findOneBy({ id: link.deliveryId } as any);
        if (updatedDelivery) {
          this.ordersGateway.emitDeliveryUpdated(
            DeliveryResult.fromEntity(updatedDelivery),
            updatedDelivery.establishment?.cityId,
          );
        }
        this.logger.warn(`[Aiqfome] entrega cancelada/desativada por webhook. deliveryId=${link.deliveryId}`);
        return;
      }

      if (event === 'order-refund') {
        this.logger.warn(`[Aiqfome] order-refund recebido. orderId=${orderId} storeId=${storeId}`);
        return;
      }

      if (event === 'order-logistic') {
        if (link?.deliveryId) {
          const status = String(payload?.status || payload?.data?.status || payload?.data?.logistic_status || event);
          await this.deliveries.updateOne(
            { id: link.deliveryId } as any,
            { $set: { logisticsStatus: status, externalStatus: `aiqfome:${status}`, updatedAt: new Date() } } as any,
          );
          this.logger.log(`[Aiqfome] status logístico recebido. deliveryId=${link.deliveryId} status=${status}`);
        } else {
          this.logger.log(`[Aiqfome] order-logistic sem vínculo local. orderId=${orderId}`);
        }
        return;
      }

      this.logger.log(`[Aiqfome] evento sem tratamento específico: ${event || 'N/A'}`);
    } catch (error: any) {
      this.logger.error(`[Aiqfome] erro ao tratar webhook: ${error?.message || error}`, error?.stack || error);
    }
  }

  async fetchOrderDetails(integration: AiqfomeIntegrationEntity, orderId: string) {
    let validIntegration = await this.ensureValidToken(integration);

    const request = () =>
      axios.get(this.buildAiqfomeUrl(`/orders/${orderId}`), {
        headers: { Authorization: `Bearer ${validIntegration.accessToken}` },
      });

    try {
      return (await request()).data;
    } catch (error: any) {
      if (error?.response?.status === 401) {
        validIntegration = await this.refreshToken(validIntegration.id);
        try {
          return (await request()).data;
        } catch (retryError: any) {
          this.logger.error(
            `[Aiqfome] erro ao buscar pedido após refresh. status=${retryError?.response?.status || retryError?.status || 'N/A'} body=${this.summarizeErrorBody(retryError?.response?.data)}`,
          );
          throw retryError;
        }
      }

      this.logger.error(
        `[Aiqfome] erro ao buscar pedido. status=${error?.response?.status || error?.status || 'N/A'} body=${this.summarizeErrorBody(error?.response?.data)}`,
      );
      throw error;
    }
  }

  private isFinalizedOrCanceledOrder(order: any) {
    const status = String(
      order?.status || order?.data?.status || order?.timeline?.status || '',
    ).toLowerCase();
    const timelineValues = Object.values(order?.timeline || {})
      .filter(Boolean)
      .map((value) => String(value).toLowerCase())
      .join(' ');

    return Boolean(
      order?.is_cancelled ||
        order?.is_delivered ||
        order?.timeline?.cancelled_at ||
        ['cancel', 'canceled', 'cancelled', 'delivered', 'finished', 'finalized', 'concluded'].some(
          (token) => status.includes(token) || timelineValues.includes(token),
        ),
    );
  }

  async importOrder(integrationId?: string, orderId?: string, storeId?: string) {
    const normalizedOrderId = String(orderId || '').trim();
    if (!normalizedOrderId) {
      this.logger.warn('[Aiqfome] importação ignorada: orderId vazio');
      return { success: false, message: 'orderId obrigatório para importar pedido aiqfome.' };
    }

    const integration = integrationId
      ? await this.repo.findOneBy({ id: integrationId })
      : await this.repo.findOneBy({ aiqfomeStoreId: storeId || '', active: true } as any);

    if (!integration) {
      this.logger.warn('[Aiqfome] importação ignorada: integração não encontrada');
      return { success: false, message: 'Integração aiqfome não encontrada.' };
    }

    if (!integration.active || !integration.aiqfomeStoreId || !integration.shopkeeperId) {
      this.logger.warn('[Aiqfome] integração inválida para importação');
      return { success: false, message: 'Integração aiqfome inválida para importação.' };
    }

    const duplicate = await this.linkService.findByAiqfomeOrderId(
      normalizedOrderId,
      integration.aiqfomeStoreId,
    );
    if (duplicate) {
      this.logger.log('[Aiqfome] pedido já importado ignorado');
      return duplicate;
    }

    let order: any;
    try {
      order = await this.fetchOrderDetails(integration, normalizedOrderId);
    } catch {
      this.logger.error('[Aiqfome] erro ao buscar pedido para importação');
      return { success: false, message: 'Erro ao buscar detalhes do pedido aiqfome.' };
    }

    if (this.isFinalizedOrCanceledOrder(order)) {
      this.logger.log('[Aiqfome] pedido cancelado/finalizado ignorado');
      return { success: false, message: 'Pedido aiqfome cancelado ou finalizado não importado.' };
    }

    const mapped = this.mapAiqfomeOrderToDelivery(order, normalizedOrderId);
    const result = await this.deliveryService.createDelivery(
      {
        ...mapped,
        establishmentId: integration.shopkeeperId,
        status: StatusDelivery.AWAITING_RELEASE,
      },
      { id: integration.shopkeeperId } as any,
      { skipCreditConsumption: true, creditOrderId: normalizedOrderId },
    );

    await this.linkService.createLink({
      aiqfomeOrderId: normalizedOrderId,
      aiqfomeDisplayId: String(order?.display_id || order?.displayId || order?.data?.display_id || ''),
      storeId: integration.aiqfomeStoreId,
      storeName: integration.storeName,
      deliveryId: result.id,
      shopkeeperId: integration.shopkeeperId,
    });
    this.logger.log('[Aiqfome] vínculo criado');
    this.logger.log('[Aiqfome] pedido importado');

    this.markOrderAsRead(integration, normalizedOrderId).catch((error: any) => {
      this.logger.warn(`[Aiqfome] falha ao enviar mark-as-read: ${error?.message || error}`);
    });

    return result;
  }

  private async markOrderAsRead(integration: AiqfomeIntegrationEntity, orderId: string) {
    const validIntegration = await this.ensureValidToken(integration);
    await axios.post(
      this.buildAiqfomeUrl('/orders/mark-as-read'),
      { order_id: orderId },
      { headers: { Authorization: `Bearer ${validIntegration.accessToken}` } },
    );
    this.logger.log('[Aiqfome] mark-as-read enviado');
  }

  private parseNumber(value: any) {
    const normalized = Number(String(value ?? '').replace(',', '.'));
    return Number.isFinite(normalized) ? normalized : 0;
  }

  private resolvePaymentType(paymentMethod: any) {
    const methodText = String(
      paymentMethod?.name || paymentMethod?.method || paymentMethod?.type || paymentMethod?.description || '',
    ).toLowerCase();

    if (paymentMethod?.pre_paid === true || paymentMethod?.prepaid === true) {
      return PaymentType.PAGO;
    }
    if (methodText.includes('pix')) return PaymentType.PIX;
    if (methodText.includes('dinheiro') || methodText.includes('cash')) return PaymentType.DINHEIRO;
    return PaymentType.CARTAO;
  }

  mapAiqfomeOrderToDelivery(order: any, orderId: string) {
    const data = order?.data || order || {};
    const user = data?.user || order?.user || {};
    const address = user?.address || data?.address || order?.address || {};
    const paymentMethod = order?.payment_method || data?.payment_method || order?.paymentMethod || {};
    const items = Array.isArray(data?.items)
      ? data.items
      : Array.isArray(order?.items)
        ? order.items
        : [];
    const latitude = this.parseNumber(address?.latitude || address?.lat);
    const longitude = this.parseNumber(address?.longitude || address?.lng || address?.lon);
    const clientName = `${user?.name || ''} ${user?.surname || ''}`.trim() ||
      String(data?.user_name || order?.user_name || '').trim() ||
      'Cliente aiqfome';
    const clientPhone = String(
      user?.mobile_phone || user?.phone_number || address?.phone || '',
    ).replace(/\D/g, '');
    const street = String(address?.street_name || address?.street || '').trim();
    const number = String(address?.number || '').trim();
    const complement = String(address?.complement || '').trim();
    const reference = String(address?.reference || '').trim();
    const neighborhood = String(address?.neighborhood_name || address?.neighborhood || '').trim();
    const city = String(address?.city_name || address?.city || '').trim();
    const state = String(address?.state_uf || address?.state || '').trim();
    const zipCode = String(address?.zip_code || address?.zipcode || '').trim();
    const clientAddress = [street, number].filter(Boolean).join(', ');
    const addressLine = [clientAddress, complement, neighborhood, city, state, zipCode]
      .filter(Boolean)
      .join(' - ');
    const displayId = String(order?.display_id || order?.displayId || data?.display_id || '').trim();
    const itemLines = items.map((item) => {
      const quantity = item?.quantity || item?.amount || item?.qty || 1;
      const name = item?.name || item?.title || item?.description || 'Item';
      return `${quantity}x ${name}`;
    });
    const orderNotes = String(order?.observation || data?.observation || data?.notes || order?.notes || '').trim();
    const paymentDescription = String(
      paymentMethod?.name || paymentMethod?.method || paymentMethod?.description || paymentMethod?.type || '',
    ).trim();
    const changeFor = paymentMethod?.change_for || paymentMethod?.changeFor || paymentMethod?.change;
    const total =
      this.parseNumber(paymentMethod?.total) ||
      this.parseNumber(paymentMethod?.subtotal) ||
      this.parseNumber(order?.total || data?.total);
    const observation = [
      `Pedido aiqfome #${orderId}`,
      displayId ? `ID visível: ${displayId}` : '',
      itemLines.length ? `Itens:\n${itemLines.join('\n')}` : '',
      orderNotes ? `Observações do pedido: ${orderNotes}` : '',
      paymentDescription ? `Forma de pagamento: ${paymentDescription}` : '',
      changeFor ? `Troco para: ${changeFor}` : '',
      addressLine ? `Endereço: ${addressLine}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    return {
      clientName,
      clientPhone,
      clientAddress,
      addressComplement: complement,
      addressReference: reference,
      addressNeighborhood: neighborhood,
      addressCity: city,
      addressState: state,
      addressZipCode: zipCode,
      addressLatitude: latitude || undefined,
      addressLongitude: longitude || undefined,
      addressMapsUrl: latitude && longitude ? `https://www.google.com/maps?q=${latitude},${longitude}` : undefined,
      observation,
      payment: this.resolvePaymentType(paymentMethod),
      value: String(total || 0),
      soda: 'NÃO',
    };
  }

  async syncStatus(deliveryId: string) {
    const link = await this.linkService.findByDeliveryId(deliveryId);
    if (!link) return { success: true };
    const delivery = await this.deliveries.findOneBy({ id: deliveryId } as any);
    await this.syncStatusFromDelivery(delivery, delivery);
    return { success: true };
  }

  async syncStatusFromDelivery(previousDelivery?: DeliveryEntity, nextDelivery?: DeliveryEntity) {
    const deliveryId = previousDelivery?.id || nextDelivery?.id;
    const nextStatus = nextDelivery?.status;

    if (!deliveryId || !nextStatus) return;

    const link = await this.linkService.findByDeliveryId(deliveryId);
    if (!link) return;

    const integration = await this.repo.findOneBy({
      aiqfomeStoreId: link.storeId,
      shopkeeperId: link.shopkeeperId,
      active: true,
    } as any);

    if (!integration) {
      this.logger.warn(`[Aiqfome] integração não encontrada para sincronizar status. deliveryId=${deliveryId}`);
      return;
    }

    const steps: Array<{
      status: StatusDelivery;
      endpointPath: string;
      flagName: keyof AiqfomeOrderLinkEntity;
    }> = [
      { status: StatusDelivery.ONCOURSE, endpointPath: 'pickup-ongoing', flagName: 'pickupOngoingSynced' },
      { status: StatusDelivery.ARRIVED_AT_STORE, endpointPath: 'arrived-at-merchant', flagName: 'arrivedAtMerchantSynced' },
      { status: StatusDelivery.COLLECTED, endpointPath: 'delivery-ongoing', flagName: 'deliveryOngoingSynced' },
      { status: StatusDelivery.ARRIVED_AT_DESTINATION, endpointPath: 'arrived-at-customer', flagName: 'arrivedAtCustomerSynced' },
      { status: StatusDelivery.FINISHED, endpointPath: 'order-delivered', flagName: 'deliveredSynced' },
    ];

    const targetIndex = steps.findIndex((step) => step.status === nextStatus);
    if (targetIndex < 0) return;

    let currentLink = link;
    for (const step of steps.slice(0, targetIndex + 1)) {
      if (currentLink?.[step.flagName]) continue;

      try {
        const updated = await this.postLogisticStatus(
          integration,
          currentLink,
          `/logistic/${currentLink.aiqfomeOrderId}/${step.endpointPath}`,
          step.flagName,
        );
        currentLink = updated || ({ ...currentLink, [step.flagName]: true } as AiqfomeOrderLinkEntity);
      } catch (error: any) {
        this.logger.warn(
          `[Aiqfome] falha ao sincronizar status logístico ${step.endpointPath}. deliveryId=${deliveryId} status=${error?.response?.status || error?.status || 'N/A'} body=${this.summarizeErrorBody(error?.response?.data)} message=${error?.message || error}`,
        );
        break;
      }
    }
  }

  private async postLogisticStatus(
    integration: AiqfomeIntegrationEntity,
    link: AiqfomeOrderLinkEntity,
    endpointPath: string,
    flagName: keyof AiqfomeOrderLinkEntity,
  ) {
    const validIntegration = await this.ensureValidToken(integration);
    await axios.post(
      this.buildAiqfomeUrl(endpointPath),
      {},
      { headers: { Authorization: `Bearer ${validIntegration.accessToken}` } },
    );
    this.logger.log(
      `[Aiqfome] status logístico enviado endpoint=${endpointPath} orderId=${link.aiqfomeOrderId}`,
    );
    return this.linkService.updateSyncFlags(link.deliveryId, { [flagName]: true } as any);
  }
}
