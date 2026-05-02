import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class AiqfomeLogisticService {
  private readonly logger = new Logger(AiqfomeLogisticService.name);
  private readonly sequence = ['pickup-ongoing','arrived-at-merchant','delivery-ongoing','arrived-at-customer','order-delivered'];
  private readonly orderLastStatus = new Map<string, string>();

  private canSend(orderId: string, next: string) {
    const current = this.orderLastStatus.get(orderId);
    const nextIndex = this.sequence.indexOf(next);
    const currentIndex = current ? this.sequence.indexOf(current) : -1;
    return nextIndex === currentIndex + 1;
  }

  private async send(orderId: string, status: string) {
    if (!this.canSend(orderId, status)) {
      this.logger.warn(`Sequência inválida aiqfome para ${orderId}: ${status}`);
      return;
    }
    this.orderLastStatus.set(orderId, status);
  }

  pickupOngoing(orderId: string) { return this.send(orderId, 'pickup-ongoing'); }
  arrivedAtMerchant(orderId: string) { return this.send(orderId, 'arrived-at-merchant'); }
  deliveryOngoing(orderId: string) { return this.send(orderId, 'delivery-ongoing'); }
  arrivedAtCustomer(orderId: string) { return this.send(orderId, 'arrived-at-customer'); }
  orderDelivered(orderId: string) { return this.send(orderId, 'order-delivered'); }
}