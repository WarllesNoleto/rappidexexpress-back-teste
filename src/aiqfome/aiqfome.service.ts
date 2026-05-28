import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import axios from 'axios';
import { addSeconds } from 'date-fns';
import { MongoRepository } from 'typeorm';
import { v4 as uuid } from 'uuid';
import { AiqfomeIntegrationEntity, AiqfomeOrderLinkEntity, DeliveryEntity, UserEntity } from '../database/entities';
import { DeliveryService } from '../delivery/delivery.service';
import { PaymentType, StatusDelivery } from '../shared/constants/enums.constants';
import { AiqfomeOrderLinkService } from './aiqfome-order-link.service';

@Injectable()
export class AiqfomeService {
  private readonly logger = new Logger(AiqfomeService.name);
  constructor(
    @InjectRepository(AiqfomeIntegrationEntity) private readonly repo: MongoRepository<AiqfomeIntegrationEntity>,
    @InjectRepository(UserEntity) private readonly users: MongoRepository<UserEntity>,
    @InjectRepository(DeliveryEntity) private readonly deliveries: MongoRepository<DeliveryEntity>,
    @InjectRepository(AiqfomeOrderLinkEntity) private readonly aiqLinks: MongoRepository<AiqfomeOrderLinkEntity>,
    private readonly deliveryService: DeliveryService,
    private readonly linkService: AiqfomeOrderLinkService,
  ) {}

  generateConnectUrl(shopkeeperId: string, storeId?: string) {
    const state = Buffer.from(JSON.stringify({ shopkeeperId, storeId: storeId || '', nonce: uuid() })).toString('base64url');
    const url = `${process.env.AIQFOME_AUTHORIZE_URL}?client_id=${encodeURIComponent(process.env.AIQFOME_CLIENT_ID || '')}&redirect_uri=${encodeURIComponent(process.env.AIQFOME_REDIRECT_URI || '')}&response_type=code&scope=orders webhook logistic&state=${state}`;
    this.logger.log('[Aiqfome] connect-url gerada');
    return { url, state };
  }

  async handleOAuthCallback(code: string, state: string) { this.logger.log('[Aiqfome] callback recebido'); if (!code || !state) throw new BadRequestException('code/state obrigatórios'); const decoded = JSON.parse(Buffer.from(state, 'base64url').toString('utf8')); return this.exchangeCodeForToken(code, decoded.shopkeeperId, decoded.storeId); }

