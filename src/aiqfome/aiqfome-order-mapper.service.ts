import { Injectable, Logger } from '@nestjs/common';
import { addHours } from 'date-fns';
import { randomUUID } from 'crypto';
import { DeliveryEntity, UserEntity } from '../database/entities';
import { StatusDelivery } from '../shared/constants/enums.constants';

@Injectable()
export class AiqfomeOrderMapperService {
  private readonly logger = new Logger(AiqfomeOrderMapperService.name);

  toDelivery(
    order: any,
    company: UserEntity,
    orderId: string,
    storeId: string,
    payload?: any,
    usedPayloadFallback = false,
  ): Partial<DeliveryEntity> {
    const customer = order?.customer || order?.client || order?.user || {};
    const delivery = order?.delivery || order?.shipping || {};
    const payment = order?.payment || {};
    const addressData = delivery?.address || order?.address || customer?.address || {};
    const address =
      typeof addressData === 'string'
        ? addressData
        : [
            addressData?.street || addressData?.address || addressData?.line1 || '',
            addressData?.number || '',
            addressData?.complement || '',
          ]
            .filter(Boolean)
            .join(', ') || 'Endereço não informado no webhook';
    const total = String(
      order?.total ??
        order?.total_value ??
        order?.amount ??
        payment?.total ??
        payment?.value ??
        '0',
    );
    if (!customer?.name)
      this.logger.warn('[AiqfomeWebhook] Campo ausente: customer.name');
    const paymentMethod =
      payment?.method ||
      payment?.type ||
      payment?.name ||
      order?.payment_method ||
      order?.paymentType ||
      '';
    const note =
      order?.observation ||
      order?.notes ||
      order?.customer_note ||
      order?.comment ||
      '';
    return {
      id: randomUUID(),
      clientName: customer?.name || 'Cliente aiqfome',
      clientPhone: customer?.phone || customer?.phone_number || customer?.cellphone || '',
      value: total,
      payment: 'PAGO' as any,
      observation: [note, paymentMethod]
        .filter(Boolean)
        .join(' | '),
      clientAddress: address,
      addressNeighborhood:
        delivery?.neighborhood ||
        addressData?.neighborhood ||
        order?.neighborhood ||
        '',
      addressReference:
        delivery?.reference ||
        addressData?.reference ||
        order?.reference ||
        order?.complement ||
        '',
      establishment: company,
      createdBy: company.id,
      status: StatusDelivery.PENDING,
      source: 'aiqfome',
      externalPlatform: 'aiqfome',
      externalOrderId: orderId,
      aiqfomeOrderId: orderId,
      aiqfomeStoreId: storeId,
      soda: '0',
      isActive: true,
      cityId: company.cityId as any,
      createdAt: addHours(new Date(), -3),
      updatedAt: addHours(new Date(), -3),
      rawAiqfomePayload: usedPayloadFallback ? (payload?.data || payload) : undefined,
    } as any;
  }
}
