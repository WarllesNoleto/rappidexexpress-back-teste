import {
  PaymentType,
  StatusDelivery,
} from '../../shared/constants/enums.constants';
import { CreateDeliveryDto } from '../../delivery/dto';

const ACCEPTED_STATUS_VALUES = new Set([
  '1',
  'em_producao',
  'em produção',
  'production',
  'preparing',
  'accepted',
  'confirmed',
]);

const ANOTA_AI_SHORT_ID_KEYS = [
  'shortId',
  'short_id',
  'displayId',
  'display_id',
  'numeroPedido',
  'numero_pedido',
];

const ANOTA_AI_STORE_ID_KEYS = [
  // "Root" no Portal de Integração da Anota AI é o identificador interno
  // gerado pela Anota AI para a loja/estabelecimento. Este valor deve ser
  // vinculado ao campo UserEntity.anotaAiStoreId quando o webhook enviar Root.
  'root',
  'Root',
  'rootId',
  'root_id',
  'storeId',
  'store_id',
  'merchantId',
  'merchant_id',
  'restaurantId',
  'restaurant_id',
  'establishmentId',
  'establishment_id',
  'lojaId',
  'loja_id',
];

const ANOTA_AI_EXTERNAL_RESTAURANT_ID_PATHS = [
  'externalRestaurantId',
  'external_restaurant_id',
  'restaurantExternalId',
  'restaurant_external_id',
  'idExternoRestaurante',
  'id_externo_restaurante',
  'companyExternalId',
  'company_external_id',
  'restaurant.externalId',
  'restaurant.external_id',
  'store.externalId',
  'store.external_id',
  'merchant.externalId',
  'merchant.external_id',
  'establishment.externalId',
  'establishment.external_id',
  'deliveryPoint.externalId',
  'deliveryPoint.external_id',
  'root.externalId',
  'root.external_id',
  'externalRestaurant',
  'restaurantIdExternal',
];

const IFOOD_MARKER_KEYS = [
  'origin',
  'source',
  'marketplace',
  'channel',
  'integration',
  'platform',
  'ifoodOrderId',
  'ifood_order_id',
];

const NESTED_IDENTIFIER_KEYS = [
  '_id',
  'id',
  'rootId',
  'root_id',
  'externalId',
  'external_id',
];

function isScalarValue(value: any): value is string | number | boolean {
  return ['string', 'number', 'boolean'].includes(typeof value);
}

function scalarToText(value: any): string {
  return isScalarValue(value) ? String(value).trim() : '';
}

