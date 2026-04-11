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

  async findRecentOrderIds(lookbackMinutes = 120, limit = 1000) {
    const cutoff = new Date(Date.now() - lookbackMinutes * 60 * 1000);

    const recentEvents = await this.ifoodEventRepository.find({
      where: {
        processedAt: { $gte: cutoff },
      } as any,
      order: { processedAt: 'DESC' },
      take: limit,
    });

    return [
      ...new Set(
        (Array.isArray(recentEvents) ? recentEvents : [])
          .map((event) => event?.orderId)
          .filter(Boolean),
      ),
    ];
  }

  async findLatestProcessedAtByOrderIds(orderIds: string[]) {
    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      return new Map<string, Date>();
    }

    const events = await this.ifoodEventRepository.find({
      where: {
        orderId: { $in: orderIds },
      } as any,
      order: { processedAt: 'DESC' },
      take: orderIds.length * 20,
    });

    const latestByOrder = new Map<string, Date>();

    for (const event of Array.isArray(events) ? events : []) {
      if (!event?.orderId || !event?.processedAt) {
        continue;
      }

      if (!latestByOrder.has(event.orderId)) {
        latestByOrder.set(event.orderId, new Date(event.processedAt));
      }
    }

    return latestByOrder;
  }

 async findRecentEligibleImportEvents(limit = 500) {
    const events = await this.ifoodEventRepository.find({
      where: {
        $or: [
          { code: 'RTP' },
          { fullCode: 'READY_TO_PICKUP' },
          { code: 'DSP' },
          { fullCode: 'DISPATCHED' },
        ],
      } as any,
      order: { processedAt: 'DESC' },
      take: limit,
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
    await this.ifoodEventRepository.updateOne(
      { eventId: event.id },
      {
        $setOnInsert: {
          eventId: event.id,
          orderId: event.orderId ?? '',
          merchantId: event.merchantId ?? '',
          code: event.code ?? '',
          fullCode: event.fullCode ?? '',
          salesChannel: event.salesChannel ?? '',
          createdAt: event.createdAt ?? '',
          processedAt: new Date(),
          acknowledged: false,
        },
      } as any,
      { upsert: true },
    );

    return this.findByEventId(event.id);
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