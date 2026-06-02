import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ObjectId } from 'mongodb';
import { MongoRepository } from 'typeorm';

import {
  CityEntity,
  DeliveryEntity,
  FinancialSettlementHistoryEntity,
  UserEntity,
} from '../database/entities';
import { StatusDelivery } from '../shared/constants/enums.constants';
import { FinancialSettlementQueryDto } from './dto';

type SettlementDelivery = {
  orderId: string;
  clientName: string;
  status: string;
  createdAt?: Date;
  finishedAt?: Date;
};

type SettlementData = {
  establishment: UserEntity;
  city: CityEntity;
  periodStart: Date;
  periodEnd: Date;
  generatedAt: Date;
  deliveries: SettlementDelivery[];
  deliveryFeeValue: number;
  pixKey: string;
  total: number;
  whatsapp: string;
  filename: string;
  message: string;
};

@Injectable()
export class FinancialSettlementService {
  private readonly logger = new Logger(FinancialSettlementService.name);

  constructor(
    @InjectRepository(DeliveryEntity)
    private readonly deliveryRepository: MongoRepository<DeliveryEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepository: MongoRepository<UserEntity>,
    @InjectRepository(CityEntity)
    private readonly cityRepository: MongoRepository<CityEntity>,
    @InjectRepository(FinancialSettlementHistoryEntity)
    private readonly historyRepository: MongoRepository<FinancialSettlementHistoryEntity>,
  ) {}

  async generatePdf(query: FinancialSettlementQueryDto) {
    const settlement = await this.buildSettlement(query);
    return {
      filename: settlement.filename,
      buffer: this.createPdfBuffer(settlement),
    };
  }

  async sendWhatsapp(query: FinancialSettlementQueryDto) {
    const settlement = await this.buildSettlement(query);
    const pdfBuffer = this.createPdfBuffer(settlement);

    if (!pdfBuffer?.length) {
      throw new BadRequestException('PDF do fechamento não foi gerado.');
    }

    this.logWhatsappContext(settlement, pdfBuffer);

    await this.historyRepository.save({
      establishmentId: settlement.establishment.id,
      establishmentName: settlement.establishment.name,
      cityId: settlement.city.id?.toHexString?.() ?? `${settlement.city.id}`,
      cityName: this.formatCity(settlement.city),
      periodStart: settlement.periodStart,
      periodEnd: settlement.periodEnd,
      deliveriesCount: settlement.deliveries.length,
      deliveryFeeValue: settlement.deliveryFeeValue,
      total: settlement.total,
      pixKey: settlement.pixKey,
      whatsappPhone: settlement.whatsapp,
      filename: settlement.filename,
      sentAt: new Date(),
      status: 'ENVIO_MANUAL',
    });

    return {
      success: true,
      message:
        'PDF gerado e WhatsApp aberto com a mensagem pronta. Anexe o PDF manualmente antes de enviar.',
      filename: settlement.filename,
      whatsappPhone: settlement.whatsapp,
      whatsappMessage: settlement.message,
      whatsappUrl: this.buildWhatsappUrl(
        settlement.whatsapp,
        settlement.message,
      ),
      status: 'ENVIO_MANUAL',
    };
  }

  private async buildSettlement(query: FinancialSettlementQueryDto) {
    const periodStart = this.parsePeriodDate(query.createdIn, false);
    const periodEnd = this.parsePeriodDate(query.createdUntil, true);
    const establishment = await this.userRepository.findOneBy({
      id: query.establishmentId,
    });

    if (!establishment) {
      throw new NotFoundException('Lojista não encontrado.');
    }

    const whatsapp = this.normalizeWhatsapp(establishment.phone);
    if (!whatsapp) {
      throw new BadRequestException(
        'Este lojista não possui WhatsApp cadastrado no perfil.',
      );
    }

    const deliveries = await this.deliveryRepository.find({
      where: {
        isActive: true,
        status: query.status || StatusDelivery.FINISHED,
        'establishment.id': establishment.id,
        createdAt: {
          $gte: periodStart,
          $lte: periodEnd,
        },
      },
      order: { createdAt: 'ASC' },
    });

    if (!deliveries.length) {
      throw new BadRequestException(
        'Nenhuma entrega encontrada para este período.',
      );
    }

    const city = await this.resolveCity(deliveries[0], establishment);
    if (!city) {
      throw new BadRequestException(
        'Cidade não encontrada para este fechamento.',
      );
    }

    const deliveryFeeValue = this.getDeliveryFeeValue(city);
    if (!deliveryFeeValue) {
      throw new BadRequestException(
        'Valor da entrega não configurado para esta cidade.',
      );
    }

    const pixKey = String(city.pixKey ?? '').trim();
    if (!pixKey) {
      throw new BadRequestException(
        'Chave PIX não configurada para esta cidade.',
      );
    }

    const total = deliveries.length * deliveryFeeValue;
    const filename = this.buildFilename(establishment.name);
    const settlementDeliveries = deliveries.map((delivery) => ({
      orderId: delivery.ifoodDisplayId || delivery.ifoodOrderId || delivery.id,
      clientName: delivery.clientName,
      status: delivery.status,
      createdAt: delivery.createdAt,
      finishedAt: delivery.finishedAt,
    }));

    const settlement: SettlementData = {
      establishment,
      city,
      periodStart,
      periodEnd,
      generatedAt: new Date(),
      deliveries: settlementDeliveries,
      deliveryFeeValue,
      pixKey,
      total,
      whatsapp,
      filename,
      message: '',
    };
    settlement.message = this.buildWhatsappMessage(settlement);

    return settlement;
  }

