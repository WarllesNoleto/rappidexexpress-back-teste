import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import axios, { AxiosInstance } from 'axios';
import { MongoRepository } from 'typeorm';
import { DeliveryService } from '../../delivery/delivery.service';
import { DeliveryEntity, UserEntity } from '../../database/entities';
import { UserType } from '../../shared/constants/enums.constants';
import {
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

  async processWebhook(rawPayload: any): Promise<void> {
    this.logger.log('[ANOTA AI] Webhook recebido');
    this.logger.log(`[ANOTA AI] Payload recebido ${JSON.stringify(rawPayload || {})}`);

    try {
      if (this.configService.get<string>('ANOTA_AI_ENABLED') === 'false') {
        this.logger.warn('[ANOTA AI] Integração global desativada');
        return;
      }

      const orderId = getAnotaAiOrderId(rawPayload);
      let payload = rawPayload || {};

      if (orderId && this.shouldFetchFullOrder(payload)) {
        payload = await this.getOrder(orderId);
        this.logger.log('[ANOTA AI] Pedido consultado com sucesso na API');
      }

      payload = this.extractOrderPayload(payload);

      const status = getAnotaAiOrderStatus(payload);
      if (String(status).trim() === '0') {
        this.logger.log('[ANOTA AI] Pedido em análise, ignorando por enquanto');
        return;
      }

      if (!isAcceptedAnotaAiOrder(payload)) {
        return;
      }

      this.logger.log('[ANOTA AI] Pedido em produção confirmado');

      const fullOrderId = getAnotaAiOrderId(payload) || orderId;
      if (!fullOrderId) {
        this.logger.warn('[ANOTA AI] Pedido sem ID externo, ignorando');
        return;
      }

      const storeId = getAnotaAiStoreId(payload);
      if (!storeId) {
        this.logger.warn('[ANOTA AI] Loja não vinculada - payload sem ID da loja para vincular o pedido');
        return;
      }

      const establishment = await this.findLinkedStore(storeId);
      if (!establishment) {
        this.logger.warn('[ANOTA AI] Loja não vinculada');
        return;
      }

      this.logger.log('[ANOTA AI] Loja vinculada encontrada');

      if (!establishment.anotaAiEnabled) {
        this.logger.warn('[ANOTA AI] Integração desativada para esta loja');
        return;
      }

      if (
        establishment.anotaAiIgnoreIfoodOrders !== false &&
        isIfoodOrderFromAnotaAi(payload)
      ) {
        this.logger.log('[ANOTA AI] Pedido iFood ignorado para evitar duplicidade');
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

      this.logger.log('[ANOTA AI] Pedido criado no Rappidex em aguardando liberação');
    } catch (error: any) {
      if (error?.config?.url?.includes('/partnerauth/v2/orders/')) {
        this.logger.error('[ANOTA AI] Erro ao consultar pedido na API', error?.stack || error);
      }
      this.logger.error('[ANOTA AI] Erro ao processar webhook', error?.stack || error);
    }
  }

  async getOrder(orderId: string): Promise<any> {
    try {
      const response = await this.http.get(`/partnerauth/v2/orders/${orderId}`, {
        headers: this.getAuthHeaders(),
      });
      return response.data;
    } catch (error) {
      this.logger.error('[ANOTA AI] Erro ao consultar pedido na API', error instanceof Error ? error.stack : String(error));
      throw error;
    }
  }

  async listOrders(filters?: { status?: string | number; page?: number; limit?: number }): Promise<any> {
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

  private async postOrderAction(orderId: string, action: string, body?: any): Promise<any> {
    const response = await this.http.post(
      `/partnerauth/v2/orders/${orderId}/${action}`,
      body || {},
      { headers: this.getAuthHeaders() },
    );
    return response.data;
  }

  private getAuthHeaders() {
    return {
      Authorization: this.configService.get<string>('ANOTA_AI_TOKEN') || '',
      'Content-Type': 'application/json',
    };
  }

  private shouldFetchFullOrder(payload: any) {
    const orderPayload = this.extractOrderPayload(payload);
    return !orderPayload?.customer || !orderPayload?.deliveryAddress || !orderPayload?.items;
  }

  private extractOrderPayload(payload: any) {
    if (!payload || typeof payload !== 'object') {
      return payload || {};
    }

    const candidates = [payload?.order, payload?.data, payload?.payload, payload?.resource];

    for (const candidate of candidates) {
      if (
        candidate &&
        typeof candidate === 'object' &&
        (candidate._id || candidate.id || candidate.status || candidate.customer)
      ) {
        return candidate;
      }
    }

    return payload;
  }

  private async findLinkedStore(storeId: string) {
    return this.userRepository.findOne({
      where: {
        anotaAiStoreId: storeId,
        isActive: true,
      } as any,
    });
  }

  private async hasDuplicateDelivery(orderId: string, payload: any): Promise<boolean> {
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
