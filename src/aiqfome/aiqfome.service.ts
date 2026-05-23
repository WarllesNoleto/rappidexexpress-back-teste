import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiqfomeAuthService } from './aiqfome-auth.service';
import { AiqfomeWebhookService } from './aiqfome-webhook.service';
import axios from 'axios';
import { InjectRepository } from '@nestjs/typeorm';
import { UserEntity } from '../database/entities';
import { MongoRepository } from 'typeorm';

@Injectable()
export class AiqfomeService {
  constructor(private readonly authService: AiqfomeAuthService, private readonly webhookService: AiqfomeWebhookService, private readonly configService: ConfigService, @InjectRepository(UserEntity) private readonly userRepository: MongoRepository<UserEntity>) {}
  oauthStart(storeId?: string) { return this.authService.buildOAuthUrl(storeId); }
  oauthCallback(code?: string, state?: string) { return this.authService.handleCallback(code, state); }
  handleWebhook(headers: Record<string, string | string[] | undefined>, payload: any) { return this.webhookService.processWebhook(headers, payload); }
  testFetchOrder(storeId: string, orderId: string) { return this.webhookService.testFetchOrder(storeId, orderId); }
  debugV2Routes(storeId: string, orderId: string) { return this.webhookService.debugV2Routes(storeId, orderId); }
  async getStatus(companyId: string) {
    const company = await this.userRepository.findOneBy({ id: companyId });
    return {
      companyId,
      enabled: Boolean(company?.aiqfomeEnabled),
      storeId: company?.aiqfomeStoreId || null,
      integrationStatus: company?.aiqfomeIntegrationStatus || 'not_configured',
      webhookUrl: company?.aiqfomeWebhookUrl || this.configService.get<string>('AIQFOME_WEBHOOK_URL') || null,
      hasAccessToken: Boolean(company?.aiqfomeAccessToken),
    };
  }
  async testConnection(companyId: string) { const c = await this.userRepository.findOneBy({ id: companyId }); if (!c?.aiqfomeStoreId) return { success: false, message: 'Store ID não configurado' }; return this.webhookService.testFetchOrder(c.aiqfomeStoreId, 'TESTE'); }
  async registerWebhook(companyId: string) { const c = await this.userRepository.findOneBy({ id: companyId }); if (!c?.aiqfomeStoreId) return { success: false, message: 'Store ID não configurado' }; const callbackUrl = String(this.configService.get<string>('AIQFOME_WEBHOOK_URL') || '').trim(); const events = ['new-order', 'read-order', 'ready-order', 'cancel-order', 'order-refund', 'order-logistic']; const result = await this.registerV2Webhooks(c.aiqfomeStoreId, callbackUrl, events); await this.userRepository.update({ id: companyId }, { aiqfomeWebhookUrl: callbackUrl, aiqfomeIntegrationStatus: 'connected' } as any); return result; }
  async updateConfig(companyId: string, body: any) { await this.userRepository.update({ id: companyId }, { aiqfomeEnabled: Boolean(body?.aiqfomeEnabled), aiqfomeStoreId: String(body?.aiqfomeStoreId || '').trim(), aiqfomeWebhookSecret: String(body?.aiqfomeWebhookSecret || '').trim(), aiqfomeWebhookUrl: String(body?.aiqfomeWebhookUrl || this.configService.get<string>('AIQFOME_WEBHOOK_URL') || '').trim(), aiqfomeIntegrationStatus: Boolean(body?.aiqfomeEnabled) ? 'connected' : 'not_configured' } as any); return this.getStatus(companyId); }
  async syncOrder(companyId: string, orderId: string) { const c = await this.userRepository.findOneBy({ id: companyId }); if (!c) return { success: false, message: 'Empresa não encontrada' }; return this.webhookService.handleReadyOrder(c, { event: 'ready-order', store_id: c.aiqfomeStoreId, data: { order_id: orderId } }); }

  async registerV2Webhooks(storeId: string, callbackUrl: string, events: string[]) {
    const token = await this.authService.getValidAccessToken(storeId);
    const url = `${this.getAiqfomeApiBaseUrl()}/api/v2/webhooks`;
    const body = { callback_url: callbackUrl, events };
    const response = await axios.post(url, body, {
      headers: this.buildV2Headers(token, storeId),
    });
    return response.data;
  }

  private getAiqfomeApiBaseUrl() {
    const configuredBaseUrl = String(this.configService.get<string>('AIQFOME_BASE_URL') || '').trim();
    return configuredBaseUrl || 'https://plataforma.aiqfome.com';
  }

  private buildV2Headers(token: string, storeId?: string) {
    const normalizedStoreId = String(storeId || '').trim();
    const storeHeaderName = String(this.configService.get<string>('AIQFOME_STORE_HEADER_NAME') || '').trim();
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };

    if (storeHeaderName && normalizedStoreId) headers[storeHeaderName] = normalizedStoreId;

    return headers;
  }
}