function extractScalarValue(value: any): string | number | boolean | undefined {
  if (isScalarValue(value) && scalarToText(value)) {
    return value;
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  for (const key of NESTED_IDENTIFIER_KEYS) {
    const nestedValue = value[key];
    if (isScalarValue(nestedValue) && scalarToText(nestedValue)) {
      return nestedValue;
    }
  }

  return undefined;
}

function firstValueFromKeys(payload: any, keys: string[]): any {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  for (const key of keys) {
    const value = extractScalarValue(payload[key]);
    if (value !== undefined) {
      return value;
    }
  }

  const nestedCandidates = [
    payload.order,
    payload.data,
    payload.payload,
    payload.resource,
    payload.merchant,
    payload.store,
    payload.restaurant,
    payload.establishment,
  ];

  for (const candidate of nestedCandidates) {
    const value = firstValueFromKeys(candidate, keys);
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function firstValueFromPath(payload: any, path: string): any {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  const value = path.split('.').reduce((current, key) => {
    if (!current || typeof current !== 'object') {
      return undefined;
    }

    return current[key];
  }, payload);

  return extractScalarValue(value);
}

function firstValueFromPaths(payload: any, paths: string[]): any {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  for (const path of paths) {
    const value = firstValueFromPath(payload, path);
    if (value !== undefined) {
      return value;
    }
  }

  const wrapperCandidates = [
    payload.order,
    payload.data,
    payload.payload,
    payload.resource,
  ];

  for (const candidate of wrapperCandidates) {
    const value = firstValueFromPaths(candidate, paths);
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function normalizeText(value: any): string {
  return scalarToText(value);
}

function normalizeStatus(value: any): string {
  return normalizeText(value).toLowerCase();
}

export function isAcceptedAnotaAiOrder(payload: any): boolean {
  const status = firstValueFromKeys(payload, [
    'status',
    'orderStatus',
    'statusCode',
    'state',
  ]);
  return ACCEPTED_STATUS_VALUES.has(normalizeStatus(status));
}

function hasAnotaAiOrderShape(payload: any): boolean {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  return [
    'status',
    'customer',
    'deliveryAddress',
    'payment',
    'totals',
    'items',
  ].some((key) => payload[key] !== undefined && payload[key] !== null);
}

function normalizeAnotaAiOrderId(value: any): string | undefined {
  const normalized = normalizeText(value);
  return normalized || undefined;
}

export function getAnotaAiOrderId(payload: any): string | undefined {
  const orderId =
    normalizeAnotaAiOrderId(payload?.order?._id) ||
    normalizeAnotaAiOrderId(payload?.order?.id) ||
    normalizeAnotaAiOrderId(payload?.order?.orderId);

  if (orderId) {
    console.log('[ANOTA AI] ID do pedido extraído do objeto order');
    return orderId;
  }

  const dataId =
    normalizeAnotaAiOrderId(payload?.data?._id) ||
    normalizeAnotaAiOrderId(payload?.data?.id) ||
    normalizeAnotaAiOrderId(payload?.data?.orderId);

  if (dataId) {
    console.log('[ANOTA AI] ID do pedido extraído do objeto data');
    return dataId;
  }

  const nestedPayloadId =
    normalizeAnotaAiOrderId(payload?.payload?._id) ||
    normalizeAnotaAiOrderId(payload?.payload?.id);

  if (nestedPayloadId) {
    console.log('[ANOTA AI] ID do pedido extraído da raiz do payload');
    return nestedPayloadId;
  }

  const resourceId =
    normalizeAnotaAiOrderId(payload?.resource?._id) ||
    normalizeAnotaAiOrderId(payload?.resource?.id);

  if (resourceId) {
    console.log('[ANOTA AI] ID do pedido extraído da raiz do payload');
    return resourceId;
  }

  const rootId =
    normalizeAnotaAiOrderId(payload?._id) ||
    normalizeAnotaAiOrderId(payload?.order_id) ||
    normalizeAnotaAiOrderId(payload?.orderId);

  if (rootId) {
    console.log('[ANOTA AI] ID do pedido extraído da raiz do payload');
    return rootId;
  }

  const rootGenericId = normalizeAnotaAiOrderId(payload?.id);
  if (rootGenericId && hasAnotaAiOrderShape(payload)) {
    console.log('[ANOTA AI] ID do pedido extraído da raiz do payload');
    return rootGenericId;
  }

  console.warn('[ANOTA AI] ID do pedido não encontrado');
  return undefined;
}

export function getAnotaAiShortId(payload: any): string | undefined {
  const value = firstValueFromKeys(payload, ANOTA_AI_SHORT_ID_KEYS);
  const normalized = normalizeText(value);
  return normalized || undefined;
}

export function getAnotaAiExternalRestaurantId(
  payload: any,
): string | undefined {
  // Não usa externalId genérico do pedido: esse campo também pode representar
  // pedido, item ou outro recurso. Aqui buscamos somente chaves específicas do
  // ID Externo do Restaurante configurado no portal da Anota AI.
  const value = firstValueFromPaths(
    payload,
    ANOTA_AI_EXTERNAL_RESTAURANT_ID_PATHS,
  );
  const normalized = normalizeText(value);
  return normalized || undefined;
}

export function getAnotaAiStoreId(payload: any): string | undefined {
  const value = firstValueFromKeys(payload, ANOTA_AI_STORE_ID_KEYS);
  const normalized = normalizeText(value);
  return normalized || undefined;
}

export function isIfoodOrderFromAnotaAi(payload: any): boolean {
  const ifoodOrderId = firstValueFromKeys(payload, [
    'ifoodOrderId',
    'ifood_order_id',
  ]);
  if (normalizeText(ifoodOrderId)) {
    return true;
  }

  return IFOOD_MARKER_KEYS.some((key) => {
    const value = firstValueFromKeys(payload, [key]);
    return normalizeText(value).toLowerCase().includes('ifood');
  });
}

export function getAnotaAiIfoodOrderId(payload: any): string | undefined {
  const value = firstValueFromKeys(payload, [
    'ifoodOrderId',
    'ifood_order_id',
    'marketplaceOrderId',
    'marketplace_order_id',
  ]);
  const normalized = normalizeText(value);
  return normalized || undefined;
}

export function getAnotaAiIntegrationOrigin(payload: any): string | undefined {
  const value = firstValueFromKeys(payload, [
    'origin',
    'source',
    'marketplace',
    'channel',
    'integration',
    'platform',
  ]);
  const normalized = normalizeText(value);
  return normalized || undefined;
}

export function getAnotaAiOrderStatus(payload: any): string | undefined {
  const value = firstValueFromKeys(payload, [
    'status',
    'orderStatus',
    'statusCode',
    'state',
  ]);
  const normalized = normalizeText(value);
  return normalized || undefined;
}

function buildReadableAddress(address: any): string {
  const streetLine = [address?.street, address?.number, address?.complement]
    .map(normalizeText)
    .filter(Boolean)
    .join(', ');
  const cityLine = [address?.city, address?.state]
    .map(normalizeText)
    .filter(Boolean)
    .join(' - ');
  const parts = [streetLine, normalizeText(address?.neighborhood), cityLine]
    .filter(Boolean)
    .join(' - ');
  const zipCode = normalizeText(
    address?.zipCode || address?.zip_code || address?.postalCode,
  );

  return zipCode ? `${parts}, CEP ${zipCode}` : parts;
}

function describeSubItems(item: any): string {
  const subItems =
    item?.subItems ||
    item?.subitems ||
    item?.options ||
    item?.additions ||
    item?.complements ||
    [];
  if (!Array.isArray(subItems) || !subItems.length) {
    return '';
  }

  const descriptions = subItems
    .map((subItem) =>
      `${subItem?.quantity || subItem?.amount || 1}x ${normalizeText(subItem?.name || subItem?.title || subItem?.description)}`.trim(),
    )
    .filter(Boolean);

  return descriptions.length ? `Adicionais: ${descriptions.join(', ')}` : '';
}

function describeItems(items: any[]): string {
  if (!Array.isArray(items) || !items.length) {
    return '';
  }

  return items
    .map((item) => {
      const lines = [
        `${item?.quantity || item?.amount || 1}x ${normalizeText(item?.name || item?.title || item?.description || 'Item')}`,
      ];
      const observation = normalizeText(
        item?.observation || item?.obs || item?.notes || item?.comments,
      );
      const subItems = describeSubItems(item);

      if (observation) {
        lines.push(`Obs: ${observation}`);
      }

      if (subItems) {
        lines.push(subItems);
      }

      return lines.join('\n');
    })
    .join('\n\n');
}

function mapPaymentType(method: string): PaymentType {
  const normalized = method.toLowerCase();

  if (normalized.includes('pix')) return PaymentType.PIX;
  if (normalized.includes('dinheiro') || normalized.includes('cash'))
    return PaymentType.DINHEIRO;
  if (
    normalized.includes('cart') ||
    normalized.includes('card') ||
    normalized.includes('credit') ||
    normalized.includes('debit')
  )
    return PaymentType.CARTAO;

  return PaymentType.PAGO;
}

export function mapAnotaAiOrderToDelivery(
  payload: any,
  establishmentId: string,
): CreateDeliveryDto {
  const address =
    payload?.deliveryAddress ||
    payload?.address ||
    payload?.customer?.address ||
    {};
  const paymentMethod = normalizeText(
    payload?.payment?.method || payload?.payments?.[0]?.method,
  );
  const paymentType = normalizeText(
    payload?.payment?.type || payload?.payments?.[0]?.type,
  );
  const total =
    payload?.totals?.total ??
    payload?.payment?.total ??
    payload?.total ??
    payload?.amount ??
    0;
  const itemDescription = describeItems(
    payload?.items || payload?.orderItems || [],
  );
  const generalObservation = normalizeText(
    payload?.observation || payload?.notes || payload?.comments,
  );
  const observation = [itemDescription, generalObservation]
    .filter(Boolean)
    .join('\n\n');

  return {
    establishmentId,
    status: StatusDelivery.AWAITING_RELEASE,
    clientName:
      normalizeText(
        payload?.customer?.name || payload?.clientName || payload?.name,
      ) || 'Cliente Anota AI',
    clientPhone:
      normalizeText(
        payload?.customer?.phone || payload?.clientPhone || payload?.phone,
      ) || 'Não informado',
    clientLocation: buildReadableAddress(address),
    clientAddress: buildReadableAddress(address),
    addressComplement: normalizeText(address?.complement) || undefined,
    addressNeighborhood: normalizeText(address?.neighborhood) || undefined,
    addressCity: normalizeText(address?.city) || undefined,
    addressState: normalizeText(address?.state) || undefined,
    addressZipCode:
      normalizeText(
        address?.zipCode || address?.zip_code || address?.postalCode,
      ) || undefined,
    value: String(total || 0),
    payment: mapPaymentType(`${paymentMethod} ${paymentType}`),
    soda: 'NÃO',
    observation: observation || 'Pedido Anota AI sem observações.',
    source: 'anotaai',
    externalOrderId: getAnotaAiOrderId(payload),
    anotaAiOrderId: getAnotaAiOrderId(payload),
    anotaAiShortId: getAnotaAiShortId(payload),
    integrationOrigin: getAnotaAiIntegrationOrigin(payload),
    rawIntegrationPayload: payload,
  } as CreateDeliveryDto;
}
