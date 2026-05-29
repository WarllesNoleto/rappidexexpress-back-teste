import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MongoRepository } from 'typeorm';
import { IfoodOrderLinkEntity } from '../database/entities';

@Injectable()
export class IfoodOrderLinkService implements OnModuleInit {
  private readonly logger = new Logger(IfoodOrderLinkService.name);
  constructor(
    @InjectRepository(IfoodOrderLinkEntity)
    private readonly ifoodOrderLinkRepository: MongoRepository<IfoodOrderLinkEntity>,
  ) {}

  async onModuleInit() {
    await this.ensureIfoodOrderLinkIndexes();
  }

  private async ensureIfoodOrderLinkIndexes() {
    try {
      await this.ifoodOrderLinkRepository.createCollectionIndex(
        { ifoodOrderId: 1, merchantId: 1 },
        {
          name: 'IDX_IFOOD_ORDER_LINK_ORDER_MERCHANT_UNIQUE',
          unique: true,
        },
      );
    } catch (error: any) {
      this.logger.warn(
        `Não foi possível garantir índice único de vínculo iFood. ${error?.message || error}`,
      );
    }
  }

  async findByIfoodOrderId(ifoodOrderId: string, merchantId?: string | null) {
    if (merchantId) {
      return this.ifoodOrderLinkRepository.findOneBy({
        ifoodOrderId,
        merchantId,
      });
    }
    return this.ifoodOrderLinkRepository.findOneBy({ ifoodOrderId });
  }

  async findByDeliveryId(deliveryId: string) {
    return this.ifoodOrderLinkRepository.findOneBy({ deliveryId });
  }

  async findByDeliveryIds(deliveryIds: string[]) {
    if (!deliveryIds.length) {
      return [];
    }

    return this.ifoodOrderLinkRepository.find({
      where: {
        deliveryId: { $in: deliveryIds },
      } as any,
    });
  }

  async findByShopkeeperId(shopkeeperId: string) {
    return this.ifoodOrderLinkRepository.find({
      where: { shopkeeperId },
      order: { createdAt: 'DESC' as any },
    } as any);
  }

  async createLink(data: {
    ifoodOrderId: string;
    ifoodDisplayId: string;
    merchantId: string;
    merchantName?: string;
    deliveryId: string;
    shopkeeperId: string;
  }) {
    return this.ifoodOrderLinkRepository.save({
      ...data,
      createdAt: new Date(),
    });
  }
}
