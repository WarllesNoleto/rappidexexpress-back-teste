import {
  BadRequestException,
  InternalServerErrorException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { CreateDeliveryDto } from '../delivery/dto';
import { UserEntity } from '../database/entities';
import {
  PaymentType,
  StatusDelivery,
} from '../shared/constants/enums.constants';
import { IfoodAuthService } from './ifood-auth.service';

@Injectable()
export class IfoodOrdersService {
  private readonly logger = new Logger(IfoodOrdersService.name);

  constructor(
    private readonly ifoodAuthService: IfoodAuthService,
    private readonly configService: ConfigService,
  ) {}

  async getOrderDetails(orderId: string) {
    const accessToken = await this.ifoodAuthService.getAccessToken();

    try {
      const response = await axios.get(
        `https://merchant-api.ifood.com.br/order/v1.0/orders/${orderId}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );

      return response.data;
    } catch (error: any) {
      const status = error?.response?.status;
      const data = error?.response?.data;

      this.logger.error('Erro ao buscar detalhes do pedido no iFood', {
        status,
        data,
        orderId,
      });

      throw new InternalServerErrorException(
        'Não foi possível buscar os detalhes do pedido no iFood.',
      );
    }
  }

   async dispatchOrder(orderId: string) {
    const accessToken = await this.ifoodAuthService.getAccessToken();

    try {
      await axios.post(
        `https://merchant-api.ifood.com.br/order/v1.0/orders/${orderId}/dispatch`,
        {},
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        },
      );

      this.logger.log(`Dispatch do pedido enviado ao iFood com sucesso. OrderId: ${orderId}`);

      return {
        success: true,
        orderId,
        message: 'Dispatch do pedido enviado ao iFood com sucesso.',
      };
    } catch (error: any) {
      const status = error?.response?.status;
      const data = error?.response?.data;

      this.logger.error('Erro ao enviar dispatch do pedido ao iFood', {
        status,
        data,
        orderId,
      });

      throw new InternalServerErrorException(
        'Não foi possível enviar o dispatch do pedido ao iFood.',
      );
    }
  }

    async assignDriver(orderId: string, motoboy: Partial<UserEntity>) {
    const accessToken = await this.ifoodAuthService.getAccessToken();

    try {
      await axios.post(
        `https://merchant-api.ifood.com.br/logistics/v1.0/orders/${orderId}/assignDriver`,
        {
          workerName: motoboy?.name || 'Motoboy Rappidex',
          workerPhone: this.normalizePhone(motoboy?.phone || ''),
          workerVehicleType: 'MOTORCYCLE',
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        },
      );

      this.logger.log(`Entregador vinculado ao pedido no iFood. OrderId: ${orderId}`);

      return { success: true, orderId };
    } catch (error: any) {
      const status = error?.response?.status;
      const data = error?.response?.data;

      this.logger.error('Erro ao vincular entregador no iFood', {
        status,
        data,
        orderId,
        motoboyId: motoboy?.id,
      });

      throw new InternalServerErrorException(
        'Não foi possível vincular o entregador ao pedido no iFood.',
      );
    }
  }

  async notifyGoingToOrigin(orderId: string) {
    return this.postLogisticsWithoutBody(
      orderId,
      'goingToOrigin',
      'deslocamento para coleta',
    );
  }

  async notifyArrivedAtOrigin(orderId: string) {
    return this.postLogisticsWithoutBody(
      orderId,
      'arrivedAtOrigin',
      'chegada na origem',
    );
  }

  async dispatchLogisticsOrder(orderId: string) {
    return this.postLogisticsWithoutBody(
      orderId,
      'dispatch',
      'saída para entrega',
    );
  }

  async notifyArrivedAtDestination(orderId: string) {
    return this.postLogisticsWithoutBody(
      orderId,
      'arrivedAtDestination',
      'chegada no destino',
    );
  }

  async verifyDeliveryCode(orderId: string, code: string) {
  const accessToken = await this.ifoodAuthService.getAccessToken();
  const normalizedCode = String(code || '').trim();

  if (!normalizedCode) {
    throw new BadRequestException(
      'Informe o código de entrega do iFood.',
    );
  }

  try {
    const response = await axios.post(
      `https://merchant-api.ifood.com.br/logistics/v1.0/orders/${orderId}/verifyDeliveryCode`,
      {
        code: normalizedCode,
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      },
    );

    this.logger.log(`Código de entrega verificado no iFood. OrderId: ${orderId}`);

    return response.data;
  } catch (error: any) {
    const status = error?.response?.status;
    const data = error?.response?.data;
    const description = data?.description || data?.error?.message || '';

    this.logger.error('Erro ao validar código de entrega no iFood', {
      status,
      data,
      orderId,
    });

    if (
      status === 400 &&
      String(description).toLowerCase().includes('invalid')
    ) {
      throw new BadRequestException('Código de entrega do iFood inválido.');
    }

    throw new InternalServerErrorException(
      'Não foi possível validar o código de entrega no iFood.',
    );
  }
}

async getCancellationReasons(orderId: string) {
  const accessToken = await this.ifoodAuthService.getAccessToken();

  try {
    const response = await axios.get(
      `https://merchant-api.ifood.com.br/order/v1.0/orders/${orderId}/cancellationReasons`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        validateStatus: (status) => status === 200 || status === 204,
      },
    );

    if (response.status === 204) {
      this.logger.warn(
        `Pedido ${orderId} sem políticas de cancelamento ativas no iFood.`,
      );
      return [];
    }

    return Array.isArray(response.data) ? response.data : [];
  } catch (error: any) {
    const status = error?.response?.status;
    const data = error?.response?.data;

    this.logger.error('Erro ao consultar motivos de cancelamento no iFood', {
      status,
      data,
      orderId,
    });

    throw new InternalServerErrorException(
      'Não foi possível consultar os motivos de cancelamento no iFood.',
    );
  }
}

