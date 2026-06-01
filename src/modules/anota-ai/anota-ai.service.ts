import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import axios, { AxiosError, AxiosInstance } from 'axios';
import { MongoRepository } from 'typeorm';
import { DeliveryService } from '../../delivery/delivery.service';
import { DeliveryEntity, UserEntity } from '../../database/entities';
import { UserType } from '../../shared/constants/enums.constants';
import {
  getAnotaAiExternalRestaurantId,
  getAnotaAiIfoodOrderId,
  getAnotaAiOrderId,
  getAnotaAiOrderStatus,
  getAnotaAiStoreId,
  isAcceptedAnotaAiOrder,
  isIfoodOrderFromAnotaAi,
  mapAnotaAiOrderToDelivery,
} from './anota-ai.mapper';

@Injectable()
export class AnotaAiService {
  private static readonly API_PREFIX = '/partnerauth/v2';
  private static readonly ORDERS_PATH = `${AnotaAiService.API_PREFIX}/orders`;

  private readonly logger = new Logger(AnotaAiService.name);
  private readonly http: AxiosInstance;
  private readonly anotaAiBaseUrl: string;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(UserEntity)
    private readonly userRepository: MongoRepository<UserEntity>,
    @InjectRepository(DeliveryEntity)
    private readonly deliveryRepository: MongoRepository<DeliveryEntity>,
    private readonly deliveryService: DeliveryService,
  ) {
    this.anotaAiBaseUrl = this.normalizeAnotaAiBaseUrl(
      this.configService.get<string>('ANOTA_AI_BASE_URL') || '',
    );
    this.http = axios.create({
      baseURL: this.anotaAiBaseUrl,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  getHealth() {
    return {
      status: 'ok',
      integration: 'anota-ai',
    };
  }

  async processWebhook(
    rawPayload: any,
    headers?: Record<string, any>,
    requestInfo?: { ip?: string; origin?: string },
  ): Promise<void> {
    this.logger.log('[ANOTA AI] Webhook recebido');
    this.logger.log(
      `[ANOTA AI] Payload recebido ${JSON.stringify(rawPayload || {})}`,
    );
    this.logWebhookRequest(rawPayload, headers, requestInfo);

    try {
      if (this.configService.get<string>('ANOTA_AI_ENABLED') === 'false') {
        this.logger.warn('[ANOTA AI] Integração global desativada');
        return;
      }

      if (this.shouldRunPollingFallback(rawPayload)) {
        this.logger.log(
          '[ANOTA AI] Webhook sem dados do pedido, iniciando polling de fallback',
        );
        await this.runPollingForAllStores();
        return;
      }

      const orderId = getAnotaAiOrderId(rawPayload);
      let payload = rawPayload || {};
      let establishment = await this.findStoreFromWebhookPayload(payload);
      let fetchedFullOrder = false;

      if (orderId && this.shouldFetchFullOrder(payload)) {
        this.warnEnabledStoreWithoutToken(establishment);
        payload = await this.getOrder(orderId, establishment);
        fetchedFullOrder = true;
        this.logger.log('[ANOTA AI] Pedido consultado com sucesso na API');
      }

      payload = this.extractOrderPayload(payload);

      if (fetchedFullOrder) {
        establishment =
          (await this.findLinkedStore(payload, rawPayload)) || establishment;
      } else if (!establishment) {
        establishment = await this.findLinkedStore(payload, rawPayload);
      }

      const fullOrderId = getAnotaAiOrderId(payload) || orderId;
      const status = getAnotaAiOrderStatus(payload);
      const normalizedStatus = String(status ?? '').trim();

      if (normalizedStatus === '0') {
        this.logger.log('[ANOTA AI] Pedido em análise, ignorando por enquanto');
        return;
      }

      if (normalizedStatus === '2') {
        this.logger.log(
          '[ANOTA AI] Pedido pronto recebido, não criando nova entrega',
        );
        return;
      }

      if (normalizedStatus === '3') {
        this.logger.log(
          '[ANOTA AI] Pedido finalizado recebido, não criando nova entrega',
        );
        return;
      }

      if (normalizedStatus === '4') {
        this.logger.log('[ANOTA AI] Pedido cancelado recebido');
        return;
      }

      if (normalizedStatus !== '1') {
        this.logger.log('[ANOTA AI] Status não elegível para importação');
        return;
      }

      this.logger.log('[ANOTA AI] Pedido em produção confirmado');

      if (!isAcceptedAnotaAiOrder(payload)) {
        this.logger.log('[ANOTA AI] Status não elegível para importação');
        return;
      }

      if (!fullOrderId) {
        this.logger.warn('[ANOTA AI] Pedido sem ID externo, ignorando');
        return;
      }

      if (!establishment) {
        return;
      }

      this.warnEnabledStoreWithoutToken(establishment);

      if (!establishment.anotaAiEnabled) {
        this.logger.warn('[ANOTA AI] Integração desativada para esta loja');
        return;
      }

      if (
        establishment.anotaAiIgnoreIfoodOrders !== false &&
        isIfoodOrderFromAnotaAi(payload)
      ) {
        this.logger.log(
          '[ANOTA AI] Pedido iFood ignorado para evitar duplicidade',
        );
        return;
      }

      if (await this.hasDuplicateDelivery(fullOrderId, payload)) {
        this.logger.log('[ANOTA AI] Pedido duplicado ignorado');
        return;
      }

      const delivery = mapAnotaAiOrderToDelivery(payload, establishment.id);
      await this.deliveryService.createDelivery(
        delivery,
        {
          id: establishment.id,
          type: establishment.type || UserType.SHOPKEEPER,
          permission: establishment.permission,
        } as any,
        { skipCreditConsumption: true, creditOrderId: fullOrderId },
      );

      this.logger.log(
        '[ANOTA AI] Pedido criado no Rappidex em aguardando liberação',
      );
    } catch (error: any) {
      if (error?.config?.url?.includes(AnotaAiService.ORDERS_PATH)) {
        this.logAxiosError('[ANOTA AI] Erro ao consultar pedido na API', error);
      }
      this.logger.error(
        '[ANOTA AI] Erro ao processar webhook',
        error?.stack || error,
      );
    }
  }

  async getOrder(orderId: string, establishment?: UserEntity): Promise<any> {
    const path = `${AnotaAiService.ORDERS_PATH}/${orderId}`;
    this.logAnotaAiRequest('GET', path);

    try {
      const response = await this.http.get(path, {
        headers: this.getAuthHeaders(establishment),
      });
      return response.data;
    } catch (error) {
      this.logAxiosError('[ANOTA AI] Erro ao consultar pedido na API', error);
      throw error;
    }
  }

  async listOrders(
    filters?: {
      status?: string | number;
      page?: number;
      limit?: number;
    },
    establishment?: UserEntity,
  ): Promise<any> {
    const path = AnotaAiService.ORDERS_PATH;
    this.logAnotaAiRequest('GET', path, filters, 'polling');

    const response = await this.http.get(path, {
      params: filters,
      headers: this.getAuthHeaders(establishment),
    });
    return response.data;
  }

  async acceptOrder(orderId: string, establishment?: UserEntity): Promise<any> {
    return this.postOrderAction(orderId, 'accept', undefined, establishment);
  }

  async markOrderReady(
    orderId: string,
    establishment?: UserEntity,
  ): Promise<any> {
    return this.postOrderAction(orderId, 'ready', undefined, establishment);
  }

  async finishOrder(orderId: string, establishment?: UserEntity): Promise<any> {
    return this.postOrderAction(orderId, 'finish', undefined, establishment);
  }

  async cancelOrder(
    orderId: string,
    reason: string,
    establishment?: UserEntity,
  ): Promise<any> {
    return this.postOrderAction(orderId, 'cancel', { reason }, establishment);
  }

  async fetchAcceptedOrdersForPolling(
    establishment: UserEntity,
    page = 1,
    limit = 50,
  ): Promise<any> {
    this.logger.log('[ANOTA AI] Buscando pedidos em produção por polling');
    return this.listOrders({ status: 1, page, limit }, establishment);
  }

  async runPollingForAllStores(): Promise<void> {
    this.logger.log('[ANOTA AI] Buscando lojas Anota AI ativas para polling');
    const establishments = await this.userRepository.find({
      where: {
        anotaAiEnabled: true,
      } as any,
    });

    for (const establishment of establishments) {
      this.logger.log('[ANOTA AI] Loja consultada por polling');

      try {
        const response = await this.fetchAcceptedOrdersForPolling(
          establishment,
          1,
          50,
        );
        const orders = this.extractOrdersFromListResponse(response);
        this.logger.log(
          `[ANOTA AI] Pedidos retornados no polling ${orders.length}`,
        );

        for (const order of orders) {
          await this.processPollingOrder(order, establishment);
        }
      } catch (error: any) {
        this.logAxiosError(
          '[ANOTA AI] Erro ao consultar pedidos via polling',
          error,
        );
      }
    }
  }

  private async postOrderAction(
    orderId: string,
    action: string,
    body?: any,
    establishment?: UserEntity,
  ): Promise<any> {
    const path = `${AnotaAiService.ORDERS_PATH}/${orderId}/${action}`;
    this.logAnotaAiRequest('POST', path);

    const response = await this.http.post(path, body || {}, {
      headers: this.getAuthHeaders(establishment),
    });
    return response.data;
  }

  private logAnotaAiRequest(
    method: string,
    path: string,
    params?: Record<string, any>,
    context?: 'polling',
  ) {
    const finalUrl = this.buildAnotaAiUrl(path, params);

    this.logger.log(`[ANOTA AI] Base URL Anota AI: ${this.anotaAiBaseUrl}`);
    this.logger.log(`[ANOTA AI] Path usado: ${path}`);

    if (context === 'polling') {
      this.logger.log(`[ANOTA AI] URL polling Anota AI: ${finalUrl}`);
      return;
    }

    this.logger.log(
      `[ANOTA AI] URL Anota AI ${method.toUpperCase()}: ${finalUrl}`,
    );
  }

  private logAxiosError(context: string, error: any) {
    if (!axios.isAxiosError(error)) {
      this.logger.error(context, error instanceof Error ? error.stack : error);
      return;
    }

    const axiosError = error as AxiosError;
    const statusCode = axiosError.response?.status;
    const method = String(axiosError.config?.method || 'GET').toUpperCase();
    const url = this.buildAnotaAiUrl(
      axiosError.config?.url || '',
      axiosError.config?.params as Record<string, any>,
      axiosError.config?.baseURL,
    );
    const responseData = this.serializeLogData(axiosError.response?.data);

    this.logger.error(
      `${context} | status=${statusCode || 'sem_status'} | statusCode=${statusCode || 'sem_status'} | url=${url} | method=${method} | response.data=${responseData}`,
      axiosError.stack,
    );
  }

  private normalizeAnotaAiBaseUrl(baseUrl: string) {
    const normalizedBaseUrl = String(baseUrl || '')
      .trim()
      .replace(/\/+$/, '');
    const duplicatedPrefixPattern = new RegExp(
      `${AnotaAiService.API_PREFIX.replace(/\//g, '\\/')}$`,
      'i',
    );

    return normalizedBaseUrl.replace(duplicatedPrefixPattern, '');
  }

  private buildAnotaAiUrl(
    path: string,
    params?: Record<string, any>,
    baseUrl = this.anotaAiBaseUrl,
  ) {
    const sanitizedPath = this.sanitizeUrlForLog(path || '');
    const sanitizedBaseUrl = this.sanitizeUrlForLog(
      this.normalizeAnotaAiBaseUrl(baseUrl || ''),
    );
    let finalUrl: string;

    if (/^https?:\/\//i.test(sanitizedPath)) {
      finalUrl = sanitizedPath;
    } else if (sanitizedBaseUrl) {
      finalUrl = `${sanitizedBaseUrl}${sanitizedPath.startsWith('/') ? '' : '/'}${sanitizedPath}`;
    } else {
      finalUrl = sanitizedPath;
    }

    const queryString = this.buildQueryString(params);
    if (queryString) {
      finalUrl += `${finalUrl.includes('?') ? '&' : '?'}${queryString}`;
    }

    return finalUrl;
  }

  private buildQueryString(params?: Record<string, any>) {
    if (!params || typeof params !== 'object') {
      return '';
    }

    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === null) {
        return;
      }

      if (Array.isArray(value)) {
        value.forEach((item) => searchParams.append(key, String(item)));
        return;
      }

      searchParams.append(key, String(value));
    });

    return searchParams.toString();
  }

  private sanitizeUrlForLog(url: string) {
    return String(url || '').replace(
      /([?&](?:authorization|token|access_token|api_key)=)[^&]+/gi,
      '$1[REDACTED]',
    );
  }

  private serializeLogData(data: any) {
    if (data === undefined) {
      return 'undefined';
    }

    try {
      return JSON.stringify(data);
    } catch (error) {
      return String(data);
    }
  }

  private getAuthHeaders(establishment?: UserEntity) {
    const storeToken = String(establishment?.anotaAiToken || '').trim();
    const globalToken = String(
      this.configService.get<string>('ANOTA_AI_TOKEN') || '',
    ).trim();
    const token = storeToken || globalToken;

    if (establishment?.anotaAiEnabled && !storeToken) {
      this.logger.warn(
        `[ANOTA AI] Loja ${establishment.id} está com Anota AI ativa sem anotaAiToken cadastrado; usando ANOTA_AI_TOKEN global apenas como fallback opcional`,
      );
    }

    if (!token) {
      this.logger.warn(
        '[ANOTA AI] Nenhum token disponível para consultar a API da Anota AI',
      );
    }

    return {
      ...(token ? { Authorization: token } : {}),
      'Content-Type': 'application/json',
    };
  }

  private warnEnabledStoreWithoutToken(establishment?: UserEntity) {
    if (
      establishment?.anotaAiEnabled &&
      !String(establishment.anotaAiToken || '').trim()
    ) {
      this.logger.warn(
        `[ANOTA AI] Loja ${establishment.id} está com Anota AI ativa, mas sem token próprio em anotaAiToken`,
      );
    }
  }

  private shouldFetchFullOrder(payload: any) {
    const orderPayload = this.extractOrderPayload(payload);
    return (
      !orderPayload?.customer ||
      !orderPayload?.deliveryAddress ||
      !orderPayload?.items
    );
  }

  private extractOrderPayload(payload: any) {
    if (!payload || typeof payload !== 'object') {
      return payload || {};
    }

    const candidates = [
      payload?.order,
      payload?.data,
      payload?.payload,
      payload?.resource,
      payload?.result,
      payload?.orderData,
      payload?.orderDetails,
      payload?.body,
      payload,
    ];

    return (
      candidates.find((candidate) => this.looksLikeOrderPayload(candidate)) ||
      payload
    );
  }

  private looksLikeOrderPayload(candidate: any) {
    if (!candidate || typeof candidate !== 'object') {
      return false;
    }

    return [
      '_id',
      'id',
      'status',
      'customer',
      'deliveryAddress',
      'payment',
      'totals',
      'items',
    ].some((key) => candidate[key] !== undefined && candidate[key] !== null);
  }

  private shouldRunPollingFallback(payload: any): boolean {
    if (!payload || typeof payload !== 'object') {
      return true;
    }

    if (!Object.keys(payload).length) {
      return true;
    }

    const orderPayload = this.extractOrderPayload(payload);
    const hasOrderId = Boolean(
      getAnotaAiOrderId(payload) || getAnotaAiOrderId(orderPayload),
    );
    const hasStatus = Boolean(
      getAnotaAiOrderStatus(orderPayload) || getAnotaAiOrderStatus(payload),
    );
    const hasOrderDetails = Boolean(
      orderPayload?.customer ||
      orderPayload?.deliveryAddress ||
      orderPayload?.items,
    );

    return !hasOrderId || !hasStatus || !hasOrderDetails;
  }

  private extractOrdersFromListResponse(response: any): any[] {
    const candidates = [
      response?.orders,
      response?.data,
      response?.items,
      response?.results,
      response?.result,
      response,
    ];

    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        return candidate;
      }

      if (Array.isArray(candidate?.orders)) {
        return candidate.orders;
      }

      if (Array.isArray(candidate?.data)) {
        return candidate.data;
      }
    }

    return [];
  }

  private async processPollingOrder(
    rawOrder: any,
    establishment: UserEntity,
  ): Promise<void> {
    let payload = this.extractOrderPayload(rawOrder);
    const orderId = getAnotaAiOrderId(payload) || getAnotaAiOrderId(rawOrder);
    const status =
      getAnotaAiOrderStatus(payload) || getAnotaAiOrderStatus(rawOrder);
    const normalizedStatus = String(status ?? '').trim();

    if (normalizedStatus === '0') {
      this.logger.log('[ANOTA AI] Pedido em análise ignorado via polling');
      return;
    }

    if (normalizedStatus === '2') {
      this.logger.log('[ANOTA AI] Pedido pronto ignorado via polling');
      return;
    }

    if (normalizedStatus === '3') {
      this.logger.log('[ANOTA AI] Pedido finalizado ignorado via polling');
      return;
    }

    if (normalizedStatus === '4') {
      this.logger.log('[ANOTA AI] Pedido cancelado ignorado via polling');
      return;
    }

    if (normalizedStatus !== '1') {
      return;
    }

    if (orderId && this.shouldFetchFullOrder(payload)) {
      try {
        payload = this.extractOrderPayload(
          await this.getOrder(orderId, establishment),
        );
      } catch (error: any) {
        this.logAxiosError(
          '[ANOTA AI] Erro ao consultar pedidos via polling',
          error,
        );
        return;
      }
    }

    const fullOrderId = getAnotaAiOrderId(payload) || orderId;
    if (!fullOrderId) {
      return;
    }

    if (await this.hasDuplicateDelivery(fullOrderId, payload)) {
      this.logger.log('[ANOTA AI] Pedido ignorado via polling por duplicidade');
      return;
    }

    if (!isAcceptedAnotaAiOrder(payload)) {
      return;
    }

    if (
      establishment.anotaAiIgnoreIfoodOrders !== false &&
      isIfoodOrderFromAnotaAi(payload)
    ) {
      this.logger.log(
        '[ANOTA AI] Pedido iFood ignorado para evitar duplicidade',
      );
      return;
    }

    const delivery = mapAnotaAiOrderToDelivery(payload, establishment.id);
    await this.deliveryService.createDelivery(
      delivery,
      {
        id: establishment.id,
        type: establishment.type || UserType.SHOPKEEPER,
        permission: establishment.permission,
      } as any,
      { skipCreditConsumption: true, creditOrderId: fullOrderId },
    );

    this.logger.log('[ANOTA AI] Pedido importado via polling');
  }

  validateWebhookToken(headers?: Record<string, any>): boolean {
    const expectedToken = String(
      this.configService.get<string>('ANOTA_AI_WEBHOOK_TOKEN') || '',
    ).trim();
    if (!expectedToken) {
      return true;
    }

    const receivedTokens = this.getWebhookTokenCandidates(headers);
    // Após confirmar o header correto enviado pela Anota AI, bloquear webhooks sem token válido.
    if (!receivedTokens.length) {
      this.logger.warn(
        '[ANOTA AI] Token externo configurado, mas nenhum header conhecido de token foi recebido. Durante o primeiro teste real, o webhook sem token conhecido ainda será permitido para descobrir qual header a Anota AI usa. Depois da confirmação do header correto, webhooks sem token válido serão bloqueados.',
      );
      return true;
    }

    const normalizedExpectedToken = this.normalizeWebhookToken(expectedToken);
    const isValid = receivedTokens.some(
      (token) => token === normalizedExpectedToken,
    );
    if (!isValid) {
      this.logger.warn('[ANOTA AI] Token externo inválido');
    }

    return isValid;
  }

  private logWebhookRequest(
    payload: any,
    headers?: Record<string, any>,
    requestInfo?: { ip?: string; origin?: string },
  ) {
    const mainHeaders = this.pickWebhookHeaders(headers);
    const normalizedHeaders = this.normalizeHeaders(headers);
    const serializedBody = JSON.stringify(payload || {});
    const contentLength = normalizedHeaders['content-length'];
    const bodySize = contentLength ?? Buffer.byteLength(serializedBody, 'utf8');
    const bodyIsEmpty =
      !payload ||
      (typeof payload === 'object' &&
        !Array.isArray(payload) &&
        !Object.keys(payload).length);

    this.logger.log(
      `[ANOTA AI] Headers principais do webhook ${JSON.stringify(mainHeaders)}`,
    );
    this.logger.log(
      `[ANOTA AI] Origem do webhook ${JSON.stringify({
        ip: requestInfo?.ip,
        origin: requestInfo?.origin,
        userAgent: normalizedHeaders['user-agent'],
        contentType: normalizedHeaders['content-type'],
        bodySize,
        bodyIsEmpty,
      })}`,
    );
  }

  private pickWebhookHeaders(headers?: Record<string, any>) {
    const normalizedHeaders = this.normalizeHeaders(headers);
    const tokenHeaderNames = this.getWebhookTokenHeaderNames();
    const mainHeaderNames = [...tokenHeaderNames, 'content-type', 'user-agent'];

    return mainHeaderNames.reduce(
      (result, headerName) => {
        if (normalizedHeaders[headerName] !== undefined) {
          result[headerName] = tokenHeaderNames.includes(headerName)
            ? this.maskTokenHeaderValue(normalizedHeaders[headerName])
            : normalizedHeaders[headerName];
        }

        return result;
      },
      {} as Record<string, any>,
    );
  }

  private getWebhookTokenCandidates(headers?: Record<string, any>) {
    const normalizedHeaders = this.normalizeHeaders(headers);
    return this.getWebhookTokenHeaderNames()
      .map((headerName) => normalizedHeaders[headerName])
      .flatMap((value) => (Array.isArray(value) ? value : [value]))
      .map((value) => this.normalizeWebhookToken(value))
      .filter(Boolean);
  }

  private getWebhookTokenHeaderNames() {
    return [
      'x-token',
      'x-webhook-token',
      'x-external-token',
      'x-anota-token',
      'x-anota-ai-token',
      'authorization',
      'token',
    ];
  }

  private normalizeWebhookToken(value: any): string {
    return String(value || '')
      .trim()
      .replace(/^(Bearer|Token)\s+/i, '')
      .trim();
  }

  private maskTokenHeaderValue(value: any): any {
    if (Array.isArray(value)) {
      return value.map((item) => this.maskTokenHeaderValue(item));
    }

    const normalizedToken = this.normalizeWebhookToken(value);
    if (!normalizedToken) {
      return '';
    }

    if (normalizedToken.length <= 8) {
      return `${normalizedToken.slice(0, 2)}...${normalizedToken.slice(-2)}`;
    }

    return `${normalizedToken.slice(0, 4)}...${normalizedToken.slice(-4)}`;
  }

  private normalizeHeaders(headers?: Record<string, any>) {
    return Object.entries(headers || {}).reduce(
      (result, [key, value]) => {
        result[String(key).toLowerCase()] = value;
        return result;
      },
      {} as Record<string, any>,
    );
  }

  private async findStoreFromWebhookPayload(payload: any) {
    const orderPayload = this.extractOrderPayload(payload);
    const hasStoreLinkHint = Boolean(
      getAnotaAiExternalRestaurantId(orderPayload) ||
      getAnotaAiExternalRestaurantId(payload) ||
      getAnotaAiStoreId(orderPayload) ||
      getAnotaAiStoreId(payload),
    );

    if (!hasStoreLinkHint) {
      return undefined;
    }

    return this.findLinkedStore(orderPayload, payload);
  }

  private async findLinkedStore(payload: any, rawPayload?: any) {
    const externalRestaurantId =
      getAnotaAiExternalRestaurantId(payload) ||
      getAnotaAiExternalRestaurantId(rawPayload);

    if (externalRestaurantId) {
      this.logger.log(
        '[ANOTA AI] ID Externo do Restaurante encontrado no payload',
      );
      const establishment = await this.userRepository.findOne({
        where: {
          id: externalRestaurantId,
          isActive: true,
        } as any,
      });

      if (establishment) {
        this.logger.log(
          '[ANOTA AI] Loja encontrada pelo ID Externo do Restaurante',
        );
        return establishment;
      }
    } else {
      this.logger.warn(
        '[ANOTA AI] ID Externo do Restaurante não encontrado no payload',
      );
    }

    const root = getAnotaAiStoreId(payload) || getAnotaAiStoreId(rawPayload);
    if (root) {
      this.logger.log('[ANOTA AI] Root da Anota AI encontrado no payload');
      const establishment = await this.userRepository.findOne({
        where: {
          anotaAiStoreId: root,
          isActive: true,
        } as any,
      });

      if (establishment) {
        this.logger.log('[ANOTA AI] Loja encontrada pelo Root da Anota AI');
        return establishment;
      }
    } else {
      this.logger.warn('[ANOTA AI] Root da Anota AI não encontrado no payload');
    }

    this.logger.warn('[ANOTA AI] Loja não vinculada');
    return undefined;
  }

  private async hasDuplicateDelivery(
    orderId: string,
    payload: any,
  ): Promise<boolean> {
    const ifoodOrderId = getAnotaAiIfoodOrderId(payload);
    const externalIds = [orderId, ifoodOrderId].filter(Boolean) as string[];

    const duplicate = await this.deliveryRepository.findOne({
      where: {
        $or: [
          { anotaAiOrderId: orderId },
          { externalOrderId: orderId },
          { source: 'anotaai', externalOrderId: orderId },
          ...externalIds.map((id) => ({ ifoodOrderId: id })),
          ...externalIds.map((id) => ({ externalOrderId: id })),
        ],
      } as any,
    });

    return Boolean(duplicate);
  }
}
