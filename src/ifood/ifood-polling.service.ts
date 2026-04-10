import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { IfoodAuthService } from './ifood-auth.service';

@Injectable()
export class IfoodPollingService {
  private readonly logger = new Logger(IfoodPollingService.name);

  constructor(
    private readonly ifoodAuthService: IfoodAuthService,
    private readonly configService: ConfigService,
  ) {}

  async pollEvents() {
    const accessToken = await this.ifoodAuthService.getAccessToken();
    const merchantIds = this.resolvePollingMerchants();

    if (!merchantIds) {
      throw new InternalServerErrorException(
        'Configure IFOOD_POLLING_MERCHANTS, IFOOD_TEST_MERCHANT_ID ou IFOOD_MERCHANT_ID no .env.',
      );
    }

    try {
      const response = await axios.get(
        'https://merchant-api.ifood.com.br/events/v1.0/events:polling',
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'x-polling-merchants': merchantIds,
          },
          params: {
            categories: 'ALL',
          },
        },
      );

      return response.data;
    } catch (error: any) {
      const status = error?.response?.status;
      const data = error?.response?.data;

      this.logger.error('Erro ao consultar eventos no polling do iFood', {
        status,
        data,
      });

      throw new InternalServerErrorException(
        'Não foi possível consultar os eventos do iFood.',
      );
    }
  }

 async acknowledgeEvents(eventIds: string[]) {
    if (!Array.isArray(eventIds) || eventIds.length === 0) {
      return;
    }

    const accessToken = await this.ifoodAuthService.getAccessToken();

    try {
      await axios.post(
        'https://merchant-api.ifood.com.br/events/v1.0/events/acknowledgment',
        eventIds.map((eventId) => ({ id: eventId })),
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        },
      );

      this.logger.log(
        `ACK enviado ao iFood com sucesso. Eventos: ${eventIds.length}`,
      );
    } catch (error: any) {
      const status = error?.response?.status;
      const data = error?.response?.data;

      this.logger.error('Erro ao enviar ACK para o iFood', {
        status,
        data,
        eventIds,
      });

      throw new InternalServerErrorException(
        'Não foi possível enviar ACK dos eventos ao iFood.',
      );
    }
  }

  private resolvePollingMerchants(): string {
    const rawPollingMerchants = this.configService.get<string>(
      'IFOOD_POLLING_MERCHANTS',
    );
    const rawTestMerchant = this.configService.get<string>(
      'IFOOD_TEST_MERCHANT_ID',
    );
    const rawMerchant = this.configService.get<string>('IFOOD_MERCHANT_ID');

    const merchants = [
      rawPollingMerchants,
      rawTestMerchant,
      rawMerchant,
    ]
      .filter(Boolean)
      .flatMap((item) => String(item).split(','))
      .map((item) => item.trim())
      .filter(Boolean);

    return Array.from(new Set(merchants)).join(',');
  }
}