async requestCancellation(
  orderId: string,
  reason = 'Cancelado no Rappidex.',
) {
  const reasons = await this.getCancellationReasons(orderId);

  if (!Array.isArray(reasons) || reasons.length === 0) {
    return {
      success: false,
      accepted: false,
      orderId,
      message: 'Pedido sem políticas de cancelamento ativas no iFood.',
    };
  }

  const preferredCode = this.configService.get<string>(
    'IFOOD_DEFAULT_CANCELLATION_CODE',
  );

  const selectedReason = this.pickCancellationReason(reasons, preferredCode);

  if (!selectedReason) {
    return {
      success: false,
      accepted: false,
      orderId,
      message: 'Nenhum motivo de cancelamento válido foi encontrado.',
    };
  }

  const accessToken = await this.ifoodAuthService.getAccessToken();

  try {
    await axios.post(
      `https://merchant-api.ifood.com.br/order/v1.0/orders/${orderId}/requestCancellation`,
      {
        reason,
        cancellationCode: selectedReason.rawCode,
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      },
    );

    this.logger.warn(
      `Solicitação de cancelamento enviada ao iFood. OrderId: ${orderId}. Código: ${selectedReason.code}`,
    );

    return {
      success: true,
      accepted: true,
      orderId,
      cancellationCode: selectedReason.code,
      message: 'Solicitação de cancelamento enviada ao iFood.',
    };
  } catch (error: any) {
    const status = error?.response?.status;
    const data = error?.response?.data;
    const responseCode = data?.code || data?.error?.code || '';
    const responseMessage = data?.message || data?.error?.message || '';

    this.logger.error('Erro ao solicitar cancelamento do pedido no iFood', {
      status,
      data,
      orderId,
    });

    if (
      status === 400 &&
      (
        responseCode === 'OrderHasACancellationInProgress' ||
        responseCode === 'OrderExceededCancellationDeadline' ||
        String(responseMessage).toLowerCase().includes('already cancelled')
      )
    ) {
      return {
        success: false,
        accepted: false,
        orderId,
        message: responseMessage || responseCode || 'Cancelamento não aceito pelo iFood.',
      };
    }

    throw new InternalServerErrorException(
      'Não foi possível solicitar o cancelamento do pedido ao iFood.',
    );
  }
}

