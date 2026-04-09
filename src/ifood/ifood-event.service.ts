import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MongoRepository } from 'typeorm';
import { IfoodEventEntity } from '../database/entities';

@Injectable()
export class IfoodEventService {
  constructor(
    @InjectRepository(IfoodEventEntity)
    private readonly ifoodEventRepository: MongoRepository<IfoodEventEntity>,
  ) {}

  async findByEventId(eventId: string) {
    return this.ifoodEventRepository.findOneBy({ eventId });
  }

  async findByOrderId(orderId: string) {
    const events = await this.ifoodEventRepository.find({
      where: { orderId } as any,
    });

    return Array.isArray(events) ? events : [];
  }

  async markAsProcessed(event: {
    id: string;
    orderId?: string;
    merchantId?: string;
    code?: string;
    fullCode?: string;
    salesChannel?: string;
    createdAt?: string;
  }) {
    return this.ifoodEventRepository.save({
      eventId: event.id,
      orderId: event.orderId ?? '',
      merchantId: event.merchantId ?? '',
      code: event.code ?? '',
      fullCode: event.fullCode ?? '',
      salesChannel: event.salesChannel ?? '',
      createdAt: event.createdAt ?? '',
      processedAt: new Date(),
      acknowledged: false,
    });
  }

  async markAsAcknowledged(eventId: string) {
    await this.ifoodEventRepository.updateOne(
      { eventId },
      {
        $set: {
          acknowledged: true,
        },
      } as any,
    );
  }
}