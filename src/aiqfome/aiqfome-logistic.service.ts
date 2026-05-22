import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { AiqfomeAuthService } from './aiqfome-auth.service';

@Injectable()
export class AiqfomeLogisticService {
  private readonly logger = new Logger(AiqfomeLogisticService.name);
  constructor(private readonly authService: AiqfomeAuthService) {}

  async sendStatus(storeId: string, orderId: string, endpoint: string) {
    const accessToken = await this.authService.getValidAccessToken(storeId);
    await axios.post(`https://merchant-api.aiqfome.com/api/v2/logistic/${orderId}/${endpoint}`, {}, { headers: { Authorization: `Bearer ${accessToken}` } });
    this.logger.log(`[AiqfomeLogistic] status enviado ao aiqfome (${endpoint}) order=${orderId}`);
  }
}
