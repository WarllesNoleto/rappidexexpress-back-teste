import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MongoRepository } from 'typeorm';
import axios from 'axios';
import { addHours } from 'date-fns';
import { DeliveryEntity, UserEntity } from '../database/entities';
import { OrdersGateway } from '../gateway/orders.gateway';
import { StatusDelivery } from '../shared/constants/enums.constants';
import { DeliveryResult } from '../delivery/dto';
import { AiqfomeAuthService } from './aiqfome-auth.service';

@Injectable()
export class AiqfomeWebhookService {
  private readonly logger = new Logger(AiqfomeWebhookService.name);
  constructor(@InjectRepository(UserEntity) private readonly userRepository: MongoRepository<UserEntity>, @InjectRepository(DeliveryEntity) private readonly deliveryRepository: MongoRepository<DeliveryEntity>, private readonly ordersGateway: OrdersGateway, private readonly authService: AiqfomeAuthService) {}

  async processWebhook(headers: Record<string, string | string[] | undefined>, payload: any) {
    const expectedSecret = (process.env.AIQFOME_WEBHOOK_SECRET || '').trim();

    const authorization = headers?.authorization;
    const xAiqfomeSecret = headers?.['x-aiqfome-secret'];
    const xWebhookSecret = headers?.['x-webhook-secret'];

    const rawReceivedSecret =
      (Array.isArray(authorization) ? authorization[0] : authorization) ||
      (Array.isArray(xAiqfomeSecret) ? xAiqfomeSecret[0] : xAiqfomeSecret) ||
      (Array.isArray(xWebhookSecret) ? xWebhookSecret[0] : xWebhookSecret) ||
      '';

    const receivedSecret = String(rawReceivedSecret)
      .replace(/^Bearer\s+/i, '')
      .trim();

    const isAuthorized = expectedSecret.length > 0 && receivedSecret === expectedSecret;

    this.logger.warn(
      `[AiqfomeWebhook] auth check | hasExpected=${!!expectedSecret} | hasReceived=${!!receivedSecret} | expectedLength=${expectedSecret.length} | receivedLength=${receivedSecret.length} | authorized=${isAuthorized}`,
    );

    if (!isAuthorized) {
      throw new BadRequestException('Webhook não autorizado');
    }

    const storeId = String(payload?.storeId || payload?.store_id || payload?.merchant_id || '');
    const store = await this.userRepository.findOneBy({ id: storeId });
    if (!store) throw new BadRequestException('Webhook não autorizado');
    const event = String(payload?.event || payload?.type || '');
    this.logger.log(`[AiqfomeWebhook] evento recebido: ${event}`);
    if (event === 'ready-order') return this.handleReadyOrder(store, payload);
    if (event === 'cancel-order') return this.handleCancelOrder(payload?.order_id || payload?.orderId);
    return { ok: true };
  }


  async handleReadyOrder(store: UserEntity, payload: any) {
    this.logger.log('[AiqfomeWebhook] pedido pronto recebido');
    const orderId = String(payload?.order_id || payload?.orderId || '');
    const existing = await this.deliveryRepository.findOneBy({ source: 'aiqfome' as any, externalOrderId: orderId } as any);
    if (existing) { this.logger.log('[AiqfomeWebhook] entrega duplicada ignorada'); return existing; }
    const token = await this.authService.getValidAccessToken(store.id);
    const response = await axios.get(`https://merchant-api.aiqfome.com/api/v2/orders/${orderId}`, { headers: { Authorization: `Bearer ${token}` } });
    const order = response.data || {};
    const delivery = await this.deliveryRepository.save({ id: require('uuid').v4(), source: 'aiqfome', externalOrderId: orderId, aiqfomeStoreId: store.aiqfomeStoreId || store.id, clientName: order?.customer?.name || 'Cliente aiqfome', clientPhone: order?.customer?.phone || '', value: String(order?.total || '0'), observation: order?.observation || '', establishment: store, cityId: store.cityId, status: StatusDelivery.PENDING, payment: 'PAGO', soda: '0', isActive: true, createdAt: addHours(new Date(), -3), updatedAt: addHours(new Date(), -3) } as any);
    this.ordersGateway.emitDeliveryCreated(DeliveryResult.fromEntity(delivery as any), store.cityId);
    this.logger.log('[AiqfomeWebhook] entrega criada');
    return delivery;
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
