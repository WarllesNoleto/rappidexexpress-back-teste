import { Injectable } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { InjectRepository } from '@nestjs/typeorm';
import { MongoRepository } from 'typeorm';
import { DeliveryEntity } from '../database/entities';
import { StatusDelivery } from '../shared/constants/enums.constants';
import { AiqfomeStoreTokenEntity } from './aiqfome-store-token.entity';

@Injectable()
export class AiqfomeOrderService {
  constructor(
    @InjectRepository(DeliveryEntity)
    private readonly deliveryRepository: MongoRepository<DeliveryEntity>,
    @InjectRepository(AiqfomeStoreTokenEntity)
    private readonly tokenRepository: MongoRepository<AiqfomeStoreTokenEntity>,
  ) {}

  async fetchUnreadOrders() { return []; }
  async fetchOpenOrders() { return []; }
  async fetchOrderById(orderId: string) { return { orderId }; }

  async mapStoreToShopkeeperId(storeId: string) {
    const store = await this.tokenRepository.findOneBy({ storeId, isActive: true });
    return store?.shopkeeperId ?? null;
  }

  async createOrGetDeliveryFromOrder(payload: any) {
    const orderId = String(payload?.order_id || payload?.orderId || '').trim();
    if (!orderId) return null;

    const existing = await this.deliveryRepository.findOneBy({
      externalOrderId: orderId,
      externalProvider: 'aiqfome',
    } as any);
    if (existing) return existing;

    const shopkeeperId = await this.mapStoreToShopkeeperId(String(payload?.store_id || payload?.storeId || ''));

    const delivery = this.deliveryRepository.create({
      id: uuid(),
      clientName: payload?.customer?.name || 'Cliente aiqfome',
      clientPhone: payload?.customer?.phone || '',
      status: StatusDelivery.PENDING,
      value: String(payload?.total || '0'),
      observation: payload?.observation || 'Pedido importado do aiqfome',
      soda: '',
      payment: payload?.payment || 'Dinheiro',
      isActive: true,
      origin: 'aiqfome',
      externalOrderId: orderId,
      externalStoreId: String(payload?.store_id || payload?.storeId || ''),
      externalProvider: 'aiqfome',
      createdBy: shopkeeperId || 'aiqfome',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    return this.deliveryRepository.save(delivery);
  }
}