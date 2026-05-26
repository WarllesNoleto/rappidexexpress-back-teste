import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MongoRepository } from 'typeorm';
import { addHours } from 'date-fns';
import { DeliveryEntity, UserEntity } from '../database/entities';
import { OrdersGateway } from '../gateway/orders.gateway';
import { DeliveryResult } from '../delivery/dto';
import { StatusDelivery } from '../shared/constants/enums.constants';
import { AiqfomeService } from './aiqfome.service';
import { AiqfomeOrderMapperService } from './aiqfome-order-mapper.service';

@Injectable()
export class AiqfomeWebhookService {
  private readonly logger = new Logger(AiqfomeWebhookService.name);
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: MongoRepository<UserEntity>,
    @InjectRepository(DeliveryEntity)
    private readonly deliveryRepository: MongoRepository<DeliveryEntity>,
    private readonly gateway: OrdersGateway,
    private readonly aiqfomeService: AiqfomeService,
    private readonly mapper: AiqfomeOrderMapperService,
  ) {}

  async processWebhook(headers: Record<string, any>, payload: any) {
    const storeId = String(payload?.store_id || payload?.storeId || payload?.store?.id || payload?.data?.store_id || payload?.data?.storeId || '').trim();
    const event = String(payload?.event || payload?.type || '').trim();
    const orderId = String(
      payload?.data?.order_id ||
        payload?.data?.orderId ||
        payload?.data?.id ||
        payload?.order_id ||
        payload?.orderId ||
        '',
    ).trim();
    this.logger.log(`[AiqfomeWebhook] Evento recebido: ${event}`);
    this.logger.log(`[AiqfomeWebhook] Store recebida: ${storeId || 'n/a'}`);

    const company = storeId
      ? await this.userRepository.findOneBy({ aiqfomeStoreId: storeId })
      : null;
    this.logger.log(`[AiqfomeWebhook] Empresa encontrada: ${Boolean(company)}`);

    const normalize = (v: any, isAuthHeader = false) => {
      const normalized = String(Array.isArray(v) ? v[0] : v || '').trim();
      return isAuthHeader ? normalized.replace(/^Bearer\s+/i, '').trim() : normalized;
    };
    const expectedSecret = normalize(process.env.AIQFOME_WEBHOOK_SECRET || '');
    const candidates = [
      normalize(headers?.authorization, true),
      normalize(headers?.Authorization, true),
      normalize(headers?.['x-aiqfome-secret']),
      normalize(headers?.['x-webhook-secret']),
    ].filter(Boolean);

    if (expectedSecret && !candidates.some((value) => value === expectedSecret)) {
      throw new UnauthorizedException('Webhook não autorizado');
    }

    if (!company) {
      this.logger.warn(
        `[AiqfomeWebhook] Nenhuma empresa encontrada para store_id=${storeId}`,
      );
      return { ok: true };
    }
    if (!company.aiqfomeEnabled) return { ok: true };

    if (event === 'cancel-order' || event === 'order-refund')
      return this.cancelOrder(orderId, company, event);
    if (event === 'order-logistic')
      return this.updateLogistic(orderId, company, payload);
    if (!['new-order', 'read-order', 'ready-order'].includes(event))
      return { ok: true };
    if (!company.aiqfomeAccessToken) {
      this.logger.error('[AiqfomeWebhook] Token ausente para store_id');
      return { ok: true };
    }

    if (event !== 'ready-order') {
      return { ok: true };
    }

    const existing = await this.findExisting(orderId, storeId);
    if (existing) {
      this.logger.log('[AiqfomeWebhook] Pedido duplicado ignorado');
      return { ok: true, duplicated: true };
    }

    const order = await this.aiqfomeService.fetchOrderByCompany(
      company,
      orderId,
    );
    if (!order) {
      this.logger.error(
        `[AiqfomeWebhook] erro interno ao processar pedido storeId=${storeId || 'n/a'} orderId=${orderId || 'n/a'}`
      );
      return { ok: true };
    }
    const delivery = await this.deliveryRepository.save(
      this.mapper.toDelivery(order, company, orderId, storeId) as any,
    );
    this.gateway.emitDeliveryCreated(
      DeliveryResult.fromEntity(delivery as any),
      company.cityId,
    );
    this.logger.log(`[AiqfomeWebhook] Pedido criado: ${orderId}`);
    return { ok: true, deliveryId: delivery.id };
  }

  private findExisting(orderId: string, storeId: string) {
    return this.deliveryRepository.findOneBy({
      $or: [
        { aiqfomeOrderId: orderId, aiqfomeStoreId: storeId } as any,
        { externalOrderId: orderId, externalPlatform: 'aiqfome' } as any,
      ] as any,
    } as any);
  }
  private async cancelOrder(
    orderId: string,
    company: UserEntity,
    event: string,
  ) {
    const delivery = await this.findExisting(
      orderId,
      company.aiqfomeStoreId || '',
    );
    if (!delivery) return { ok: true };
    delivery.status = StatusDelivery.CANCELED;
    delivery.isActive = false;
    delivery.updatedAt = addHours(new Date(), -3);
    const saved = await this.deliveryRepository.save(delivery);
    this.gateway.emitDeliveryUpdated(
      DeliveryResult.fromEntity(saved as any),
      company.cityId,
    );
    this.logger.log(`[AiqfomeWebhook] Pedido cancelado (${event})`);
    return { ok: true };
  }
  private async updateLogistic(
    orderId: string,
    company: UserEntity,
    payload: any,
  ) {
    const delivery = await this.findExisting(
      orderId,
      company.aiqfomeStoreId || '',
    );
    if (!delivery) return { ok: true };
    delivery.logisticsStatus =
      String(payload?.data?.status || payload?.status || '').trim() ||
      delivery.logisticsStatus;
    delivery.updatedAt = addHours(new Date(), -3);
    const saved = await this.deliveryRepository.save(delivery);
    this.gateway.emitDeliveryUpdated(
      DeliveryResult.fromEntity(saved as any),
      company.cityId,
    );
    return { ok: true };
  }
}
