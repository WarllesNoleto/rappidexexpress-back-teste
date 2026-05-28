import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MongoRepository } from 'typeorm';
import { AiqfomeOrderLinkEntity } from '../database/entities';

@Injectable()
export class AiqfomeOrderLinkService {
  constructor(@InjectRepository(AiqfomeOrderLinkEntity) private readonly repo: MongoRepository<AiqfomeOrderLinkEntity>) {}

  findByAiqfomeOrderId(orderId: string, storeId?: string) {
    return this.repo.findOneBy(storeId ? ({ aiqfomeOrderId: orderId, storeId } as any) : ({ aiqfomeOrderId: orderId } as any));
  }

  findByDeliveryId(deliveryId: string) { return this.repo.findOneBy({ deliveryId } as any); }

  createLink(data: Partial<AiqfomeOrderLinkEntity>) { return this.repo.save({ ...data, createdAt: new Date() } as any); }

  async updateSyncFlags(deliveryId: string, flags: Partial<AiqfomeOrderLinkEntity>) {
    await this.repo.updateOne({ deliveryId } as any, { $set: flags } as any);
    return this.findByDeliveryId(deliveryId);
  }
}
