import { getAnotaAiStoreId } from './anota-ai.mapper';

describe('Anota AI mapper', () => {
  it('deve usar Root apenas como identificador interno da loja Anota AI', () => {
    expect(getAnotaAiStoreId({ root: 'root-loja-123' })).toBe('root-loja-123');
    expect(getAnotaAiStoreId({ Root: 'root-loja-456' })).toBe('root-loja-456');
  });

  it('deve encontrar Root aninhado para vincular loja/usuário Rappidex', () => {
    expect(getAnotaAiStoreId({ order: { root: 'root-loja-789' } })).toBe(
      'root-loja-789',
    );
  });
});
