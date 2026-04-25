import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DeliveryService } from './delivery.service';
import { DeliveryEntity, LogEntity, UserEntity } from '../database/entities';
import { OrdersGateway } from '../gateway/orders.gateway';
import { IfoodOrdersService } from '../ifood/ifood-orders.service';
import { IfoodOrderLinkService } from '../ifood/ifood-order-link.service';
import { IfoodCreditsService } from '../ifood/ifood-credits.service';
import { IfoodEventService } from '../ifood/ifood-event.service';

describe('DeliveryService', () => {
  let service: DeliveryService;

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
            markReadyToPickup: jest.fn(),
            dispatchOrder: jest.fn(),
            completeOrder: jest.fn(),
            cancelOrder: jest.fn(),
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
            save: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<DeliveryService>(DeliveryService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});