import { Injectable } from '@nestjs/common';
import { AiqfomeAuthService } from './aiqfome-auth.service';
import { AiqfomeWebhookService } from './aiqfome-webhook.service';

@Injectable()
export class AiqfomeService {
  constructor(private readonly authService: AiqfomeAuthService, private readonly webhookService: AiqfomeWebhookService) {}
  oauthStart(storeId?: string) { return this.authService.buildOAuthUrl(storeId); }
  oauthCallback(code: string, state: string) { return this.authService.handleCallback(code, state); }
  handleWebhook(authHeader: string | undefined, payload: any) { return this.webhookService.processWebhook(authHeader, payload); }
}
