import { Injectable } from '@nestjs/common';
import { AiqfomeAuthService } from './aiqfome-auth.service';
import { AiqfomeWebhookService } from './aiqfome-webhook.service';
import axios from 'axios';

@Injectable()
export class AiqfomeService {
  constructor(private readonly authService: AiqfomeAuthService, private readonly webhookService: AiqfomeWebhookService) {}
  oauthStart(storeId?: string) { return this.authService.buildOAuthUrl(storeId); }
  oauthCallback(code?: string, state?: string) { return this.authService.handleCallback(code, state); }
  handleWebhook(headers: Record<string, string | string[] | undefined>, payload: any) { return this.webhookService.processWebhook(headers, payload); }

  async registerV2Webhooks(storeId: string, callbackUrl: string, events: string[]) {
    const token = await this.authService.getValidAccessToken(storeId);
    const url = 'https://merchant-api.aiqfome.com/api/v2/webhooks';
    const body = { callback_url: callbackUrl, events };
    const response = await axios.post(url, body, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.data;
  }
}
