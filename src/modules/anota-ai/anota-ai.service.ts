import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import axios, { AxiosInstance } from 'axios';
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
  private readonly logger = new Logger(AnotaAiService.name);
  private readonly http: AxiosInstance;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(UserEntity)
    private readonly userRepository: MongoRepository<UserEntity>,
    @InjectRepository(DeliveryEntity)
    private readonly deliveryRepository: MongoRepository<DeliveryEntity>,
    private readonly deliveryService: DeliveryService,
  ) {
    this.http = axios.create({
      baseURL: this.configService.get<string>('ANOTA_AI_BASE_URL') || '',
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
  ): Promise<void> {
    this.logger.log('[ANOTA AI] Webhook recebido');
    this.logger.log(
      `[ANOTA AI] Payload recebido ${JSON.stringify(rawPayload || {})}`,
    );
    this.logWebhookHeaders(headers);

    try {
      if (this.configService.get<string>('ANOTA_AI_ENABLED') === 'false') {
        this.logger.warn('[ANOTA AI] Integração global desativada');
        return;
      }

      const orderId = getAnotaAiOrderId(rawPayload);
      let payload = rawPayload || {};
      let establishment = await this.findStoreFromWebhookPayload(payload);
      let fetchedFullOrder = false;

      if (orderId && this.shouldFetchFullOrder(payload)) {
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
      if (error?.config?.url?.includes('/partnerauth/v2/orders/')) {
        this.logger.error(
          '[ANOTA AI] Erro ao consultar pedido na API',
          error?.stack || error,
        );
      }
      this.logger.error(
        '[ANOTA AI] Erro ao processar webhook',
        error?.stack || error,
      );
    }
  }

  async getOrder(orderId: string, establishment?: UserEntity): Promise<any> {
    try {
      const response = await this.http.get(
        `/partnerauth/v2/orders/${orderId}`,
        {
          headers: this.getAuthHeaders(establishment),
        },
      );
      return response.data;
    } catch (error) {
      this.logger.error(
        '[ANOTA AI] Erro ao consultar pedido na API',
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  async listOrders(filters?: {
    status?: string | number;
    page?: number;
    limit?: number;
  }): Promise<any> {
    const response = await this.http.get('/partnerauth/v2/orders', {
      params: filters,
      headers: this.getAuthHeaders(),
    });
    return response.data;
  }

  async acceptOrder(orderId: string): Promise<any> {
    return this.postOrderAction(orderId, 'accept');
  }

  async markOrderReady(orderId: string): Promise<any> {
    return this.postOrderAction(orderId, 'ready');
  }

  async finishOrder(orderId: string): Promise<any> {
    return this.postOrderAction(orderId, 'finish');
  }

  async cancelOrder(orderId: string, reason: string): Promise<any> {
    return this.postOrderAction(orderId, 'cancel', { reason });
  }

  async fetchAcceptedOrdersForPolling(page = 1, limit = 50): Promise<any> {
    return this.listOrders({ status: 1, page, limit });
  }

  private async postOrderAction(
    orderId: string,
    action: string,
    body?: any,
  ): Promise<any> {
    const response = await this.http.post(
      `/partnerauth/v2/orders/${orderId}/${action}`,
      body || {},
      { headers: this.getAuthHeaders() },
    );
    return response.data;
  }

  private getAuthHeaders(establishment?: UserEntity) {
    const storeToken = String(establishment?.anotaAiToken || '').trim();
    const globalToken = String(
      this.configService.get<string>('ANOTA_AI_TOKEN') || '',
    ).trim();

    return {
      Authorization: storeToken || globalToken,
      'Content-Type': 'application/json',
    };
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
    ];

    for (const candidate of candidates) {
      if (
        candidate &&
        typeof candidate === 'object' &&
        (candidate._id ||
          candidate.id ||
          candidate.status ||
          candidate.customer)
      ) {
        return candidate;
      }
    }

    return payload;
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
        '[ANOTA AI] Token externo configurado, mas nenhum header conhecido de token foi recebido',
      );
      return true;
    }

    const isValid = receivedTokens.some((token) => token === expectedToken);
    if (!isValid) {
      this.logger.warn('[ANOTA AI] Token externo inválido');
    }

    return isValid;
  }

  private logWebhookHeaders(headers?: Record<string, any>) {
    const mainHeaders = this.pickWebhookHeaders(headers);
    this.logger.log(
      `[ANOTA AI] Headers principais do webhook ${JSON.stringify(mainHeaders)}`,
    );
  }

  private pickWebhookHeaders(headers?: Record<string, any>) {
    const normalizedHeaders = this.normalizeHeaders(headers);
    const mainHeaderNames = [
      'x-token',
      'x-webhook-token',
      'authorization',
      'token',
      'content-type',
      'user-agent',
    ];

    return mainHeaderNames.reduce(
      (result, headerName) => {
        if (normalizedHeaders[headerName] !== undefined) {
          result[headerName] = normalizedHeaders[headerName];
        }

        return result;
      },
      {} as Record<string, any>,
    );
  }

  private getWebhookTokenCandidates(headers?: Record<string, any>) {
    const normalizedHeaders = this.normalizeHeaders(headers);
    return ['x-token', 'x-webhook-token', 'authorization', 'token']
      .map((headerName) => normalizedHeaders[headerName])
      .flatMap((value) => (Array.isArray(value) ? value : [value]))
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .map((value) => value.replace(/^Bearer\s+/i, '').trim());
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
