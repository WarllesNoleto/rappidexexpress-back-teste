import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { MongoRepository } from 'typeorm';
import axios from 'axios';
import { UserEntity } from '../database/entities';
import { AiqfomeAuthService } from './aiqfome-auth.service';

@Injectable()
export class AiqfomeService {
  private readonly logger = new Logger(AiqfomeService.name);
  constructor(
    private readonly authService: AiqfomeAuthService,
    private readonly config: ConfigService,
    @InjectRepository(UserEntity)
    private readonly userRepository: MongoRepository<UserEntity>,
  ) {}

  oauthStart(storeId?: string) {
    return this.authService.buildOAuthUrl(storeId);
  }
  oauthCallback(code?: string, state?: string) {
    return this.authService.handleCallback(code, state);
  }

  async fetchOrderByCompany(company: UserEntity, orderId: string) {
    try {
      const token = await this.authService.getValidAccessToken(company.id);
      const url = `${String(this.config.get('AIQFOME_API_BASE_URL') || 'https://purple-box.aiqfome.com').trim()}/api/v2/orders/${encodeURIComponent(orderId)}`;
      const res = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });
      return res.data;
    } catch (error) {
      this.logger.error('[AiqfomeWebhook] erro seguro ao buscar pedido V2');
      return null;
    }
  }

  async getStatus(companyId: string) {
    const c = await this.userRepository.findOneBy({ id: companyId });
    return {
      companyId,
      enabled: !!c?.aiqfomeEnabled,
      storeId: c?.aiqfomeStoreId || null,
      integrationStatus: c?.aiqfomeIntegrationStatus || 'not_configured',
      hasAccessToken: !!c?.aiqfomeAccessToken,
    };
  }
  async testConnection(companyId: string) {
    const c = await this.userRepository.findOneBy({ id: companyId });
    if (!c) return { success: false };
    const token = await this.authService
      .getValidAccessToken(companyId)
      .catch(() => '');
    return { success: !!token };
  }
  async registerWebhook(companyId: string) {
    const c = await this.userRepository.findOneBy({ id: companyId });
    if (!c) return { success: false };
    const webhookUrl = String(
      this.config.get('AIQFOME_WEBHOOK_URL') || '',
    ).trim();
    await this.userRepository.update({ id: companyId }, {
      aiqfomeWebhookUrl: webhookUrl,
      aiqfomeIntegrationStatus: 'connected',
    } as any);
    return { success: true, webhookUrl };
  }
  async updateConfig(companyId: string, body: any) {
    const current = await this.userRepository.findOneBy({ id: companyId });
    if (!current) return { success: false };
    await this.userRepository.update({ id: companyId }, {
      aiqfomeEnabled: Boolean(body?.aiqfomeEnabled),
      aiqfomeStoreId: String(
        body?.aiqfomeStoreId || current.aiqfomeStoreId || '',
      ).trim(),
      aiqfomeWebhookSecret: body?.aiqfomeWebhookSecret
        ? String(body.aiqfomeWebhookSecret).trim()
        : current.aiqfomeWebhookSecret,
      aiqfomeAccessToken: body?.aiqfomeAccessToken
        ? String(body.aiqfomeAccessToken).trim()
        : current.aiqfomeAccessToken,
      aiqfomeIntegrationStatus: Boolean(body?.aiqfomeEnabled)
        ? 'connected'
        : 'not_configured',
    } as any);
    return this.getStatus(companyId);
  }
  async syncOrder(companyId: string, orderId: string) {
    const c = await this.userRepository.findOneBy({ id: companyId });
    if (!c) return { success: false, message: 'Empresa não encontrada' };
    const order = await this.fetchOrderByCompany(c, orderId);
    return { success: !!order, order };
  }
}
