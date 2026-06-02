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

  async sendDocumentMessage({
    phone,
    message,
    pdfBuffer,
    filename,
    token: cityToken,
    phoneNumberId: cityPhoneNumberId,
  }: SendDocumentMessageInput) {
    const token =
      cityToken?.trim() || this.configService.get<string>('WHATSAPP_CLOUD_TOKEN');
    const phoneNumberId =
      cityPhoneNumberId?.trim() ||
      this.configService.get<string>('WHATSAPP_PHONE_NUMBER_ID');
    const apiVersion =
      this.configService.get<string>('WHATSAPP_CLOUD_API_VERSION') || 'v20.0';

    if (!token || !phoneNumberId) {
      throw new InternalServerErrorException(
        'WhatsApp da cidade não configurado. Configure o token e o Phone Number ID na tela de Cidades.',
      );
    }

    const mediaId = await this.uploadPdfMedia({
      token,
      phoneNumberId,
      apiVersion,
      pdfBuffer,
      filename,
    });

    const response = await axios.post(
      `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`,
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
          Authorization: `Bearer ${token}`,
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
