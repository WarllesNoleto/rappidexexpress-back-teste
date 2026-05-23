import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DeliveryService } from './delivery.service';
import { DeliveryEntity, LogEntity, UserEntity } from '../database/entities';
import { OrdersGateway } from '../gateway/orders.gateway';
import { IfoodOrdersService } from '../ifood/ifood-orders.service';
import { IfoodOrderLinkService } from '../ifood/ifood-order-link.service';
import { IfoodCreditsService } from '../ifood/ifood-credits.service';
import { IfoodEventService } from '../ifood/ifood-event.service';
import { StatusDelivery } from '../shared/constants/enums.constants';

describe('DeliveryService', () => {
  let service: DeliveryService;
  let ifoodOrdersService: any;
  let ifoodOrderLinkService: any;
  let ifoodEventService: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeliveryService,
        {
          provide: getRepositoryToken(UserEntity),
          useValue: {
            findOneBy: jest.fn(),
            find: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(DeliveryEntity),
          useValue: {
            findOneBy: jest.fn(),
            find: jest.fn(),
            save: jest.fn(),
            deleteOne: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(LogEntity),
          useValue: {
            find: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: OrdersGateway,
          useValue: {
            emit: jest.fn(),
          },
        },
        {
          provide: IfoodOrdersService,
          useValue: {
            assignDriver: jest.fn(),
            notifyGoingToOrigin: jest.fn(),
            notifyArrivedAtOrigin: jest.fn(),
            dispatchLogisticsOrder: jest.fn(),
            dispatchOrder: jest.fn(),
            notifyArrivedAtDestination: jest.fn(),
            verifyDeliveryCode: jest.fn().mockResolvedValue({ success: true }),
            requestCancellation: jest.fn(),
            getOrderDetails: jest.fn().mockResolvedValue({ orderStatus: 'CON' }),
          },
        },
        {
          provide: IfoodOrderLinkService,
          useValue: {
            findByDeliveryId: jest.fn(),
          },
        },
        {
          provide: IfoodCreditsService,
          useValue: {
            consumeCredit: jest.fn(),
            rollbackCreditUsage: jest.fn(),
          },
        },
        {
          provide: IfoodEventService,
          useValue: {
            hasDeliveryDropCodeRequested: jest.fn().mockResolvedValue(true),
          },
        },
      ],
    }).compile();

    service = module.get<DeliveryService>(DeliveryService);
    ifoodOrdersService = module.get(IfoodOrdersService);
    ifoodOrderLinkService = module.get(IfoodOrderLinkService);
    ifoodEventService = module.get(IfoodEventService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('deve sincronizar entregador a caminho da loja no status ONCOURSE', async () => {
    ifoodOrderLinkService.findByDeliveryId.mockResolvedValue({
      ifoodOrderId: 'ifood-1',
      merchantId: 'merchant-1',
    });

    await (service as any).syncIfoodIfNeeded(
      {
        id: 'delivery-1',
        status: StatusDelivery.PENDING,
        ifoodAssignDriverSynced: false,
        ifoodGoingToOriginSynced: false,
      },
      { motoboy: { id: 'm1', name: 'João', phone: '11999999999' } },
      { status: StatusDelivery.ONCOURSE },
    );

    expect(ifoodOrdersService.assignDriver).toHaveBeenCalledWith(
      'ifood-1',
      expect.objectContaining({ id: 'm1' }),
      'merchant-1',
    );
    expect(ifoodOrdersService.notifyGoingToOrigin).toHaveBeenCalledWith(
      'ifood-1',
      'merchant-1',
    );
  });

  it('deve executar sequência logística completa no status COLLECTED sem chamar módulo Order', async () => {
    ifoodOrderLinkService.findByDeliveryId.mockResolvedValue({
      ifoodOrderId: 'ifood-2',
      merchantId: 'merchant-2',
    });

    await (service as any).syncIfoodIfNeeded(
      {
        id: 'delivery-2',
        status: StatusDelivery.ONCOURSE,
        ifoodArrivedAtOriginSynced: false,
        ifoodDispatchSynced: false,
        motoboy: { id: 'm2', name: 'Maria', phone: '11988888888' },
      },
      {},
      { status: StatusDelivery.COLLECTED },
    );

    expect(ifoodOrdersService.notifyArrivedAtOrigin).toHaveBeenCalledWith(
      'ifood-2',
      'merchant-2',
    );
    expect(ifoodOrdersService.assignDriver).toHaveBeenCalled();
    expect(ifoodOrdersService.notifyGoingToOrigin).toHaveBeenCalled();
    expect(ifoodOrdersService.dispatchLogisticsOrder).toHaveBeenCalledWith(
      'ifood-2',
      'merchant-2',
    );
    expect(ifoodOrdersService.dispatchOrder).not.toHaveBeenCalled();
  });

  it('deve sincronizar chegada ao estabelecimento no status ARRIVED_AT_STORE sem despachar coleta', async () => {
    ifoodOrderLinkService.findByDeliveryId.mockResolvedValue({
      ifoodOrderId: 'ifood-8',
      merchantId: 'merchant-8',
    });

    await (service as any).syncIfoodIfNeeded(
      {
        id: 'delivery-8',
        status: StatusDelivery.ONCOURSE,
        ifoodArrivedAtOriginSynced: false,
        ifoodDispatchSynced: false,
      },
      {},
      { status: StatusDelivery.ARRIVED_AT_STORE },
    );

    expect(ifoodOrdersService.notifyArrivedAtOrigin).toHaveBeenCalledWith(
      'ifood-8',
      'merchant-8',
    );
    expect(ifoodOrdersService.dispatchLogisticsOrder).not.toHaveBeenCalled();
  });

  it('deve validar código de entrega quando houver DELIVERY_DROP_CODE_REQUESTED', async () => {
    ifoodOrderLinkService.findByDeliveryId.mockResolvedValue({
      ifoodOrderId: 'ifood-3',
      merchantId: 'merchant-3',
    });
    ifoodEventService.hasDeliveryDropCodeRequested.mockResolvedValue(true);

    await (service as any).syncIfoodIfNeeded(
      {
        id: 'delivery-3',
        status: StatusDelivery.AWAITING_CODE,
        ifoodArrivedAtDestinationSynced: true,
      },
      {},
      { status: StatusDelivery.FINISHED, deliveryCode: '1234' },
    );

    expect(ifoodOrdersService.notifyArrivedAtDestination).not.toHaveBeenCalled();
    expect(ifoodOrdersService.verifyDeliveryCode).toHaveBeenCalledWith(
      'ifood-3',
      '1234',
      'merchant-3',
    );
  });

  it('deve rejeitar finalização quando não houver evento DELIVERY_DROP_CODE_REQUESTED', async () => {
    ifoodOrderLinkService.findByDeliveryId.mockResolvedValue({
      ifoodOrderId: 'ifood-4',
      merchantId: 'merchant-4',
    });
    ifoodEventService.hasDeliveryDropCodeRequested.mockResolvedValue(false);

    await expect(
      (service as any).syncIfoodIfNeeded(
        {
          id: 'delivery-4',
          status: StatusDelivery.AWAITING_CODE,
          ifoodArrivedAtDestinationSynced: true,
        },
        {},
        { status: StatusDelivery.FINISHED, deliveryCode: '9999' },
      ),
    ).rejects.toThrow('DELIVERY_DROP_CODE_REQUESTED');
  });

  it('deve finalizar localmente quando iFood já estiver concluído', async () => {
    ifoodOrderLinkService.findByDeliveryId.mockResolvedValue({
      ifoodOrderId: 'ifood-5',
      merchantId: 'merchant-5',
    });
    ifoodEventService.hasDeliveryDropCodeRequested.mockResolvedValue(true);
    ifoodOrdersService.verifyDeliveryCode.mockRejectedValue(
      new Error('already delivered'),
    );
    ifoodOrdersService.getOrderDetails.mockResolvedValue({
      orderStatus: 'CONCLUDED',
    });

    await expect(
      (service as any).syncIfoodIfNeeded(
        {
          id: 'delivery-5',
          status: StatusDelivery.AWAITING_CODE,
          ifoodArrivedAtDestinationSynced: true,
          establishment: { usesExternalIfoodPdv: true, name: 'Loja Teste' },
        },
        {},
        { status: StatusDelivery.FINISHED, deliveryCode: '6013' },
      ),
    ).resolves.toEqual({});
  });


  it('deve finalizar localmente sem DELIVERY_DROP_CODE_REQUESTED quando iFood já estiver concluído', async () => {
    ifoodOrderLinkService.findByDeliveryId.mockResolvedValue({
      ifoodOrderId: 'ifood-7',
      merchantId: 'merchant-7',
    });
    ifoodEventService.hasDeliveryDropCodeRequested.mockResolvedValue(false);
    ifoodOrdersService.getOrderDetails.mockResolvedValue({
      orderStatus: 'CONCLUDED',
    });

    await expect(
      (service as any).syncIfoodIfNeeded(
        {
          id: 'delivery-7',
          status: StatusDelivery.AWAITING_CODE,
          ifoodArrivedAtDestinationSynced: true,
        },
        {},
        { status: StatusDelivery.FINISHED, deliveryCode: '6013' },
      ),
    ).resolves.toEqual({});

    expect(ifoodOrdersService.verifyDeliveryCode).not.toHaveBeenCalledWith(
      'ifood-7',
      '6013',
      'merchant-7',
    );
  });

  it('deve ser idempotente ao receber finalização de delivery já finalizado', async () => {
    ifoodOrderLinkService.findByDeliveryId.mockResolvedValue({
      ifoodOrderId: 'ifood-6',
      merchantId: 'merchant-6',
    });

    await expect(
      (service as any).syncIfoodIfNeeded(
        {
          id: 'delivery-6',
          status: StatusDelivery.FINISHED,
          ifoodArrivedAtDestinationSynced: true,
        },
        {},
        { status: StatusDelivery.FINISHED, deliveryCode: '6013' },
      ),
    ).resolves.toEqual({});

    expect(ifoodOrdersService.verifyDeliveryCode).not.toHaveBeenCalledWith(
      'ifood-6',
      '6013',
      'merchant-6',
    );
  });
});
