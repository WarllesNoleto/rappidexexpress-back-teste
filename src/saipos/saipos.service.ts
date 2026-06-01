import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MongoRepository } from 'typeorm';
import { DeliveryEntity, UserEntity } from '../database/entities';
import { CreateDeliveryDto } from '../delivery/dto';
import { DeliveryService } from '../delivery/delivery.service';
import {
  PaymentType,
  StatusDelivery,
  UserType,
} from '../shared/constants/enums.constants';

@Injectable()
export class SaiposService {
  private readonly logger = new Logger(SaiposService.name);

  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: MongoRepository<UserEntity>,
    @InjectRepository(DeliveryEntity)
    private readonly deliveryRepository: MongoRepository<DeliveryEntity>,
    private readonly deliveryService: DeliveryService,
  ) {}

  async processWebhook(
    rawPayload: any,
    headers?: Record<string, any>,
  ): Promise<void> {
    this.logger.log('[SAIPOS WEBHOOK] pedido recebido');
    this.logger.log(
      `[SAIPOS WEBHOOK] payload=${JSON.stringify(rawPayload || {})}`,
    );

    try {
      const payload = this.extractOrderPayload(rawPayload);
      const orderId = this.extractOrderId(payload, rawPayload);

      if (!orderId) {
        this.logger.warn('[SAIPOS WEBHOOK] pedido sem ID externo ignorado');
        return;
      }

      if (await this.hasDuplicateDelivery(orderId)) {
        this.logger.log('[SAIPOS WEBHOOK] pedido duplicado ignorado');
        return;
      }

      const establishment = await this.findLinkedStore(payload, rawPayload);
      if (!establishment) {
        this.logger.warn('[SAIPOS WEBHOOK] loja não encontrada');
        return;
      }

      if (establishment.saiposEnabled === false) {
        this.logger.warn(
          '[SAIPOS WEBHOOK] integração desativada para esta loja',
        );
        return;
      }

      if (!this.validateStoreToken(establishment, headers)) {
        this.logger.warn('[SAIPOS WEBHOOK] token inválido para esta loja');
        return;
      }

      const delivery = this.mapSaiposOrderToDelivery(
        payload,
        rawPayload,
        establishment.id,
        orderId,
      );

      const createdDelivery = await this.deliveryService.createDelivery(
        delivery,
        {
          id: establishment.id,
          type: establishment.type || UserType.SHOPKEEPER,
          permission: establishment.permission,
        } as any,
        { skipCreditConsumption: true, creditOrderId: orderId },
      );

      this.logger.log(
        `[SAIPOS WEBHOOK] entrega criada com sucesso deliveryId=${createdDelivery.id} orderId=${orderId}`,
      );
    } catch (error: any) {
      this.logger.error(
        '[SAIPOS WEBHOOK] erro ao processar pedido',
        error?.stack || error,
      );
    }
  }

  private async hasDuplicateDelivery(orderId: string): Promise<boolean> {
    const delivery = await this.deliveryRepository.findOne({
      where: {
        source: 'saipos',
        externalOrderId: orderId,
        isActive: true,
      } as any,
    });

    return Boolean(delivery);
  }

  private async findLinkedStore(
    payload: any,
    rawPayload: any,
  ): Promise<UserEntity | null> {
    const storeId = this.extractStoreId(payload, rawPayload);
    const merchantId = this.extractMerchantId(payload, rawPayload) || storeId;

    if (!storeId && !merchantId) {
      return null;
    }

    const conditions = [];
    if (storeId) {
      conditions.push({ saiposStoreId: storeId });
    }
    if (merchantId) {
      conditions.push({ saiposMerchantId: merchantId });
    }

    for (const where of conditions) {
      const establishment = await this.userRepository.findOne({
        where: {
          ...where,
          isActive: true,
        } as any,
      });

      if (establishment) {
        return establishment;
      }
    }

    return null;
  }

  private validateStoreToken(
    establishment: UserEntity,
    headers?: Record<string, any>,
  ): boolean {
    const expectedToken = this.normalizeText(establishment.saiposToken);
    if (!expectedToken) {
      return true;
    }

    const receivedToken = this.normalizeText(
      headers?.['x-saipos-token'] ||
        headers?.['saipos-token'] ||
        headers?.['x-webhook-token'] ||
        headers?.authorization?.replace(/^Bearer\s+/i, ''),
    );

    return receivedToken === expectedToken;
  }

  private mapSaiposOrderToDelivery(
    payload: any,
    rawPayload: any,
    establishmentId: string,
    orderId: string,
  ): CreateDeliveryDto {
    const address =
      payload?.deliveryAddress ||
      payload?.delivery_address ||
      payload?.address ||
      payload?.endereco ||
      payload?.enderecoEntrega ||
      payload?.customer?.address ||
      payload?.cliente?.endereco ||
      {};
    const customer =
      payload?.customer || payload?.cliente || payload?.client || {};
    const total =
      payload?.total ??
      payload?.amount ??
      payload?.orderTotal ??
      payload?.valorTotal ??
      payload?.valor_total ??
      payload?.payment?.total ??
      payload?.pagamento?.total ??
      0;

    const displayId = this.firstTextFromKeys(payload, [
      'displayId',
      'display_id',
      'numeroPedido',
      'numero_pedido',
      'number',
      'numero',
      'code',
      'codigo',
    ]);

    return {
      establishmentId,
      status: StatusDelivery.PENDING,
      clientName:
        this.firstTextFromCandidates(
          customer?.name,
          customer?.nome,
          payload?.clientName,
          payload?.customerName,
          payload?.nomeCliente,
        ) || 'Cliente Saipos',
      clientPhone:
        this.firstTextFromCandidates(
          customer?.phone,
          customer?.telefone,
          customer?.cellphone,
          customer?.celular,
          payload?.clientPhone,
          payload?.customerPhone,
          payload?.telefoneCliente,
        ) || 'Não informado',
      clientLocation: this.buildReadableAddress(address),
      clientAddress: this.buildReadableAddress(address),
      addressComplement:
        this.firstTextFromCandidates(
          address?.complement,
          address?.complemento,
        ) || undefined,
      addressReference:
        this.firstTextFromCandidates(address?.reference, address?.referencia) ||
        undefined,
      addressNeighborhood:
        this.firstTextFromCandidates(address?.neighborhood, address?.bairro) ||
        undefined,
      addressCity:
        this.firstTextFromCandidates(address?.city, address?.cidade) ||
        undefined,
      addressState:
        this.firstTextFromCandidates(
          address?.state,
          address?.uf,
          address?.estado,
        ) || undefined,
      addressZipCode:
        this.firstTextFromCandidates(
          address?.zipCode,
          address?.zip_code,
          address?.postalCode,
          address?.cep,
        ) || undefined,
      addressLatitude: this.toNumber(
        address?.latitude ?? address?.lat ?? address?.coordinates?.latitude,
      ),
      addressLongitude: this.toNumber(
        address?.longitude ?? address?.lng ?? address?.coordinates?.longitude,
      ),
      value: String(total || 0),
      payment: this.mapPaymentType(payload),
      soda: 'NÃO',
      observation: this.buildObservation(payload, displayId),
      source: 'saipos',
      externalOrderId: orderId,
      integrationOrigin: 'saipos',
      rawIntegrationPayload: rawPayload || payload,
    } as CreateDeliveryDto;
  }

  private buildObservation(payload: any, displayId?: string): string {
    const notes = this.firstTextFromCandidates(
      payload?.observation,
      payload?.observations,
      payload?.notes,
      payload?.comments,
      payload?.observacao,
      payload?.observacoes,
    );
    const items = this.describeItems(payload?.items || payload?.itens || []);

    return [
      `Pedido Saipos #${displayId || this.extractOrderId(payload) || 'sem número'}`,
      items,
      notes,
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  private describeItems(items: any[]): string {
    if (!Array.isArray(items) || !items.length) {
      return '';
    }

    return items
      .map((item) => {
        const quantity = item?.quantity ?? item?.quantidade ?? item?.qtd ?? 1;
        const name = this.firstTextFromCandidates(
          item?.name,
          item?.nome,
          item?.description,
          item?.descricao,
        );
        return name ? `${quantity}x ${name}` : '';
      })
      .filter(Boolean)
      .join('\n');
  }

  private mapPaymentType(payload: any): PaymentType {
    const payment = this.normalizeText(
      [
        payload?.payment?.method,
        payload?.payment?.type,
        payload?.paymentMethod,
        payload?.payment_type,
        payload?.pagamento?.metodo,
        payload?.pagamento?.tipo,
        payload?.formaPagamento,
        payload?.forma_pagamento,
      ]
        .filter(Boolean)
        .join(' '),
    ).toLowerCase();

    if (payment.includes('pix')) {
      return PaymentType.PIX;
    }
    if (payment.includes('dinheiro') || payment.includes('cash')) {
      return PaymentType.DINHEIRO;
    }
    if (
      payment.includes('cart') ||
      payment.includes('card') ||
      payment.includes('credito') ||
      payment.includes('crédito') ||
      payment.includes('debito') ||
      payment.includes('débito')
    ) {
      return PaymentType.CARTAO;
    }

    return PaymentType.PAGO;
  }

  private extractOrderPayload(payload: any): any {
    if (!payload || typeof payload !== 'object') {
      return {};
    }

    return (
      payload.order ||
      payload.pedido ||
      payload.data ||
      payload.payload ||
      payload
    );
  }

  private extractOrderId(payload: any, rawPayload?: any): string {
    return (
      this.firstTextFromKeys(payload, [
        'id',
        'orderId',
        'order_id',
        'pedidoId',
        'pedido_id',
        'saiposOrderId',
        'saipos_order_id',
        'uuid',
        'externalId',
        'external_id',
      ]) ||
      this.firstTextFromKeys(rawPayload, [
        'id',
        'orderId',
        'order_id',
        'pedidoId',
        'pedido_id',
        'saiposOrderId',
        'saipos_order_id',
        'uuid',
        'externalId',
        'external_id',
      ])
    );
  }

  private extractStoreId(payload: any, rawPayload: any): string {
    return (
      this.firstTextFromKeys(payload, [
        'saiposStoreId',
        'saipos_store_id',
        'storeId',
        'store_id',
        'lojaId',
        'loja_id',
        'companyId',
        'company_id',
        'restaurantId',
        'restaurant_id',
      ]) ||
      this.firstTextFromKeys(rawPayload, [
        'saiposStoreId',
        'saipos_store_id',
        'storeId',
        'store_id',
        'lojaId',
        'loja_id',
        'companyId',
        'company_id',
        'restaurantId',
        'restaurant_id',
      ])
    );
  }

  private extractMerchantId(payload: any, rawPayload: any): string {
    return (
      this.firstTextFromKeys(payload, [
        'saiposMerchantId',
        'saipos_merchant_id',
        'merchantId',
        'merchant_id',
        'establishmentId',
        'establishment_id',
      ]) ||
      this.firstTextFromKeys(rawPayload, [
        'saiposMerchantId',
        'saipos_merchant_id',
        'merchantId',
        'merchant_id',
        'establishmentId',
        'establishment_id',
      ])
    );
  }

  private firstTextFromKeys(payload: any, keys: string[]): string {
    if (!payload || typeof payload !== 'object') {
      return '';
    }

    for (const key of keys) {
      const value = this.extractScalar(payload[key]);
      if (value) {
        return value;
      }
    }

    for (const candidate of [
      payload.order,
      payload.pedido,
      payload.data,
      payload.payload,
      payload.store,
      payload.loja,
      payload.merchant,
      payload.establishment,
      payload.restaurant,
    ]) {
      const value = this.firstTextFromKeys(candidate, keys);
      if (value) {
        return value;
      }
    }

    return '';
  }

  private extractScalar(value: any): string {
    if (['string', 'number', 'boolean'].includes(typeof value)) {
      return this.normalizeText(value);
    }

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return '';
    }

    for (const key of [
      'id',
      '_id',
      'uuid',
      'externalId',
      'external_id',
      'code',
    ]) {
      const nestedValue = this.extractScalar(value[key]);
      if (nestedValue) {
        return nestedValue;
      }
    }

    return '';
  }

  private firstTextFromCandidates(...values: any[]): string {
    for (const value of values) {
      const normalized = this.normalizeText(value);
      if (normalized) {
        return normalized;
      }
    }

    return '';
  }

  private buildReadableAddress(address: any): string {
    if (!address || typeof address !== 'object') {
      return '';
    }

    return [
      this.firstTextFromCandidates(
        address?.formattedAddress,
        address?.formatted_address,
        address?.fullAddress,
        address?.full_address,
        address?.logradouro,
        [address?.street, address?.streetNumber || address?.number]
          .filter(Boolean)
          .join(', '),
        [address?.rua, address?.numero].filter(Boolean).join(', '),
      ),
      this.firstTextFromCandidates(address?.neighborhood, address?.bairro),
      [
        this.firstTextFromCandidates(address?.city, address?.cidade),
        this.firstTextFromCandidates(
          address?.state,
          address?.uf,
          address?.estado,
        ),
      ]
        .filter(Boolean)
        .join('/'),
      this.firstTextFromCandidates(address?.complement, address?.complemento),
      this.firstTextFromCandidates(address?.reference, address?.referencia),
      this.firstTextFromCandidates(
        address?.zipCode,
        address?.zip_code,
        address?.postalCode,
        address?.cep,
      ),
    ]
      .filter(Boolean)
      .join(' | ');
  }

  private normalizeText(value: any): string {
    if (value === undefined || value === null) {
      return '';
    }

    return String(value).trim();
  }

  private toNumber(value: any): number | undefined {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
  }
}
