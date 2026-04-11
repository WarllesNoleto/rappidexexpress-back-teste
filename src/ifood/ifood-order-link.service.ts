import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MongoRepository } from 'typeorm';
import { IfoodOrderLinkEntity } from '../database/entities';

@Injectable()
export class IfoodOrderLinkService {
  constructor(
    @InjectRepository(IfoodOrderLinkEntity)
    private readonly ifoodOrderLinkRepository: MongoRepository<IfoodOrderLinkEntity>,
  ) {}

  async findByIfoodOrderId(ifoodOrderId: string) {
    return this.ifoodOrderLinkRepository.findOneBy({ ifoodOrderId });
  }

  async findByDeliveryId(deliveryId: string) {
    return this.ifoodOrderLinkRepository.findOneBy({ deliveryId });
  }

  async createLink(data: {
    ifoodOrderId: string;
    ifoodDisplayId: string;
    merchantId: string;
    deliveryId: string;
    shopkeeperId: string;
  }) {
    return this.ifoodOrderLinkRepository.save({
      ...data,
      createdAt: new Date(),
    });
  }

  async findByIfoodOrderIds(ifoodOrderIds: string[]) {
    if (!Array.isArray(ifoodOrderIds) || ifoodOrderIds.length === 0) {
      return [];
    }

    const links = await this.ifoodOrderLinkRepository.find({
      where: {
        ifoodOrderId: {
          $in: ifoodOrderIds,
        },
      } as any,
    });

    return Array.isArray(links) ? links : [];
  }

  async findByDeliveryIds(deliveryIds: string[]) {
    if (!Array.isArray(deliveryIds) || deliveryIds.length === 0) {
      return [];
    }

    const links = await this.ifoodOrderLinkRepository.find({
      where: {
        deliveryId: {
          $in: deliveryIds,
        },
      } as any,
    });

    return Array.isArray(links) ? links : [];
  }
}