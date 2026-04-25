import { Test, TestingModule } from '@nestjs/testing';
import { UserController } from './user.controller';
import { UserService } from './user.service';

describe('UserController', () => {
  let controller: UserController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [
        {
          provide: UserService,
          useValue: {
            createUser: jest.fn(),
            listUsers: jest.fn(),
            updateUser: jest.fn(),
            getMyself: jest.fn(),
            findMotoboys: jest.fn(),
            findUserByUsername: jest.fn(),
            updateUserNotification: jest.fn(),
            resetUserPassword: jest.fn(),
            inactiveUser: jest.fn(),
            activeUser: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<UserController>(UserController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});