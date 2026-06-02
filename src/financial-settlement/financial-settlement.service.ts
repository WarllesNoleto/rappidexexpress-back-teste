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
  motoboyName: string;
  status: string;
  createdAt?: Date;
  finishedAt?: Date;
};

type SettlementData = {
  establishment: UserEntity;
  establishmentName: string;
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

    if (!settlement.whatsapp) {
      throw new BadRequestException(
        'Este lojista não possui WhatsApp cadastrado no perfil.',
      );
    }

    this.logWhatsappContext(settlement, pdfBuffer);

    await this.historyRepository.save({
      establishmentId: settlement.establishment.id,
      establishmentName: settlement.establishmentName,
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
    if (!query.establishmentId) {
      throw new BadRequestException(
        'Selecione um estabelecimento para gerar o fechamento.',
      );
    }

    const establishment = await this.userRepository.findOneBy({
      id: query.establishmentId,
    });

    if (!establishment) {
      throw new NotFoundException('Lojista não encontrado.');
    }

    const whatsapp = this.normalizeWhatsapp(establishment.phone);

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
    const establishmentName = this.resolveEstablishmentName(
      establishment,
      deliveries[0],
    );
    const filename = this.buildFilename(establishmentName);
    const settlementDeliveries = deliveries.map((delivery) => ({
      orderId: String(
        delivery.ifoodDisplayId || delivery.ifoodOrderId || delivery.id,
      ),
      clientName: delivery.clientName,
      motoboyName: delivery.motoboy?.name || 'Não informado',
      status: delivery.status,
      createdAt: delivery.createdAt,
      finishedAt: delivery.finishedAt,
    }));

    const settlement: SettlementData = {
      establishment,
      establishmentName,
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
    const deliveryFeeValue = Number(city.deliveryFeeValue);
    return Number.isFinite(deliveryFeeValue) ? deliveryFeeValue : 0;
  }

  private buildWhatsappMessage(settlement: SettlementData) {
    return `Olá, ${settlement.establishmentName}!\n\nSegue o fechamento das entregas realizadas pela Rappidex Express.\n\nCidade: ${this.formatCity(settlement.city)}\nPeríodo: ${this.formatDate(settlement.periodStart)} até ${this.formatDate(settlement.periodEnd)}\nQuantidade de entregas: ${settlement.deliveries.length}\nValor por entrega: ${this.formatCurrency(settlement.deliveryFeeValue)}\nTotal a pagar: ${this.formatCurrency(settlement.total)}\n\nChave PIX para pagamento:\n${settlement.pixKey}\n\nO relatório em PDF foi gerado. Anexarei o arquivo nesta conversa.\n\nObrigado pela parceria!\nRappidex Express`;
  }

  private createPdfBuffer(settlement: SettlementData) {
    const rows = settlement.deliveries;
    const firstPageRows = 12;
    const nextPageRows = 22;
    const pages: SettlementDelivery[][] = [];

    pages.push(rows.slice(0, firstPageRows));
    for (
      let index = firstPageRows;
      index < rows.length;
      index += nextPageRows
    ) {
      pages.push(rows.slice(index, index + nextPageRows));
    }

    return this.renderSettlementPdf(settlement, pages);
  }

  private renderSettlementPdf(
    settlement: SettlementData,
    pages: SettlementDelivery[][],
  ) {
    const objects: string[] = [];
    const addObject = (content: string) => {
      objects.push(content);
      return objects.length;
    };

    const regularFontId = addObject(
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    );
    const boldFontId = addObject(
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    );
    const pageIds: number[] = [];
    const contentIds: number[] = [];

    pages.forEach((pageRows, pageIndex) => {
      const operators = this.buildSettlementPageOperators(
        settlement,
        pageRows,
        pageIndex + 1,
        pages.length,
      );
      const content = operators.join('\n');
      const contentId = addObject(
        `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
      );
      contentIds.push(contentId);
      pageIds.push(0);
    });

    const pagesIdPlaceholder = objects.length + pages.length + 1;
    pages.forEach((_, index) => {
      const pageId = addObject(
        `<< /Type /Page /Parent ${pagesIdPlaceholder} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${regularFontId} 0 R /F2 ${boldFontId} 0 R >> >> /Contents ${contentIds[index]} 0 R >>`,
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

  private buildSettlementPageOperators(
    settlement: SettlementData,
    rows: SettlementDelivery[],
    pageNumber: number,
    totalPages: number,
  ) {
    const ops: string[] = [];
    const yellow = '0.992 0.729 0.000';
    const red = '0.898 0.137 0.137';
    const dark = '0.067 0.067 0.067';
    const gray = '0.400 0.400 0.400';
    const lightGray = '0.965 0.965 0.965';
    const border = '0.870 0.870 0.870';

    const rect = (
      x: number,
      y: number,
      w: number,
      h: number,
      color: string,
    ) => {
      ops.push(`q ${color} rg ${x} ${y} ${w} ${h} re f Q`);
    };
    const strokeRect = (
      x: number,
      y: number,
      w: number,
      h: number,
      color = border,
    ) => {
      ops.push(`q ${color} RG 0.8 w ${x} ${y} ${w} ${h} re S Q`);
    };
    const text = (
      value: string,
      x: number,
      y: number,
      size = 10,
      font: 'F1' | 'F2' = 'F1',
      color = dark,
    ) => {
      ops.push(
        `BT ${color} rg /${font} ${size} Tf ${x} ${y} Td (${this.escapePdfText(value)}) Tj ET`,
      );
    };

    rect(0, 792, 595, 50, yellow);
    rect(0, 782, 595, 10, red);
    text('Rappidex Express', 40, 812, 18, 'F2', dark);
    text('Relatório de Fechamento', 360, 815, 15, 'F2', dark);
    text('Fechamento de entregas do período', 360, 798, 9, 'F1', dark);
    text(
      `Gerado em ${settlement.generatedAt.toLocaleString('pt-BR', { timeZone: 'UTC' })}`,
      40,
      770,
      9,
      'F1',
      gray,
    );

    let tableY = 706;
    if (pageNumber === 1) {
      rect(35, 648, 525, 100, '1 1 1');
      strokeRect(35, 648, 525, 100);
      rect(35, 730, 525, 18, lightGray);
      text('Dados do lojista', 48, 735, 11, 'F2', dark);
      text(
        `Estabelecimento: ${settlement.establishmentName}`,
        48,
        710,
        10,
        'F2',
      );
      text(
        `WhatsApp: ${settlement.whatsapp ? this.formatPhone(settlement.whatsapp) : 'Não cadastrado'}`,
        48,
        690,
      );
      text(`Cidade: ${this.formatCity(settlement.city)}`, 310, 710);
      text(
        `Período: ${this.formatDate(settlement.periodStart)} até ${this.formatDate(settlement.periodEnd)}`,
        310,
        690,
      );

      const cards = [
        ['Entregas finalizadas', String(settlement.deliveries.length)],
        ['Valor por entrega', this.formatCurrency(settlement.deliveryFeeValue)],
        ['Total a pagar', this.formatCurrency(settlement.total)],
        ['Chave PIX', settlement.pixKey],
      ];
      cards.forEach(([label, value], index) => {
        const x = 35 + index * 132;
        rect(x, 570, 125, 58, index === 2 ? yellow : lightGray);
        strokeRect(x, 570, 125, 58);
        text(label, x + 10, 608, 8, 'F2', index === 2 ? dark : gray);
        text(
          this.truncate(value, 23),
          x + 10,
          586,
          index === 2 ? 13 : 11,
          'F2',
          dark,
        );
      });

      rect(35, 535, 525, 20, dark);
      text('Lista de entregas', 48, 542, 11, 'F2', '1 1 1');
      tableY = 506;
    } else {
      text('Lista de entregas (continuação)', 40, 744, 12, 'F2', dark);
      tableY = 716;
    }

    const headers = ['Pedido', 'Cliente', 'Data/Hora', 'Motoboy', 'Status'];
    const widths = [80, 145, 90, 115, 95];
    const startX = 35;
    const rowHeight = 24;
    rect(startX, tableY, 525, rowHeight, dark);
    let currentX = startX;
    headers.forEach((header, index) => {
      text(header, currentX + 6, tableY + 8, 8, 'F2', '1 1 1');
      currentX += widths[index];
    });

    rows.forEach((delivery, rowIndex) => {
      const y = tableY - (rowIndex + 1) * rowHeight;
      rect(startX, y, 525, rowHeight, rowIndex % 2 === 0 ? '1 1 1' : lightGray);
      strokeRect(startX, y, 525, rowHeight);
      const values = [
        `#${delivery.orderId}`,
        delivery.clientName || 'Não informado',
        this.formatDateTime(delivery.finishedAt || delivery.createdAt),
        delivery.motoboyName,
        delivery.status,
      ];
      currentX = startX;
      values.forEach((value, index) => {
        text(
          this.truncate(value, index === 1 ? 24 : 17),
          currentX + 6,
          y + 8,
          8,
        );
        currentX += widths[index];
      });
    });

    rect(0, 0, 595, 36, lightGray);
    text(
      'Rappidex Express - Relatório gerado automaticamente',
      35,
      14,
      9,
      'F1',
      gray,
    );
    text(`Página ${pageNumber} de ${totalPages}`, 500, 14, 9, 'F2', gray);

    return ops;
  }

  private parsePeriodDate(value: string, endOfDay: boolean) {
    if (!value) {
      throw new BadRequestException('Período do fechamento inválido.');
    }

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
    const slug = this.slugifyFileName(establishmentName);
    return `relatorio_de_fechamento_${slug || 'estabelecimento'}.pdf`;
  }

  private slugifyFileName(value: string) {
    return String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  private resolveEstablishmentName(
    establishment: UserEntity,
    delivery?: DeliveryEntity,
  ) {
    const candidates = [
      establishment.name,
      delivery?.establishment?.name,
      establishment.user,
      'estabelecimento',
    ];

    return (
      candidates
        .map((candidate) => String(candidate ?? '').trim())
        .find(Boolean) ?? 'estabelecimento'
    );
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

  private formatDateTime(date?: Date) {
    if (!date) return 'Não informado';

    return date.toLocaleString('pt-BR', {
      timeZone: 'UTC',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  private formatPhone(phone: string) {
    return phone.replace(/^(55)(\d{2})(\d{4,5})(\d{4})$/, '+$1 ($2) $3-$4');
  }

  private truncate(value: string, maxLength: number) {
    if (value.length <= maxLength) return value;
    return `${value.slice(0, Math.max(maxLength - 3, 0))}...`;
  }

  private escapePdfText(value: string) {
    return String(value ?? '')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
      .replace(/[^\x20-\xFF]/g, '')
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)');
  }

  private escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
