import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Injectable, Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { DeliveryResult } from '../delivery/dto';

@Injectable()
@WebSocketGateway({
  cors: {
    origin: true,
    credentials: true,
  },
  transports: ['websocket', 'polling'],
})
export class OrdersGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(OrdersGateway.name);

  @WebSocketServer()
  server: Server;

  handleConnection(@ConnectedSocket() client: Socket) {
    if (process.env.NODE_ENV !== 'production') {
      this.logger.log(`Socket conectado: ${client.id}`);
    }
  }

  handleDisconnect(@ConnectedSocket() client: Socket) {
    if (process.env.NODE_ENV !== 'production') {
      this.logger.log(`Socket desconectado: ${client.id}`);
    }
  }

  @SubscribeMessage('join-city')
  handleJoinCity(
    @ConnectedSocket() client: Socket,
    @MessageBody() cityId: string,
  ) {
    if (!cityId) return;
    client.join(`city:${cityId}`);
    this.logger.log(`socket_join_city socketId=${client.id} room=city:${cityId}`);
  }

  emitDeliveryCreated(delivery: DeliveryResult, cityId?: string) {
    this.logger.log(
      `ws_emit event=delivery:created deliveryId=${delivery?.id} status=${delivery?.status} room=${cityId ? `city:${cityId}` : 'broadcast'}`,
    );
    if (cityId) {
      this.server.to(`city:${cityId}`).emit('delivery:created', delivery);
      return;
    }

    this.server.emit('delivery:created', delivery);
  }

  emitDeliveryUpdated(delivery: DeliveryResult, cityId?: string) {
    this.logger.log(
      `ws_emit event=delivery:updated deliveryId=${delivery?.id} status=${delivery?.status} room=${cityId ? `city:${cityId}` : 'broadcast'}`,
    );
    if (cityId) {
      this.server.to(`city:${cityId}`).emit('delivery:updated', delivery);
      return;
    }

    this.server.emit('delivery:updated', delivery);
  }

  emitDeliveryDeleted(deliveryId: string, cityId?: string) {
    const payload = { id: deliveryId };
    this.logger.log(
      `ws_emit event=delivery:deleted deliveryId=${deliveryId} room=${cityId ? `city:${cityId}` : 'broadcast'}`,
    );

    if (cityId) {
      this.server.to(`city:${cityId}`).emit('delivery:deleted', payload);
      return;
    }

    this.server.emit('delivery:deleted', payload);
  }
}
