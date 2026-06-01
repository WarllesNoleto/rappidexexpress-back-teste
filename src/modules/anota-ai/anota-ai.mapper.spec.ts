import {
  getAnotaAiOrderId,
  getAnotaAiStoreId,
  isAcceptedAnotaAiOrder,
} from './anota-ai.mapper';

describe('Anota AI mapper', () => {
  it('deve aceitar somente status 1 para criar entrega Anota AI', () => {
    expect(isAcceptedAnotaAiOrder({ status: 1 })).toBe(true);
    expect(isAcceptedAnotaAiOrder({ status: '1' })).toBe(true);

    for (const status of [0, 2, 3, 4, 'accepted', 'confirmed']) {
      expect(isAcceptedAnotaAiOrder({ status })).toBe(false);
    }
  });

  it('deve usar Root apenas como identificador interno da loja Anota AI', () => {
    expect(getAnotaAiStoreId({ root: 'root-loja-123' })).toBe('root-loja-123');
    expect(getAnotaAiStoreId({ Root: 'root-loja-456' })).toBe('root-loja-456');
  });

  it('deve encontrar Root aninhado para vincular loja/usuário Rappidex', () => {
    expect(getAnotaAiStoreId({ order: { root: 'root-loja-789' } })).toBe(
      'root-loja-789',
    );
  });

  it('não deve usar id genérico de evento como id do pedido Anota AI', () => {
    expect(
      getAnotaAiOrderId({
        id: 'evento-webhook-123',
        event: 'order.updated',
        data: { id: 'resource-sem-formato-de-pedido' },
      }),
    ).toBeUndefined();
  });

  it('deve aceitar _id ou id genérico quando o objeto parecer pedido', () => {
    expect(
      getAnotaAiOrderId({
        id: 'evento-webhook-123',
        data: { _id: 'pedido-data-123', status: 1 },
      }),
    ).toBe('pedido-data-123');

    expect(
      getAnotaAiOrderId({
        order: { id: 'pedido-order-456', items: [] },
      }),
    ).toBe('pedido-order-456');
  });

  it('deve aceitar campos específicos de pedido mesmo sem formato completo', () => {
    expect(
      getAnotaAiOrderId({
        payload: { pedido_id: 'pedido-especifico-789' },
      }),
    ).toBe('pedido-especifico-789');
  });
});
