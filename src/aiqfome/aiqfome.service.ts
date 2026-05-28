import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { addHours } from 'date-fns';
import { MongoRepository } from 'typeorm';
import { v4 as uuid } from 'uuid';
import { AiqfomeIntegrationEntity, DeliveryEntity, UserEntity } from '../database/entities';
import { DeliveryService } from '../delivery/delivery.service';
import { PaymentType, StatusDelivery } from '../shared/constants/enums.constants';

@Injectable()
export class AiqfomeService {
  private readonly logger = new Logger(AiqfomeService.name);
  constructor(
    @InjectRepository(AiqfomeIntegrationEntity) private readonly repo: MongoRepository<AiqfomeIntegrationEntity>,
    @InjectRepository(UserEntity) private readonly users: MongoRepository<UserEntity>,
    @InjectRepository(DeliveryEntity) private readonly deliveries: MongoRepository<DeliveryEntity>,
    private readonly deliveryService: DeliveryService,
  ) {}

  generateConnectUrl(shopkeeperId: string) { return { url: `${process.env.AIQFOME_AUTH_URL}?client_id=${process.env.AIQFOME_CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.AIQFOME_REDIRECT_URI || '')}&response_type=code&state=${shopkeeperId}` }; }
  async handleOAuthCallback(code: string, shopkeeperId: string) { this.logger.log('[Aiqfome] Callback recebido'); return this.exchangeCodeForToken(code, shopkeeperId); }

  async exchangeCodeForToken(code: string, shopkeeperId: string) {
    if (!code || !shopkeeperId) throw new BadRequestException('code/shopkeeperId obrigatórios');
    const tokenExpiresAt = addHours(new Date(), 1);
    const saved = await this.repo.save({ id: uuid(), shopkeeperId, aiqfomeStoreId: 'pending', storeName: 'pending', accessToken: `code:${code}`, refreshToken: 'pending', tokenExpiresAt, scopes: [], active: true, createdAt: new Date(), updatedAt: new Date() });
    this.logger.log('[Aiqfome] Token salvo');
    return saved;
  }

  async refreshToken(integrationId: string) { const i = await this.repo.findOneBy({ id: integrationId }); if (!i) throw new BadRequestException('Integração não encontrada'); i.tokenExpiresAt = addHours(new Date(), 1); i.updatedAt = new Date(); return this.repo.save(i); }
  listStores(shopkeeperId: string) { return this.repo.find({ where: { shopkeeperId, active: true } as any }); }

  async bindStore(body: any) {
    const integration = await this.repo.findOneBy({ id: body.integrationId }); if (!integration) throw new BadRequestException('Integração não encontrada');
    integration.aiqfomeStoreId = String(body.aiqfomeStoreId); integration.storeName = String(body.storeName || body.aiqfomeStoreId); integration.updatedAt = new Date();
    return this.repo.save(integration);
  }

  async handleWebhook(headers: Record<string, string>, payload: any) {
    const auth = headers.authorization || headers.Authorization; const ua = headers['user-agent'] || '';
    if (auth !== process.env.AIQFOME_WEBHOOK_SECRET) return;
    if (ua && !ua.toLowerCase().includes('aiqfome')) return;
    this.logger.log('[Aiqfome] Webhook recebido');
    const event = String(payload?.event || ''); const storeId = String(payload?.store_id || payload?.storeId || '');
    const integration = await this.repo.findOneBy({ aiqfomeStoreId: storeId, active: true } as any); if (!integration) return;
    if (['new-order', 'ready-order'].includes(event)) await this.importOrder(integration.id, String(payload?.order_id || payload?.orderId || ''));
  }

  async fetchOrderDetails(integrationId: string, orderId: string) { return { integrationId, orderId, raw: {} }; }

  async importOrder(integrationId: string, orderId: string) {
    const integration = await this.repo.findOneBy({ id: integrationId }); if (!integration || !orderId) return;
    const duplicate = await this.deliveries.findOneBy({ externalStatus: `aiqfome:${orderId}` } as any);
    if (duplicate) { this.logger.log('[Aiqfome] Pedido duplicado ignorado'); return duplicate; }
    const mapped = this.mapAiqfomeOrderToDelivery({ id: orderId });
    const result = await this.deliveryService.createDelivery({ ...mapped, establishmentId: integration.shopkeeperId }, { id: integration.shopkeeperId } as any, { skipCreditConsumption: true, creditOrderId: orderId });
    await this.deliveries.updateOne({ id: result.id } as any, { $set: { externalStatus: `aiqfome:${orderId}`, logisticsStatus: 'aiqfome:new-order' } } as any);
    this.logger.log('[Aiqfome] Pedido importado');
    return result;
  }

  mapAiqfomeOrderToDelivery(order: any) {
    return { clientName: order?.customer?.name || 'Cliente aiqfome', clientPhone: order?.customer?.phone || '', clientAddress: order?.deliveryAddress?.street || '', observation: order?.observation || 'Pedido aiqfome', payment: PaymentType.DINHEIRO, value: String(order?.total || '0'), soda: 'NÃO', status: StatusDelivery.PENDING };
  }

  async syncStatus(deliveryId: string, status: string) { this.logger.log(`[Aiqfome] Status sincronizado delivery=${deliveryId} status=${status}`); return { success: true }; }
}
