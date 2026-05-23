export type AiqfomeEvent =
  | 'new-order'
  | 'read-order'
  | 'ready-order'
  | 'cancel-order'
  | 'order-refund'
  | 'order-logistic';

export interface AiqfomeWebhookPayload {
  event?: AiqfomeEvent | string;
  store_id?: string;
  storeId?: string;
  order_id?: string;
  orderId?: string;
  data?: {
    order_id?: string;
    orderId?: string;
    id?: string;
    [key: string]: any;
  };
  [key: string]: any;
}
