import { IfoodWebhookController } from './ifood-webhook.controller';

describe('IfoodWebhookController', () => {
  it('deve responder sucesso imediato e enfileirar processamento assíncrono', () => {
    const ifoodWebhookService = {
      enqueueIncomingEvents: jest.fn(),
    } as any;

    const controller = new IfoodWebhookController(ifoodWebhookService);

    const payload = [{ id: 'evt-1', orderId: 'ord-1' }];
    const response = controller.receiveWebhook(payload);

    expect(response).toEqual({
      success: true,
      processedAsync: true,
      received: 1,
    });
    expect(ifoodWebhookService.enqueueIncomingEvents).toHaveBeenCalledWith(
      payload,
    );
  });
});