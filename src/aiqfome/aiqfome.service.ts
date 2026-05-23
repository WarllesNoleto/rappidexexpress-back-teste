import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiqfomeAuthService } from './aiqfome-auth.service';
import { AiqfomeWebhookService } from './aiqfome-webhook.service';
import axios from 'axios';

@Injectable()
export class AiqfomeService {
  constructor(private readonly authService: AiqfomeAuthService, private readonly webhookService: AiqfomeWebhookService, private readonly configService: ConfigService) {}
  oauthStart(storeId?: string) { return this.authService.buildOAuthUrl(storeId); }
  oauthCallback(code?: string, state?: string) { return this.authService.handleCallback(code, state); }
  handleWebhook(headers: Record<string, string | string[] | undefined>, payload: any) { return this.webhookService.processWebhook(headers, payload); }
  testFetchOrder(storeId: string, orderId: string) { return this.webhookService.testFetchOrder(storeId, orderId); }
  debugV2Routes(storeId: string, orderId: string) { return this.webhookService.debugV2Routes(storeId, orderId); }

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
