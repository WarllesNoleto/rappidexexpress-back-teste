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
    const storeId = this.extractStoreId(payload);
    const event = String(payload?.event || payload?.type || '').trim();
    const orderId = this.extractOrderId(payload);
    const source = this.identifySource(headers, payload);
    this.logger.log(`[AiqfomeWebhook] webhook recebido source=${source} event=${event || 'n/a'} storeId=${storeId || 'n/a'} orderId=${orderId || 'n/a'}`);

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
      this.logger.log(`[AiqfomeWebhook] pedido ignorado source=${source} motivo=evento_diferente event=${event || 'n/a'} orderId=${orderId || 'n/a'}`);
      return { ok: true };
    }

    const existing = await this.findExisting(orderId, storeId);
    if (existing) {
      this.logger.log(`[AiqfomeWebhook] pedido duplicado source=${source} storeId=${storeId || 'n/a'} orderId=${orderId || 'n/a'}`);
      return { ok: true, duplicated: true };
    }

    let order: any = null;
    let usedApi = false;
    let usedPayloadFallback = false;

    try {
      order = await this.aiqfomeService.fetchOrderByCompany(company, orderId);
      usedApi = true;
    } catch (error) {
      this.logger.warn(
        '[AiqfomeWebhook] falha ao buscar pedido na API, usando payload.data como fallback',
      );
      order = payload?.data;
      usedPayloadFallback = true;
    }

    if (!order) {
      this.logger.error(
        `[AiqfomeWebhook] erro interno ao processar pedido storeId=${storeId || 'n/a'} orderId=${orderId || 'n/a'} usouApi=${usedApi} usouPayloadFallback=${usedPayloadFallback}`,
      );
      return { ok: true };
    }

    const normalizedOrder = usedPayloadFallback
      ? this.normalizeAiqfomeOrderFromPayload(order, payload)
      : order;

    const delivery = await this.deliveryRepository.save(
      this.mapper.toDelivery(normalizedOrder, company, orderId, storeId, payload, usedPayloadFallback) as any,
    );
    this.gateway.emitDeliveryCreated(
      DeliveryResult.fromEntity(delivery as any),
      company.cityId,
    );

    this.logger.log(
      `[AiqfomeWebhook] event=${event || 'n/a'} storeId=${storeId || 'n/a'} orderId=${orderId || 'n/a'} empresaEncontrada=true usouApi=${usedApi} usouPayloadFallback=${usedPayloadFallback} entregaCriada=true`,
    );
    this.logger.log(`[AiqfomeWebhook] pedido criado source=${source} storeId=${storeId || 'n/a'} orderId=${orderId || 'n/a'} deliveryId=${delivery.id}`);
    return { ok: true, deliveryId: delivery.id };
  }


  private identifySource(headers: Record<string, any>, payload: any): string {
    const hasAiqfomeSecretHeader = Boolean(headers?.['x-aiqfome-secret'] || headers?.['x-webhook-secret']);
    const hasManualFlag = Boolean(headers?.['x-rappidex-manual'] || payload?.manualSync || payload?.simulated);
    if (hasManualFlag) return 'manual/simulado';
    if (hasAiqfomeSecretHeader) return 'aiqfome';
    return 'manual/sem-assinatura';
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

  private extractOrderId(payload: any): string {
    return String(
      payload?.order_id ||
        payload?.orderId ||
        payload?.data?.order_id ||
        payload?.data?.orderId ||
        payload?.data?.id ||
        '',
    ).trim();
  }

  private extractStoreId(payload: any): string {
    return String(
      payload?.store_id ||
        payload?.storeId ||
        payload?.store?.id ||
        payload?.data?.store_id ||
        payload?.data?.storeId ||
        '',
    ).trim();
  }

  private normalizeAiqfomeOrderFromPayload(data: any, payload: any) {
    const customer = data?.customer || data?.user || data?.client || {};
    const delivery = data?.delivery || {};
    const address = delivery?.address || data?.address || customer?.address || data?.shipping?.address || '';
    const payment = data?.payment || {};

    return {
      id: data?.id || this.extractOrderId(payload),
      customer: {
        name: customer?.name || data?.customer_name || data?.user_name || 'Cliente aiqfome',
        phone: customer?.phone || data?.phone || data?.customer_phone || '',
      },
      delivery: {
        address,
        neighborhood: delivery?.neighborhood || data?.address?.neighborhood || data?.neighborhood || '',
        reference:
          delivery?.reference ||
          data?.address?.reference ||
          data?.reference ||
          data?.complement ||
          '',
      },
      total: data?.total ?? data?.total_value ?? data?.amount ?? payment?.total ?? data?.summary?.total ?? 0,
      payment: {
        method: payment?.method || payment?.type || data?.payment_method || '',
        total: payment?.total ?? data?.total ?? 0,
      },
      observation: data?.observation || data?.notes || data?.customer_note || '',
      items: data?.items || data?.order_items || data?.products || [],
    };
  }

}
