import { BadRequestException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MongoRepository } from 'typeorm';
import axios, { AxiosError } from 'axios';
import { addHours } from 'date-fns';
import { DeliveryEntity, UserEntity } from '../database/entities';
import { OrdersGateway } from '../gateway/orders.gateway';
import { StatusDelivery } from '../shared/constants/enums.constants';
import { DeliveryResult } from '../delivery/dto';
import { AiqfomeAuthService } from './aiqfome-auth.service';

@Injectable()
export class AiqfomeWebhookService {
  private readonly logger = new Logger(AiqfomeWebhookService.name);
  private readonly acceptedEvents = new Set([
    'new-order',
    'read-order',
    'ready-order',
    'cancel-order',
    'order-refund',
    'order-logistic',
  ]);
  constructor(@InjectRepository(UserEntity) private readonly userRepository: MongoRepository<UserEntity>, @InjectRepository(DeliveryEntity) private readonly deliveryRepository: MongoRepository<DeliveryEntity>, private readonly ordersGateway: OrdersGateway, private readonly authService: AiqfomeAuthService) {}

  async processWebhook(headers: Record<string, string | string[] | undefined>, payload: any) {
    const normalizeSecret = (value: string | string[] | undefined | null) => {
      const raw = Array.isArray(value) ? value[0] : value;
      return String(raw || '')
        .replace(/^Bearer\s+/i, '')
        .replace(/^['"`]+|['"`]+$/g, '')
        .trim();
    };

    const expectedSecret = normalizeSecret(process.env.AIQFOME_WEBHOOK_SECRET || '');

    const authorizationHeader = headers?.['authorization'];
    const xAiqfomeHeader = headers?.['x-aiqfome-secret'];
    const xWebhookHeader = headers?.['x-webhook-secret'];

    const receivedSecret = normalizeSecret(
      authorizationHeader ||
      xAiqfomeHeader ||
      xWebhookHeader ||
      headers?.['webhook-secret'] ||
      headers?.['x-api-key'] ||
      '',
    );

    const isAuthorized = expectedSecret.length > 0 && receivedSecret.length > 0 && receivedSecret === expectedSecret;

    const storeId = String(payload?.storeId || payload?.store_id || payload?.merchant_id || '').trim();
    const store = storeId
      ? (await this.userRepository.findOneBy({ id: storeId })) ||
        (await this.userRepository.findOneBy({ aiqfomeStoreId: storeId }))
      : null;
    const storeSecret = normalizeSecret(store?.aiqfomeWebhookSecret || '');

    const isStoreAuthorized = storeSecret.length > 0 && receivedSecret.length > 0 && receivedSecret === storeSecret;

    if (!isAuthorized && !isStoreAuthorized) throw new UnauthorizedException('Webhook não autorizado');

    if (!store) throw new UnauthorizedException('Webhook não autorizado');
    const event = String(payload?.event || payload?.type || '');
    const orderId = String(payload?.data?.order_id || payload?.order_id || payload?.orderId || '').trim();
    this.logger.log(`[AiqfomeWebhook] event=${event} store_id=${storeId || 'n/a'} order_id=${orderId || 'n/a'}`);

    if (!this.acceptedEvents.has(event)) {
      this.logger.warn(`[AiqfomeWebhook] evento não mapeado: ${event}`);
      return { ok: true };
    }

    if (event === 'new-order') return { ok: true, order_id: orderId };
    if (event === 'ready-order') return this.handleReadyOrder(store, payload);
    if (event === 'cancel-order') return this.handleCancelOrder(payload?.order_id || payload?.orderId);
    return { ok: true };
  }


  async handleReadyOrder(store: UserEntity, payload: any) {
    this.logger.log('[AiqfomeWebhook] pedido pronto recebido');
    const orderId = String(payload?.data?.order_id || payload?.order_id || payload?.orderId || '').trim();
    const webhookStoreId = String(payload?.storeId || payload?.store_id || payload?.merchant_id || store?.aiqfomeStoreId || store?.id || '').trim();

    this.logger.log(`[AiqfomeWebhook] validando busca V2 store_id=${webhookStoreId || 'n/a'} order_id=${orderId || 'n/a'} rappidex_store_id=${store?.id || 'n/a'}`);

    const existing = await this.deliveryRepository.findOneBy({ source: 'aiqfome' as any, externalOrderId: orderId } as any);
    if (existing) { this.logger.log('[AiqfomeWebhook] entrega duplicada ignorada'); return existing; }
    let order: any = {};
    try {
      order = await this.fetchOrderDetailsFromV2(store, orderId, webhookStoreId);
    } catch (error) {
      if (error instanceof NotFoundException) return { message: 'Webhook recebido, mas pedido não encontrado na aiqfome' };
      throw error;
    }
    const delivery = await this.deliveryRepository.save({ id: require('uuid').v4(), source: 'aiqfome', externalOrderId: orderId, aiqfomeStoreId: store.aiqfomeStoreId || store.id, clientName: order?.customer?.name || 'Cliente aiqfome', clientPhone: order?.customer?.phone || '', value: String(order?.total || '0'), observation: order?.observation || '', establishment: store, cityId: store.cityId, status: StatusDelivery.PENDING, payment: 'PAGO', soda: '0', isActive: true, createdAt: addHours(new Date(), -3), updatedAt: addHours(new Date(), -3) } as any);
    this.ordersGateway.emitDeliveryCreated(DeliveryResult.fromEntity(delivery as any), store.cityId);
    this.logger.log('[AiqfomeWebhook] entrega criada');
    return delivery;
  }

  async testFetchOrder(storeId: string, orderId: string) {
    const normalizedStoreId = String(storeId || '').trim();
    const normalizedOrderId = String(orderId || '').trim();

    const store =
      (await this.userRepository.findOneBy({ id: normalizedStoreId })) ||
      (await this.userRepository.findOneBy({ aiqfomeStoreId: normalizedStoreId }));

    if (!store) {
      return {
        found: false,
        statusCode: 404,
        error: 'Loja não encontrada para o storeId informado',
      };
    }

    try {
      const order = await this.fetchOrderDetailsFromV2(store, normalizedOrderId, normalizedStoreId);
      return {
        found: true,
        statusCode: 200,
        orderId: normalizedOrderId,
        storeId: normalizedStoreId,
        order,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        return {
          found: false,
          statusCode: 404,
          error: 'Webhook recebido, mas pedido não encontrado na aiqfome',
        };
      }

      const axiosError = error as AxiosError;
      return {
        found: false,
        statusCode: axiosError.response?.status || 500,
        error: axiosError.message,
      };
    }
  }

  private async fetchOrderDetailsFromV2(store: UserEntity, orderId: string, webhookStoreId?: string) {
    const token = await this.authService.getValidAccessToken(store.id);
    const baseUrl = 'https://merchant-api.aiqfome.com';
    const endpoint = `${baseUrl}/api/v2/orders/${encodeURIComponent(String(orderId))}`;
    const maskedToken = token ? `${token.slice(0, 6)}...${token.slice(-4)}` : 'n/a';

    this.logger.log(`[AiqfomeWebhook] buscando pedido V2 endpoint=${endpoint} store_id=${webhookStoreId || store.aiqfomeStoreId || store.id} rappidex_store_id=${store.id} token=${maskedToken}`);

    try {
      const response = await axios.get(endpoint, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return response.data || {};
    } catch (error) {
      const axiosError = error as AxiosError;
      const status = axiosError.response?.status;
      const responseData = axiosError.response?.data;

      this.logger.error('[AiqfomeWebhook] erro ao buscar pedido V2', JSON.stringify({ status, data: responseData, storeId: webhookStoreId || store.aiqfomeStoreId || store.id, orderId }));

      if (status === 404) {
        const responseDataAsText = typeof responseData === 'string' ? responseData : JSON.stringify(responseData || {});

        if (responseDataAsText.toLowerCase().includes('no route matched with those values')) {
          this.logger.error('[AiqfomeWebhook] rota aiqfome inválida ou endpoint montado errado');
        }

        this.logger.warn('[AiqfomeWebhook] pedido aiqfome não encontrado');
        throw new NotFoundException('Webhook recebido, mas pedido não encontrado na aiqfome');
      }

      throw error;
    }
  }

  async handleCancelOrder(orderId: string) {
    const delivery = await this.deliveryRepository.findOneBy({ source: 'aiqfome' as any, externalOrderId: String(orderId || '') } as any);
    if (!delivery) return { ok: true };
    delivery.status = StatusDelivery.CANCELED;
    delivery.isActive = false;
    delivery.updatedAt = addHours(new Date(), -3);
    const saved = await this.deliveryRepository.save(delivery);
    this.ordersGateway.emitDeliveryUpdated(DeliveryResult.fromEntity(saved as any), saved?.establishment?.cityId);
    return saved;
  }
}
