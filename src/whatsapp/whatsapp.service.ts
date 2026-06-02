import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface SendDocumentMessageInput {
  phone: string;
  message: string;
  pdfBuffer: Buffer;
  filename: string;
  token?: string;
  phoneNumberId?: string;
}

@Injectable()
export class WhatsappService {
  constructor(private readonly configService: ConfigService) {}

  resolveDocumentMessageConfig(options?: {
    token?: string;
    phoneNumberId?: string;
  }) {
    const cityToken = String(options?.token ?? '').trim();
    const cityPhoneNumberId = String(options?.phoneNumberId ?? '').trim();
    const globalToken =
      this.configService.get<string>('WHATSAPP_CLOUD_TOKEN') || '';
    const globalPhoneNumberId =
      this.configService.get<string>('WHATSAPP_PHONE_NUMBER_ID') || '';
    const token = cityToken && cityPhoneNumberId ? cityToken : globalToken;
    const phoneNumberId =
      cityToken && cityPhoneNumberId ? cityPhoneNumberId : globalPhoneNumberId;
    const apiVersion =
      this.configService.get<string>('WHATSAPP_CLOUD_API_VERSION') || 'v20.0';

    if (!token || !phoneNumberId) {
      throw new InternalServerErrorException(
        'API de WhatsApp não configurada. Defina token e Phone Number ID da cidade ou configure WHATSAPP_CLOUD_TOKEN e WHATSAPP_PHONE_NUMBER_ID.',
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
  }: SendDocumentMessageInput) {
    const config = this.resolveDocumentMessageConfig({ token, phoneNumberId });

    const mediaId = await this.uploadPdfMedia({
      token: config.token,
      phoneNumberId: config.phoneNumberId,
      apiVersion: config.apiVersion,
      pdfBuffer,
      filename,
    });

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
  }
}
