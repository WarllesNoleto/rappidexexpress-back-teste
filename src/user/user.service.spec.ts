import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IfoodImportService } from '../ifood/ifood-import.service';
import { UserService } from './user.service';
import {
  CityEntity,
  DeliveryEntity,
  LogEntity,
  UserEntity,
} from '../database/entities';

describe('UserService', () => {
  let service: UserService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
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
            find: jest.fn(),
            findOneBy: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(LogEntity),
          useValue: {
            save: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(CityEntity),
          useValue: {
            findOne: jest.fn(),
            findOneBy: jest.fn(),
            find: jest.fn(),
          },
        },
        {
          provide: IfoodImportService,
          useValue: {
            retryPendingImportsForCompany: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
