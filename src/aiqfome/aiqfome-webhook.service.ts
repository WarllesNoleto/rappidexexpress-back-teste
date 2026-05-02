import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MongoRepository } from 'typeorm';
import { v4 as uuid } from 'uuid';
import { AiqfomeEventEntity } from './aiqfome-event.entity';
import { AiqfomeOrderService } from './aiqfome-order.service';

@Injectable()
export class AiqfomeWebhookService {
  constructor(
    @InjectRepository(AiqfomeEventEntity)
    private readonly eventRepository: MongoRepository<AiqfomeEventEntity>,
    private readonly orderService: AiqfomeOrderService,
  ) {}

  async processWebhook(payload: any) {
    const eventId = String(payload?.event_id || payload?.id || '');
    const event = String(payload?.event || '');

    if (!eventId || !event) {
      return { accepted: false };
    }

    const existing = await this.eventRepository.findOneBy({ eventId });
    if (existing) return { accepted: true, duplicated: true };

    const dbEvent = await this.eventRepository.save({
      id: uuid(),
      eventId,
      event,
      orderId: String(payload?.order_id || ''),
      storeId: String(payload?.store_id || ''),
      rawPayload: payload,
      processed: false,
      createdAt: new Date(),
    } as any);

    if (['new-order', 'ready-order'].includes(event)) {
      await this.orderService.createOrGetDeliveryFromOrder(payload);
    }

    await this.eventRepository.updateOne({ id: dbEvent.id } as any, { $set: { processed: true, processedAt: new Date() } } as any);
    return { accepted: true };
  }
}