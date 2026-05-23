import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { AiqfomeAuthService } from './aiqfome-auth.service';

@Injectable()
export class AiqfomeLogisticService {
  private readonly logger = new Logger(AiqfomeLogisticService.name);
  constructor(private readonly authService: AiqfomeAuthService, private readonly configService: ConfigService) {}

  async sendStatus(storeId: string, orderId: string, endpoint: string) {
    const accessToken = await this.authService.getValidAccessToken(storeId);
    const requestHeaders = this.buildV2Headers(accessToken, storeId);
    await axios.post(`${this.getAiqfomeApiBaseUrl()}/api/v2/logistic/${orderId}/${endpoint}`, {}, { headers: requestHeaders });
    this.logger.log(`[AiqfomeLogistic] status enviado ao aiqfome (${endpoint}) order=${orderId}`);
  }

  private getAiqfomeApiBaseUrl() {
    const configuredBaseUrl = String(this.configService.get<string>('AIQFOME_API_BASE_URL') || '').trim();
    return configuredBaseUrl || 'https://merchant-api.aiqfome.com';
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
