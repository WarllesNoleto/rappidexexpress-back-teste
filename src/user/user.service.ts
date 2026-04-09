import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { MongoRepository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { InjectRepository } from '@nestjs/typeorm';
import { v4 as uuid } from 'uuid';
import { ObjectId } from 'mongodb';

import {
  CityEntity,
  DeliveryEntity,
  LogEntity,
  UserEntity,
} from '../database/entities';
import {
  CreateUserDto,
  ListUserQueryDTO,
  ListUsersResult,
  UpdateUserDto,
  UserResult,
} from './dto';
import { StatusDelivery, UserType } from '../shared/constants/enums.constants';
import { UserRequest } from '../shared/interfaces';
import { addHours } from 'date-fns';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: MongoRepository<UserEntity>,
    @InjectRepository(DeliveryEntity)
    private readonly deliveryRepository: MongoRepository<DeliveryEntity>,
    @InjectRepository(LogEntity)
    private readonly logRepository: MongoRepository<LogEntity>,
    @InjectRepository(CityEntity)
    private readonly cityRepository: MongoRepository<CityEntity>,
  ) {}

  async createUser(
    data: CreateUserDto,
    requestUser: UserRequest,
  ): Promise<UserResult> {
    const existsUserWithThisUsername = await this.userRepository.findOneBy({
      user: data.user,
    });

    if (existsUserWithThisUsername) {
      throw new BadRequestException('Já existe um usuário com esse user.');
    }

    const requester = await this.findUserOrFail(requestUser.id);

    const salt = await bcrypt.genSalt();
    const passHash = await bcrypt.hash(data.password, salt);

    const phone = data.phone
      .replace('(', '')
      .replace(')', '')
      .replace('-', '')
      .replace(' ', '');

    const city = await this.resolveCity(data.cityId, requester);

    try {
      const newUser = await this.userRepository.save({
        id: uuid(),
        ...data,
        cityId: city.id.toHexString(),
        phone,
        password: passHash,
        isActive: true,
        createdAt: addHours(new Date(), -3),
        updatedAt: addHours(new Date(), -3),
      });
      return UserResult.fromEntity(newUser);
    } catch (error) {
      return error;
    }
  }

  async listUsers(
    userId: string,
    queryParams: ListUserQueryDTO,
  ): Promise<ListUsersResult> {
    const userFinded = await this.findUserOrFail(userId);

    const order = {
      name: 'ASC',
    };

    const skip = (queryParams.page - 1) * queryParams.itemsPerPage;
    const take = queryParams.itemsPerPage;
    let where = {};
    where['isActive'] = true;

    if (userFinded.type !== UserType.SUPERADMIN) {
      where['cityId'] = userFinded.cityId;
    }
    let users = [];

    if (queryParams.isNotActive) {
      where['isActive'] = false;
    }

    if (queryParams.type) {
      if (userFinded.type === UserType.ADMIN || userFinded.type === UserType.SUPERADMIN) {
        if (queryParams.type === UserType.SHOPKEEPER) {
          where = {
            ...where,
            type: { $in: [UserType.SHOPKEEPER, UserType.SHOPKEEPERADMIN] },
          };
        } else {
          where = { ...where, type: queryParams.type };
        }
      } else if (userFinded.type === UserType.MOTOBOY) {
        if (queryParams.type === UserType.MOTOBOY) {
          return ListUsersResult.fromEntities([userFinded], 1, 1);
        } else {
          where = {
            ...where,
            type: { $in: [UserType.SHOPKEEPER, UserType.SHOPKEEPERADMIN] },
          };
        }
      } else if (
        //Se ele for um lojista ou um lojista admin, só pode ver ele mesmo como lojista
        userFinded.type === UserType.SHOPKEEPER ||
        userFinded.type === UserType.SHOPKEEPERADMIN
      ) {
        if (queryParams.type === UserType.SHOPKEEPER) {
          return ListUsersResult.fromEntities([userFinded], 1, 1);
        } else {
          where = {
            ...where,
            type: queryParams.type,
          };
        }
      }
    }

    try {
      users = await this.userRepository.find({ where, skip, take, order });
    } catch (error) {
      return error;
    }

    return ListUsersResult.fromEntities(users, users.length, queryParams.page);
  }

  async updateUser(
    data: UpdateUserDto,
    userId: string,
    requestUser: UserRequest,
  ) {
    const requester = await this.findUserOrFail(requestUser.id);
    const userToUpdate = await this.findUserOrFail(userId);

    this.ensureCityAccess(requester, userToUpdate.cityId);

    let cityId = userToUpdate.cityId;
    if (data.cityId) {
      const city = await this.resolveCity(data.cityId, requester);
      cityId = city.id.toHexString();
    }

    try {
      const changedUser = await this.userRepository.save({
        ...userToUpdate,
        ...data,
        cityId,
        updatedAt: addHours(new Date(), -3),
      });
      return UserResult.fromEntity(changedUser);
    } catch (error) {
      return error;
    }
  }

  private ensureCityAccess(requester: UserEntity, resourceCityId: string) {
    if (
      requester.type !== UserType.SUPERADMIN &&
      requester.cityId !== resourceCityId
    ) {
      throw new UnauthorizedException(
        'Você não tem permissão para acessar recursos de outra cidade.',
      );
    }
  }

  private async findUserOrFail(userId: string): Promise<UserEntity> {
    const user = await this.userRepository.findOneBy({ id: userId });

    if (!user) {
      throw new BadRequestException('Usuário não encontrado.');
    }

    return user;
  }

  private async resolveCity(
    id?: string,
    requestingUser?: UserEntity,
  ): Promise<CityEntity> {
    if (id) {
      const city = await this.cityRepository.findOne({
        where: { _id: new ObjectId(id) },
      });

      if (!city) {
        throw new BadRequestException('Cidade informada não encontrada.');
      }

      if (requestingUser) {
        this.ensureCityAccess(requestingUser, city.id.toHexString());
      }

      return city;
    }

    if (
      requestingUser &&
      requestingUser.type !== UserType.SUPERADMIN
    ) {
      if (!requestingUser.cityId) {
        throw new BadRequestException('Usuário não possui cidade cadastrada.');
      }

      const city = await this.cityRepository.findOne({
        where: { _id: new ObjectId(requestingUser.cityId) },
      });

      if (!city) {
        throw new BadRequestException('Cidade do usuário não encontrada.');
      }

      return city;
    }

    const [defaultCity] = await this.cityRepository.find({
      order: { name: 'ASC' },
      take: 1,
    });

    if (!defaultCity) {
      throw new BadRequestException('Nenhuma cidade cadastrada.');
    }

    return defaultCity;
  }

  async resetUserPassword(userId: string, requestUser: UserRequest) {
    const requester = await this.findUserOrFail(requestUser.id);
    const existsUserWithThisUsername = await this.userRepository.findOneBy({
      id: userId,
    });

    if (!existsUserWithThisUsername) {
      throw new BadRequestException('Não existe um usuário com esse user.');
    }

    this.ensureCityAccess(requester, existsUserWithThisUsername.cityId);

    const salt = await bcrypt.genSalt();
    const passHash = await bcrypt.hash('123456', salt);

    try {
      const changedUser = await this.userRepository.save({
        ...existsUserWithThisUsername,
        password: passHash,
        updatedAt: addHours(new Date(), -3),
      });
      return UserResult.fromEntity(changedUser);
    } catch (error) {
      return error;
    }
  }

  async getMyself(userId: string) {
    try {
      const myself = await this.userRepository.findOneBy({
        id: userId,
      });
      return UserResult.fromEntity(myself);
    } catch (error) {
      return error;
    }
  }

  async findUserByUsername(user: string, requestUser: UserRequest) {
    const requester = await this.findUserOrFail(requestUser.id);

    try {
      const userFinded = await this.userRepository.findOneBy({
        user,
      });

      if (!userFinded) {
        throw new BadRequestException('Usuário não encontrado.');
      }

      this.ensureCityAccess(requester, userFinded.cityId);
      return UserResult.fromEntity(userFinded);
    } catch (error) {
      return error;
    }
  }

  async findMotoboys(
    requestUser: UserRequest,
  ): Promise<Record<string, string>[]> {
    const requester = await this.findUserOrFail(requestUser.id);

    let where;
    const order = {
      name: 'ASC',
    };

    if (requester.type === UserType.MOTOBOY) {
      where = { id: requester.id };
    } else {
      where = {
        type: UserType.MOTOBOY,
      };
    }

    const requesterCityId = requester.cityId;

    if (requesterCityId) {
      where = {
        ...where,
        cityId: requesterCityId,
      };
    }
    try {
      const motoboys = await this.userRepository.find({
        where,
        order,
      });

      const scopedMotoboys =
        requester.type === UserType.SUPERADMIN
          ? motoboys
          : motoboys.filter(
              (motoboy) =>
                motoboy.cityId &&
                motoboy.cityId.toString() === requesterCityId?.toString(),
            );

      const motoboysWithDeliveriesCount = await Promise.all(
        scopedMotoboys.map(async (motoboy) => {
          const countWhere = {
            isActive: true,
            'motoboy.id': motoboy.id,
            status: {
              $in: [
                StatusDelivery.PENDING,
                StatusDelivery.ONCOURSE,
                StatusDelivery.COLLECTED,
              ],
            },
          };

          const lastDeliveryWhere = {
            'motoboy.id': motoboy.id,
            status: StatusDelivery.FINISHED,
          };
          if (requesterCityId) {
            countWhere['establishment.cityId'] = requesterCityId;
            lastDeliveryWhere['establishment.cityId'] = requesterCityId;
          }

          const countDeliveries = await this.deliveryRepository.count(
            countWhere,
          );

          const order = { finishedAt: 'DESC' };
          const take = 1;

          const lastDelivery = await this.deliveryRepository.find({
            where: lastDeliveryWhere,
            order,
            take,
          });

          return {
            name: `${motoboy.name} - ${countDeliveries}`,
            lastDeliveryDate: lastDelivery,
            id: motoboy.id,
          };
        }),
      );

      return await this.changeNameForMotoboy(motoboysWithDeliveriesCount);
    } catch (error) {
      return error;
    }
  }

  async changeNameForMotoboy(motoboysWithDeliveriesCount) {
    const newArrayForMotoboys = [];
    motoboysWithDeliveriesCount.map(async (motoboy) => {
      let hour = 'sem ultima entrega';
      if (motoboy.lastDeliveryDate[0]) {
        const dateArray = `${motoboy.lastDeliveryDate[0].finishedAt}`.split(
          ' ',
        );
        hour = `${dateArray[4].substring(0, 5)} horas`;
      }

      newArrayForMotoboys.push({
        name: `${motoboy.name} - ${hour}`,
        id: motoboy.id,
      });

      return {
        name: `${motoboy.name} - ${hour}`,
        id: motoboy.id,
      };
    });

    return newArrayForMotoboys;
  }

  async updateUserNotification(
    data: UpdateUserDto,
    user: string,
    requestUser: UserRequest,
  ) {
    const requester = await this.findUserOrFail(requestUser.id);
    const existsUserWithThisUsername = await this.userRepository.findOneBy({
      user,
    });

    if (!existsUserWithThisUsername) {
      throw new BadRequestException('Não existe um usuário com esse user.');
    }

    this.ensureCityAccess(requester, existsUserWithThisUsername.cityId);

    const newLog = {
      id: uuid(),
      where: 'Atualizar notificação',
      type: 'Log para atualizar notificação',
      error: JSON.stringify(data.notification),
      user: existsUserWithThisUsername,
      status: 'notificação do usuário atualizada',
    };

    try {
      const changedUser = await this.userRepository.save({
        ...existsUserWithThisUsername,
        notification: data.notification,
        updatedAt: addHours(new Date(), -3),
      });
      await this.logRepository.save(newLog);
      return UserResult.fromEntity(changedUser);
    } catch (error) {
      const newLogError = {
        id: uuid(),
        where: 'Atualizar notificação',
        type: 'Log para atualizar notificação',
        error: `${error}`,
        user: existsUserWithThisUsername,
        status: JSON.stringify(data.notification),
      };
      await this.logRepository.save(newLogError);
      return error;
    }
  }

  async deleteUser(id: string, requestUser: UserRequest) {
    const requester = await this.findUserOrFail(requestUser.id);
    const userToDelete = await this.findUserOrFail(id);

    this.ensureCityAccess(requester, userToDelete.cityId);

    try {
      await this.userRepository.deleteOne({ id });

      return { status: 200, message: 'Usuário apagado com sucesso.' };
    } catch (error) {
      throw new InternalServerErrorException(
        'Ocorreu um erro na base de dados.',
      );
    }
  }
}
