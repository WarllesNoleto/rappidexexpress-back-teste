import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';

export interface SendDocumentMessageInput {
  phone: string;
  message: string;
  pdfBuffer: Buffer;
  filename: string;
  token?: string;
  phoneNumberId?: string;
  useCityConfigOnly?: boolean;
}

type MetaErrorStage = 'upload' | 'send';

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(private readonly configService: ConfigService) {}

  resolveDocumentMessageConfig(options?: {
    token?: string;
    phoneNumberId?: string;
    useCityConfigOnly?: boolean;
  }) {
    const cityToken = String(options?.token ?? '').trim();
    const cityPhoneNumberId = String(options?.phoneNumberId ?? '').trim();
    const globalToken =
      this.configService.get<string>('WHATSAPP_CLOUD_TOKEN') || '';
    const globalPhoneNumberId =
      this.configService.get<string>('WHATSAPP_PHONE_NUMBER_ID') || '';
    const token = options?.useCityConfigOnly
      ? cityToken
      : cityToken && cityPhoneNumberId
        ? cityToken
        : globalToken;
    const phoneNumberId = options?.useCityConfigOnly
      ? cityPhoneNumberId
      : cityToken && cityPhoneNumberId
        ? cityPhoneNumberId
        : globalPhoneNumberId;
    const apiVersion =
      this.configService.get<string>('WHATSAPP_CLOUD_API_VERSION') || 'v20.0';

    if (!token || !phoneNumberId) {
      throw new BadRequestException(
        'WhatsApp da cidade não configurado. Configure token e Phone Number ID na tela de Cidades.',
      );
    }

    return {
      token,
      phoneNumberId,
      apiVersion,
    };
  }

  async sendDocumentMessage({
    phone,
    message,
    pdfBuffer,
    filename,
    token,
    phoneNumberId,
    useCityConfigOnly,
  }: SendDocumentMessageInput) {
    const config = this.resolveDocumentMessageConfig({
      token,
      phoneNumberId,
      useCityConfigOnly,
    });

    if (!pdfBuffer?.length) {
      throw new BadRequestException('PDF do fechamento não foi gerado.');
    }

    const mediaId = await this.uploadPdfMedia({
      token: config.token,
      phoneNumberId: config.phoneNumberId,
      apiVersion: config.apiVersion,
      pdfBuffer,
      filename,
    });

    try {
      const response = await axios.post(
        `https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`,
        {
          messaging_product: 'whatsapp',
          to: phone,
          type: 'document',
          document: {
            id: mediaId,
            filename,
            caption: message,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${config.token}`,
            'Content-Type': 'application/json',
          },
        },
      );

      return response.data;
    } catch (error) {
      throw this.buildMetaException(error, 'send');
    }
  }

  private async uploadPdfMedia({
    token,
    phoneNumberId,
    apiVersion,
    pdfBuffer,
    filename,
  }: {
    token: string;
    phoneNumberId: string;
    apiVersion: string;
    pdfBuffer: Buffer;
    filename: string;
  }) {
    const boundary = `----rappidex-${Date.now().toString(16)}`;
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="messaging_product"\r\n\r\nwhatsapp\r\n`,
      ),
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="type"\r\n\r\napplication/pdf\r\n`,
      ),
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/pdf\r\n\r\n`,
      ),
      pdfBuffer,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    try {
      const response = await axios.post(
        `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/media`,
        body,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': body.length,
          },
          maxBodyLength: Infinity,
        },
      );

      return response.data.id as string;
    } catch (error) {
      throw this.buildMetaException(error, 'upload');
    }
  }

  private buildMetaException(error: unknown, stage: MetaErrorStage) {
    const axiosError = error as AxiosError<any>;
    const metaResponse = axiosError.response?.data;
    const metaError = metaResponse?.error;
    const metaMessage = String(
      metaError?.message || metaResponse?.message || axiosError.message || '',
    );
    const friendlyMessage = this.resolveFriendlyMetaMessage(
      metaMessage,
      metaError?.code,
      stage,
    );

    this.logger.error(
      `Erro da Meta/WhatsApp Cloud API no ${stage === 'upload' ? 'upload do PDF' : 'envio do documento'}: ${JSON.stringify(metaResponse ?? axiosError.message)}`,
    );

    throw new BadRequestException({
      message: friendlyMessage,
      metaMessage,
      metaError: metaResponse,
      stage,
    });
  }

  private resolveFriendlyMetaMessage(
    metaMessage: string,
    metaCode: number | string | undefined,
    stage: MetaErrorStage,
  ) {
    const lowerMessage = metaMessage.toLowerCase();
    const code = String(metaCode ?? '');

    if (
      code === '190' ||
      lowerMessage.includes('access token') ||
      lowerMessage.includes('oauth') ||
      lowerMessage.includes('session has expired')
    ) {
      return 'Token da WhatsApp Cloud API inválido ou expirado.';
    }

    if (
      lowerMessage.includes('unsupported post request') ||
      lowerMessage.includes('object does not exist') ||
      lowerMessage.includes('phone number id')
    ) {
      return 'Phone Number ID da cidade inválido.';
    }

    if (
      lowerMessage.includes('recipient') ||
      lowerMessage.includes('not in allowed list') ||
      lowerMessage.includes('not a valid whatsapp user') ||
      lowerMessage.includes('not allowed') ||
      lowerMessage.includes('permission')
    ) {
      return 'Número do lojista não autorizado como destinatário de teste na Meta. Se estiver usando número de teste, cadastre o telefone no campo “Até” da tela da Meta.';
    }

    return stage === 'upload'
      ? 'Erro ao fazer upload do PDF para a Meta.'
      : 'Erro ao enviar documento pelo WhatsApp.';
  }
}