  private async resolveCity(
    delivery: DeliveryEntity,
    establishment: UserEntity,
  ) {
    const deliveryCityId = String((delivery as any).cityId ?? '').trim();
    if (deliveryCityId) {
      const byDelivery = await this.findCityById(deliveryCityId);
      if (byDelivery) return byDelivery;
    }

    if (establishment.cityId) {
      const byEstablishment = await this.findCityById(establishment.cityId);
      if (byEstablishment) return byEstablishment;
    }

    if (delivery.addressCity) {
      const where: Record<string, any> = {
        name: new RegExp(`^${this.escapeRegExp(delivery.addressCity)}$`, 'i'),
      };
      if (delivery.addressState) {
        where.state = new RegExp(
          `^${this.escapeRegExp(delivery.addressState)}$`,
          'i',
        );
      }
      return this.cityRepository.findOne({ where });
    }

    return null;
  }

  private async findCityById(cityId: string) {
    try {
      return await this.cityRepository.findOne({
        where: { _id: new ObjectId(cityId) },
      });
    } catch {
      return null;
    }
  }

  private getDeliveryFeeValue(city: CityEntity) {
    if (typeof city.deliveryFeeValue === 'number') {
      return city.deliveryFeeValue;
    }

    const legacyValue = String(city.deliveryValue ?? '').trim();
    if (!legacyValue) return 0;

    const normalized = legacyValue.includes(',')
      ? legacyValue.replace(/\./g, '').replace(',', '.')
      : legacyValue;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private buildWhatsappMessage(settlement: SettlementData) {
    return `Olá, ${settlement.establishment.name}!\n\nSegue o fechamento das entregas realizadas pela Rappidex Express.\n\nCidade: ${this.formatCity(settlement.city)}\nPeríodo: ${this.formatDate(settlement.periodStart)} até ${this.formatDate(settlement.periodEnd)}\nQuantidade de entregas: ${settlement.deliveries.length}\nValor por entrega: ${this.formatCurrency(settlement.deliveryFeeValue)}\nTotal a pagar: ${this.formatCurrency(settlement.total)}\n\nChave PIX para pagamento:\n${settlement.pixKey}\n\nO relatório em PDF foi gerado. Anexarei o arquivo nesta conversa.\n\nObrigado pela parceria!\nRappidex Express`;
  }

  private createPdfBuffer(settlement: SettlementData) {
    const lines = [
      'RAPPIDEX EXPRESS',
      'Fechamento de entregas',
      '',
      `Empresa: ${settlement.establishment.name}`,
      `Cidade: ${this.formatCity(settlement.city)}`,
      `WhatsApp: ${this.formatPhone(settlement.whatsapp)}`,
      `Período: ${this.formatDate(settlement.periodStart)} até ${this.formatDate(settlement.periodEnd)}`,
      `Data de geração: ${settlement.generatedAt.toLocaleString('pt-BR')}`,
      '',
      `Quantidade de entregas: ${settlement.deliveries.length}`,
      `Valor por entrega: ${this.formatCurrency(settlement.deliveryFeeValue)}`,
      `Total a pagar: ${this.formatCurrency(settlement.total)}`,
      '',
      'Chave PIX para pagamento:',
      settlement.pixKey,
      '',
      'Entregas:',
      ...settlement.deliveries.map(
        (delivery) =>
          `Pedido #${delivery.orderId} | Cliente ${delivery.clientName || 'Não informado'} | Status ${delivery.status}`,
      ),
    ];

    return this.renderSimplePdf(lines);
  }

  private renderSimplePdf(lines: string[]) {
    const pages: string[][] = [];
    for (let index = 0; index < lines.length; index += 38) {
      pages.push(lines.slice(index, index + 38));
    }

    const objects: string[] = [];
    const addObject = (content: string) => {
      objects.push(content);
      return objects.length;
    };

    const fontId = addObject(
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    );
    const pageIds: number[] = [];
    const contentIds: number[] = [];

    pages.forEach((pageLines) => {
      const content = [
        'BT',
        '/F1 12 Tf',
        '50 790 Td',
        '16 TL',
        ...pageLines
          .flatMap((line, index) => [
            index === 0 ? '' : 'T*',
            `(${this.escapePdfText(line)}) Tj`,
          ])
          .filter(Boolean),
        'ET',
      ].join('\n');

      const contentId = addObject(
        `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
      );
      contentIds.push(contentId);
      pageIds.push(0);
    });

    const pagesIdPlaceholder = objects.length + pages.length + 1;
    pages.forEach((_, index) => {
      const pageId = addObject(
        `<< /Type /Page /Parent ${pagesIdPlaceholder} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentIds[index]} 0 R >>`,
      );
      pageIds[index] = pageId;
    });

    const pagesId = addObject(
      `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`,
    );
    const catalogId = addObject(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

    const chunks = ['%PDF-1.4\n'];
    const offsets: number[] = [0];
    objects.forEach((object, index) => {
      offsets.push(Buffer.byteLength(chunks.join(''), 'latin1'));
      chunks.push(`${index + 1} 0 obj\n${object}\nendobj\n`);
    });
    const xrefOffset = Buffer.byteLength(chunks.join(''), 'latin1');
    chunks.push(`xref\n0 ${objects.length + 1}\n`);
    chunks.push('0000000000 65535 f \n');
    for (let index = 1; index < offsets.length; index += 1) {
      chunks.push(`${String(offsets[index]).padStart(10, '0')} 00000 n \n`);
    }
    chunks.push(
      `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`,
    );

    return Buffer.from(chunks.join(''), 'latin1');
  }

  private parsePeriodDate(value: string, endOfDay: boolean) {
    const base = value.includes('T')
      ? new Date(value)
      : new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(base.getTime())) {
      throw new BadRequestException('Período do fechamento inválido.');
    }
    if (endOfDay) {
      base.setUTCHours(23, 59, 59, 999);
    }
    return base;
  }

  private buildFilename(establishmentName: string) {
    const slug = establishmentName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase();
    return `relatorio_de_fechamento_${slug || 'lojista'}.pdf`;
  }

  private normalizeWhatsapp(phone?: string) {
    const digits = String(phone ?? '')
      .replace(/[\s()+-]/g, '')
      .replace(/\D/g, '');

    if (!digits) return '';

    if (digits.length === 11 && !digits.startsWith('55')) {
      return `55${digits}`;
    }

    return digits;
  }

  private buildWhatsappUrl(phone: string, message: string) {
    return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  }

  private logWhatsappContext(settlement: SettlementData, pdfBuffer: Buffer) {
    this.logger.log(
      JSON.stringify({
        message:
          'Preparando fechamento financeiro para envio manual pelo WhatsApp',
        cityId: settlement.city.id?.toHexString?.() ?? `${settlement.city.id}`,
        cityName: this.formatCity(settlement.city),
        destinationPhone: settlement.whatsapp,
        hasPdf: Boolean(pdfBuffer?.length),
        pdfBytes: pdfBuffer?.length ?? 0,
      }),
    );
  }

  private formatCity(city: CityEntity) {
    return `${city.name}${city.state ? ` - ${city.state}` : ''}`;
  }

  private formatCurrency(value: number) {
    return value.toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    });
  }

  private formatDate(date: Date) {
    return date.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
  }

  private formatPhone(phone: string) {
    return phone.replace(/^(55)(\d{2})(\d{4,5})(\d{4})$/, '+$1 ($2) $3-$4');
  }

  private escapePdfText(value: string) {
    return value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\x20-\x7E]/g, '')
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)');
  }

  private escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