private pickCancellationReason(reasons: any[], preferredCode?: string) {
  const normalizedReasons = reasons
    .map((item) => {
      const rawCode = item?.code ?? item?.cancelCodeId ?? item?.id ?? null;

      if (!rawCode) {
        return null;
      }

      return {
        rawCode,
        code: String(rawCode),
        description: item?.description ?? item?.reason ?? '',
      };
    })
    .filter(Boolean) as Array<{
      rawCode: string | number;
      code: string;
      description: string;
    }>;

  if (normalizedReasons.length === 0) {
    return null;
  }

  const defaultCode = String(preferredCode || '').trim();

  if (defaultCode) {
    const foundPreferred = normalizedReasons.find(
      (item) => item.code === defaultCode,
    );

    if (foundPreferred) {
      return foundPreferred;
    }
  }

  const found504 = normalizedReasons.find((item) => item.code === '504');

  if (found504) {
    return found504;
  }

  return normalizedReasons[0];
}

  async analyzeOrder(orderId: string) {
    const order = await this.getOrderDetails(orderId);

    const orderType = order?.orderType ?? null;
    const deliveredBy = order?.delivery?.deliveredBy ?? null;
    const orderStatus =
      order?.orderStatus ??
      order?.status ??
      order?.metadata?.status ??
      null;

    const isDelivery = orderType === 'DELIVERY';
    const isMerchantDelivery = deliveredBy === 'MERCHANT';

    return {
      success: true,
      orderId,
      summary: {
        displayId: order?.displayId ?? null,
        orderType,
        deliveredBy,
        orderStatus,
        merchantId: order?.merchant?.id ?? null,
        merchantName: order?.merchant?.name ?? null,
        customerName: order?.customer?.name ?? null,
        customerPhone: order?.customer?.phone?.number ?? null,
      },
      canCreateRappidexDelivery: isDelivery && isMerchantDelivery,
      reason:
        isDelivery && isMerchantDelivery
          ? 'Pedido apto para virar entrega no Rappidex.'
          : 'Pedido não está apto para virar entrega no Rappidex.',
    };
  }

  async buildDeliveryPreview(orderId: string) {
    const deliveryData = await this.buildCreateDeliveryDto(orderId);

    return {
      success: true,
      orderId,
      deliveryPreview: {
        clientName: deliveryData.clientName,
        clientPhone: deliveryData.clientPhone,
        value: deliveryData.value,
        payment: deliveryData.payment,
        observation: deliveryData.observation,
        status: deliveryData.status,
        establishmentId: deliveryData.establishmentId,
        source: 'IFOOD',
      },
    };
  }

  async buildCreateDeliveryDto(orderId: string): Promise<CreateDeliveryDto> {
    const order = await this.getOrderDetails(orderId);
    const establishmentId = this.configService.get<string>(
      'IFOOD_TARGET_SHOPKEEPER_ID',
    );

    const customerName = order?.customer?.name ?? 'Cliente iFood';
    const customerPhone = this.normalizePhone(
      order?.customer?.phone?.number ?? '',
    );
        const displayId = order?.displayId ?? orderId;
    const localizer = order?.customer?.phone?.localizer ?? null;

    const totalValue =
      order?.total?.orderAmount ??
      order?.total?.subTotal ??
      order?.payments?.prepaid ??
      0;

    const deliveryAddress = [
      order?.delivery?.deliveryAddress?.streetName,
      order?.delivery?.deliveryAddress?.streetNumber,
      order?.delivery?.deliveryAddress?.neighborhood,
      order?.delivery?.deliveryAddress?.city,
    ]
      .filter(Boolean)
      .join(', ');

        const observation = [
      `Pedido iFood #${displayId}`,
      deliveryAddress ? `Endereço: ${deliveryAddress}` : null,
      localizer ? `Localizador: ${localizer}` : null,
      order?.delivery?.observations
        ? `Obs entrega: ${order.delivery.observations}`
        : null,
      order?.takeout?.pickupCode
        ? `Código retirada: ${order.takeout.pickupCode}`
        : null,
    ]
      .filter(Boolean)
      .join(' | ');

    return {
      clientName: customerName,
      clientPhone: customerPhone,
      status: StatusDelivery.PENDING,
      establishmentId,
      value: String(totalValue),
      payment: this.resolvePaymentType(order),
      soda: 'NÃO',
      observation,
    };
  }

    private async postLogisticsWithoutBody(
    orderId: string,
    endpoint: string,
    actionLabel: string,
  ) {
    const accessToken = await this.ifoodAuthService.getAccessToken();

    try {
      await axios.post(
        `https://merchant-api.ifood.com.br/logistics/v1.0/orders/${orderId}/${endpoint}`,
        {},
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        },
      );

      this.logger.log(
        `${actionLabel} enviada ao iFood com sucesso. OrderId: ${orderId}`,
      );

      return { success: true, orderId };
    } catch (error: any) {
      const status = error?.response?.status;
      const data = error?.response?.data;

      this.logger.error(`Erro ao enviar ${actionLabel} ao iFood`, {
        status,
        data,
        orderId,
      });

      throw new InternalServerErrorException(
        `Não foi possível enviar ${actionLabel} ao iFood.`,
      );
    }
  }

  private normalizePhone(phone: string): string {
    return String(phone || '').replace(/\D/g, '');
  }

  private resolvePaymentType(order: any): PaymentType {
    const raw = JSON.stringify(order?.payments ?? order ?? {}).toUpperCase();

    if (raw.includes('PIX')) {
      return PaymentType.PIX;
    }

    if (
      raw.includes('CREDIT') ||
      raw.includes('DEBIT') ||
      raw.includes('CARD') ||
      raw.includes('CARTAO') ||
      raw.includes('CARTÃO')
    ) {
      return PaymentType.CARTAO;
    }

    if (
      raw.includes('CASH') ||
      raw.includes('DINHEIRO') ||
      raw.includes('MONEY')
    ) {
      return PaymentType.DINHEIRO;
    }

    return PaymentType.PAGO;
  }
}