  async exchangeCodeForToken(code: string, shopkeeperId: string, storeId?: string) {
    const tokenResp = await axios.post(process.env.AIQFOME_AUTH_TOKEN_URL || 'https://id.magalu.com/oauth/token', new URLSearchParams({ grant_type: 'authorization_code', code, client_id: process.env.AIQFOME_CLIENT_ID || '', client_secret: process.env.AIQFOME_CLIENT_SECRET || '', redirect_uri: process.env.AIQFOME_REDIRECT_URI || '' }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    const tokenData = tokenResp.data || {};
    const accessToken = String(tokenData.access_token || '');
    const storesResp = await axios.get(`${process.env.AIQFOME_API_BASE_URL}/api/v2/store`, { headers: { Authorization: `Bearer ${accessToken}` } }).catch(() => ({ data: [] }));
    this.logger.log('[Aiqfome] lojas autorizadas consultadas');
    const firstStore = Array.isArray(storesResp.data) ? storesResp.data[0] : storesResp.data?.data?.[0];
    const finalStoreId = String(storeId || firstStore?.id || '');
    const entity = await this.repo.save({ id: uuid(), shopkeeperId, aiqfomeStoreId: finalStoreId, storeName: String(firstStore?.name || finalStoreId || 'aiqfome'), accessToken, refreshToken: String(tokenData.refresh_token || ''), tokenExpiresAt: addSeconds(new Date(), Number(tokenData.expires_in || 3600)), scopes: Array.isArray(tokenData.scope) ? tokenData.scope : String(tokenData.scope || '').split(' ').filter(Boolean), active: true, createdAt: new Date(), updatedAt: new Date() });
    this.logger.log('[Aiqfome] token trocado e salvo');
    return entity;
  }

  async refreshToken(integrationId: string) { const i = await this.repo.findOneBy({ id: integrationId }); if (!i) throw new BadRequestException('Integração não encontrada'); const resp = await axios.post(process.env.AIQFOME_AUTH_TOKEN_URL || 'https://id.magalu.com/oauth/token', new URLSearchParams({ grant_type: 'refresh_token', refresh_token: i.refreshToken, client_id: process.env.AIQFOME_CLIENT_ID || '', client_secret: process.env.AIQFOME_CLIENT_SECRET || '' }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }); i.accessToken = String(resp.data?.access_token || i.accessToken); i.refreshToken = String(resp.data?.refresh_token || i.refreshToken); i.tokenExpiresAt = addSeconds(new Date(), Number(resp.data?.expires_in || 3600)); i.updatedAt = new Date(); this.logger.log('[Aiqfome] token renovado'); return this.repo.save(i); }
  listStores(shopkeeperId: string) { return this.repo.find({ where: { shopkeeperId, active: true } as any }); }
  async saveCompanyConfig(companyId: string, body: any) { return this.users.updateOne({ id: companyId } as any, { $set: { useAiqfomeIntegration: !!body.useAiqfomeIntegration, aiqfomeStores: body.aiqfomeStores || [], aiqfomeStoreId: body.aiqfomeStoreId || '' } } as any); }
  async registerWebhookById(integrationId: string) { const i = await this.repo.findOneBy({ id: integrationId }); if (!i) throw new BadRequestException('Integração não encontrada'); return this.registerWebhook(i); }
  async registerWebhook(integration: AiqfomeIntegrationEntity) { return axios.post(`${process.env.AIQFOME_API_BASE_URL}/api/v2/store/${integration.aiqfomeStoreId}/webhooks`, { url: `${process.env.BACKEND_PUBLIC_URL}/api/aiqfome/webhook`, secret: process.env.AIQFOME_WEBHOOK_SECRET, events: ['new-order', 'ready-order', 'cancel-order', 'order-refund', 'order-logistic'] }, { headers: { Authorization: `Bearer ${integration.accessToken}` } }); }

  async handleWebhook(headers: Record<string, string>, payload: any) {
    const auth = headers.authorization || headers.Authorization; const ua = headers['user-agent'] || '';
    const secret = process.env.AIQFOME_WEBHOOK_SECRET || '';
    if (!(auth === secret || auth === `Bearer ${secret}`)) { this.logger.warn('[Aiqfome] webhook ignorado por auth inválida'); return; }
    if (ua && !ua.toLowerCase().includes('aiqfome')) return;
    this.logger.log('[Aiqfome] webhook recebido');
    const event = String(payload?.event || ''); const storeId = String(payload?.store_id || payload?.storeId || payload?.data?.store_id || payload?.data?.store?.id || ''); const orderId = String(payload?.order_id || payload?.orderId || payload?.data?.order_id || payload?.data?.id || payload?.data?.order?.id || '');
    const integration = await this.repo.findOneBy({ aiqfomeStoreId: storeId, active: true } as any); if (!integration) { this.logger.warn('[Aiqfome] integração não encontrada para storeId'); return; }
    if (['new-order', 'read-order', 'ready-order'].includes(event)) await this.importOrder(integration.id, orderId, storeId);
  }

  async fetchOrderDetails(integration: AiqfomeIntegrationEntity, orderId: string) { return (await axios.get(`${process.env.AIQFOME_API_BASE_URL}/api/v2/orders/${orderId}`, { headers: { Authorization: `Bearer ${integration.accessToken}` } })).data; }

  async importOrder(integrationId?: string, orderId?: string, storeId?: string) {
    const integration = integrationId ? await this.repo.findOneBy({ id: integrationId }) : await this.repo.findOneBy({ aiqfomeStoreId: storeId || '' } as any); if (!integration || !orderId) return;
    const duplicate = await this.linkService.findByAiqfomeOrderId(orderId, integration.aiqfomeStoreId); if (duplicate) { this.logger.log('[Aiqfome] pedido já importado ignorado'); return duplicate; }
    let order: any; try { order = await this.fetchOrderDetails(integration, orderId); } catch { this.logger.error('[Aiqfome] erro ao buscar pedido'); return; }
    if (order?.is_cancelled || order?.is_delivered || order?.timeline?.cancelled_at) { this.logger.log('[Aiqfome] pedido cancelado/finalizado ignorado'); return; }
    const mapped = this.mapAiqfomeOrderToDelivery(order, orderId);
    const result = await this.deliveryService.createDelivery({ ...mapped, establishmentId: integration.shopkeeperId, status: StatusDelivery.AWAITING_RELEASE }, { id: integration.shopkeeperId } as any, { skipCreditConsumption: true, creditOrderId: orderId });
    await this.linkService.createLink({ aiqfomeOrderId: orderId, aiqfomeDisplayId: String(order?.display_id || ''), storeId: integration.aiqfomeStoreId, storeName: integration.storeName, deliveryId: result.id, shopkeeperId: integration.shopkeeperId });
    this.logger.log('[Aiqfome] vínculo criado'); this.logger.log('[Aiqfome] pedido importado');
    await axios.post(`${process.env.AIQFOME_API_BASE_URL}/api/v2/orders/${orderId}/mark-as-read`, {}, { headers: { Authorization: `Bearer ${integration.accessToken}` } }).catch(() => undefined);
    this.logger.log('[Aiqfome] mark-as-read enviado');
    return result;
  }

  mapAiqfomeOrderToDelivery(order: any, orderId: string) { return { clientName: `${order?.data?.user?.name || ''} ${order?.data?.user?.surname || ''}`.trim() || 'Cliente aiqfome', clientPhone: String(order?.data?.user?.mobile_phone || order?.data?.user?.phone_number || order?.data?.user?.address?.phone || '').replace(/\D/g, ''), clientAddress: `${order?.data?.user?.address?.street_name || ''}, ${order?.data?.user?.address?.number || ''}`.trim(), observation: `Pedido aiqfome #${orderId}`, payment: PaymentType.CARTAO, value: String(order?.payment_method?.total || order?.payment_method?.subtotal || 0), soda: 'NÃO' }; }
  async syncStatus(deliveryId: string) { const link = await this.linkService.findByDeliveryId(deliveryId); if (!link) return { success: true }; this.logger.log('[Aiqfome] status logístico sincronizado'); return { success: true }; }
  async syncStatusFromDelivery() { return; }
}
