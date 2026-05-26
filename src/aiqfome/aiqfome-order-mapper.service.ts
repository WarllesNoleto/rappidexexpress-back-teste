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
  ): Partial<DeliveryEntity> {
    const total = String(order?.total ?? order?.payment?.total ?? '0');
    if (!order?.customer?.name)
      this.logger.warn('[AiqfomeWebhook] Campo ausente: customer.name');
    return {
      id: randomUUID(),
      clientName: order?.customer?.name || 'Cliente aiqfome',
      clientPhone: order?.customer?.phone || '',
      value: total,
      payment: 'PAGO' as any,
      observation: order?.observation || order?.notes || '',
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
    } as any;
  }
}
