import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { DeliveryEntity, LogEntity, UserEntity } from '../database/entities';
import { InjectRepository } from '@nestjs/typeorm';
import { MongoRepository } from 'typeorm';
import { v4 as uuid } from 'uuid';
import { addHours } from 'date-fns';

import {
  ConfigsDto,
  CreateDeliveryDto,
  DeliveryResult,
  ListDeliveriesQueryDTO,
  ListDeliverysResult,
  UpdateDeliveryDto,
} from './dto';
import { UserRequest } from '../shared/interfaces';
import { StatusDelivery, UserType } from '../shared/constants/enums.constants';
import { IfoodOrderLinkService } from '../ifood/ifood-order-link.service';
import { IfoodOrdersService } from '../ifood/ifood-orders.service';
import { sendNotificationsFor } from 'src/shared/utils/notification.functions';
import { OrdersGateway } from '../gateway/orders.gateway';

@Injectable()
export class DeliveryService implements OnModuleInit {
  private readonly logger = new Logger(DeliveryService.name);
  motoboysDeliveriesAmount = 2;
  blockDeliverys = false;
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: MongoRepository<UserEntity>,
    @InjectRepository(DeliveryEntity)
    private readonly deliveryRepository: MongoRepository<DeliveryEntity>,
    @InjectRepository(LogEntity)
    private readonly logRepository: MongoRepository<LogEntity>,
    private readonly ordersGateway: OrdersGateway,
    @Inject(forwardRef(() => IfoodOrdersService))
    private readonly ifoodOrdersService: IfoodOrdersService,
    @Inject(forwardRef(() => IfoodOrderLinkService))
    private readonly ifoodOrderLinkService: IfoodOrderLinkService,
  ) {}

  private async syncIfoodIfNeeded(
    previousDelivery: DeliveryEntity,
    nextDelivery: DeliveryEntity,
    deliveryData: UpdateDeliveryDto,
  ) {
    if (!deliveryData.status) {
      return;
    }

    if (previousDelivery.status === deliveryData.status) {
      return;
    }

    const ifoodLink = await this.ifoodOrderLinkService.findByDeliveryId(
      previousDelivery.id,
    );

    if (!ifoodLink) {
      return;
    }

    const orderId = ifoodLink.ifoodOrderId;

    try {
      if (deliveryData.status === StatusDelivery.ONCOURSE) {
        const motoboy = nextDelivery?.motoboy;

        if (!motoboy) {
          throw new BadRequestException(
            'Motoboy não encontrado para sincronizar a saída ao iFood.',
          );
        }

        await this.ifoodOrdersService.assignDriver(orderId, motoboy);
        await this.ifoodOrdersService.notifyGoingToOrigin(orderId);
        return;
      }

      if (deliveryData.status === StatusDelivery.COLLECTED) {
        await this.ifoodOrdersService.notifyArrivedAtOrigin(orderId);
        await this.ifoodOrdersService.dispatchLogisticsOrder(orderId);
        await this.ifoodOrdersService.dispatchOrder(orderId);
        return;
      }

      if (deliveryData.status === StatusDelivery.CANCELED) {
        await this.ifoodOrdersService.requestCancellation(
          orderId,
          'Cancelado no Rappidex pela alteração do status da entrega.',
        );
        return;
      }

      if (deliveryData.status === StatusDelivery.FINISHED) {
        await this.ifoodOrdersService.notifyArrivedAtDestination(orderId);

        if (!deliveryData.deliveryCode) {
          throw new BadRequestException(
            'Informe o código de entrega do iFood para finalizar este pedido.',
          );
        }

        const verifyResult = await this.ifoodOrdersService.verifyDeliveryCode(
          orderId,
          deliveryData.deliveryCode,
        );

        if (verifyResult?.success === false) {
          throw new BadRequestException(
            'O código de entrega do iFood é inválido.',
          );
        }
      }
    } catch (error: any) {
      this.logger.error(
        `Falha ao sincronizar delivery ${previousDelivery.id} com o iFood.`,
        error?.stack || error,
      );

      if (
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Não foi possível sincronizar o status da entrega com o iFood.',
      );
    }
  }

  async onModuleInit() {
    await this.ensureDeliveryIndexes();
  }

  private async ensureDeliveryIndexes() {
    try {
      await Promise.all([
        this.deliveryRepository.createCollectionIndex(
          { isActive: 1, 'establishment.cityId': 1, createdAt: -1 },
          { name: 'IDX_DELIVERIES_ACTIVE_CITY_CREATED_AT' },
        ),
        this.deliveryRepository.createCollectionIndex(
          { isActive: 1, status: 1, 'establishment.cityId': 1, createdAt: -1 },
          { name: 'IDX_DELIVERIES_ACTIVE_STATUS_CITY_CREATED_AT' },
        ),
        this.deliveryRepository.createCollectionIndex(
          { isActive: 1, 'motoboy.id': 1, status: 1, createdAt: -1 },
          { name: 'IDX_DELIVERIES_ACTIVE_MOTOBOY_STATUS_CREATED_AT' },
        ),
      ]);
    } catch (error: any) {
      this.logger.warn(
        `Não foi possível garantir índices de performance de delivery. ${error?.message || error}`,
      );
    }
  }

  private shouldSyncIfoodInBackground(status?: StatusDelivery) {
    return (
      status === StatusDelivery.ONCOURSE || status === StatusDelivery.COLLECTED
    );
  }

  private syncIfoodInBackground(
    previousDelivery: DeliveryEntity,
    nextDelivery: DeliveryEntity,
    deliveryData: UpdateDeliveryDto,
  ) {
    void this.syncIfoodIfNeeded(
      previousDelivery,
      nextDelivery,
      deliveryData,
    ).catch((error: any) => {
      this.logger.error(
        `Falha assíncrona ao sincronizar delivery ${previousDelivery.id} com iFood.`,
        error?.stack || error,
      );
    });
  }

  private sendStatusNotificationInBackground(
    subscriptionId: string,
    message: string,
  ) {
    void sendNotificationsFor([subscriptionId], message).catch((error: any) => {
      this.logger.warn(
        `Falha assíncrona ao enviar notificação de status da entrega. ${error?.message || error}`,
      );
    });
  }

  private notifyNewDeliveryInBackground(
    newDelivery: DeliveryEntity,
    deliveryStatus: StatusDelivery,
    establishment: UserEntity,
    motoboy: UserEntity | null,
    userFinded: UserEntity,
  ) {
    const newLog = {
      id: uuid(),
      where: 'Criação de um delivery',
      type: 'Log para notificações',
      error: 'Sem error',
      user: userFinded,
      status: 'Notificação enviada.',
    };

    const notifyPromise =
      deliveryStatus !== StatusDelivery.ONCOURSE
        ? this.sendNotificationsToRelevantUsers(
            newDelivery.establishment.name,
            newDelivery.establishment.cityId,
          )
        : this.sendAssignedMotoboyNotification(establishment, motoboy);

    void notifyPromise.catch(async (error) => {
      newLog.error = `${error}`;
      newLog.status = 'Notificação não enviada devido ao error';

      try {
        await this.logRepository.save(newLog);
      } catch (logError: any) {
        this.logger.warn(
          `Falha ao salvar log de erro de notificação: ${logError?.message || logError}`,
        );
      }
    });
  }

  private async sendAssignedMotoboyNotification(
    establishment: UserEntity,
    motoboy: UserEntity | null,
  ) {
    const subscriptionId = motoboy?.notification?.subscriptionId;

    if (!subscriptionId) {
      return;
    }

    await sendNotificationsFor(
      [subscriptionId],
      `Você foi atribuido a uma entrega no estabelecimento: ${establishment.name}`,
    );
  }

  async listDeliveries(
    user: UserRequest,
    queryParams: ListDeliveriesQueryDTO,
  ): Promise<ListDeliverysResult> {
    const userForRequest = await this.findOneUserById(user.id);

    const skip = (queryParams.page - 1) * queryParams.itemsPerPage;
    const take = queryParams.itemsPerPage;
    const where = this.buildDeliveriesWhere(userForRequest, queryParams);

    const shouldIncludeDashboardCounts = this.parseBooleanQuery(
      queryParams.includeDashboardCounts,
    );

    const [deliveries, count, dashboardCounts] = await Promise.all([
      this.deliveryRepository.find({
        relations: { motoboy: true, establishment: true },
        where,
        skip,
        take,
        order: { createdAt: 'ASC' },
      }),
      this.deliveryRepository.count(where),
      shouldIncludeDashboardCounts
        ? this.getDashboardCountsByUser(userForRequest)
        : Promise.resolve(undefined),
    ]);

    return ListDeliverysResult.fromEntities(
      deliveries,
      deliveries.length,
      queryParams.page,
      count,
      dashboardCounts,
    );
  }

  async getDashboardCounts(user: UserRequest) {
    const userForRequest = await this.findOneUserById(user.id);

    return this.getDashboardCountsByUser(userForRequest);
  }

  private async getDashboardCountsByUser(userForRequest: UserEntity) {
    const pendingWhere = this.buildDeliveriesWhere(userForRequest, {
      status: StatusDelivery.PENDING,
    } as ListDeliveriesQueryDTO);

    const assignedWhere = this.buildDeliveriesWhere(userForRequest, {
      status: `${StatusDelivery.ONCOURSE},${StatusDelivery.COLLECTED}`,
    } as ListDeliveriesQueryDTO);

    const [pending, assigned] = await Promise.all([
      this.deliveryRepository.count(pendingWhere),
      this.deliveryRepository.count(assignedWhere),
    ]);

    return {
      pending,
      assigned,
    };
  }

  private parseBooleanQuery(value?: boolean | string) {
    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value !== 'string') {
      return false;
    }

    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1';
  }

  async updateDelivery(
    deliveryId: string,
    deliveryData: UpdateDeliveryDto,
    user: UserRequest,
  ) {
    const [userFinded, deliveryFinded] = await Promise.all([
      this.findOneUserById(user.id),
      this.deliveryRepository.findOneByOrFail({
        id: deliveryId,
      }),
    ]);

    this.ensureCityAccess(
      userFinded,
      deliveryFinded.establishment?.cityId ?? userFinded.cityId,
    );

    let establishmentFinded;
    let motoboyFinded;

    let changedDelivery: Record<string, any> = {};

    if (
      userFinded.type === UserType.ADMIN ||
      userFinded.type === UserType.SUPERADMIN
    ) {
      changedDelivery = { ...deliveryFinded, ...deliveryData };

      if (deliveryData.establishmentId) {
        establishmentFinded = await this.findOneUserById(
          deliveryData.establishmentId,
        );
        this.ensureCityAccess(userFinded, establishmentFinded.cityId);
      }

      if (deliveryData.motoboyId) {
        motoboyFinded = await this.findOneUserById(deliveryData.motoboyId);
        this.ensureCityAccess(userFinded, motoboyFinded.cityId);
      }
    }

    if (userFinded.type === UserType.SHOPKEEPER) {
      changedDelivery = { ...deliveryFinded, ...deliveryData };
    }

    if (userFinded.type === UserType.MOTOBOY) {
      if (
        deliveryFinded.motoboy != null &&
        deliveryFinded.motoboy.id != userFinded.id
      ) {
        throw new BadRequestException(
          'Essa entrega já foi atribuída a outro entregador.',
        );
      }

      changedDelivery = { ...deliveryFinded, ...deliveryData };

      if (
        deliveryData.status === StatusDelivery.ONCOURSE &&
        !deliveryData.motoboyId
      ) {
        throw new BadRequestException(
          'É necessario que você selecione a opção de motoboy.',
        );
      }

      if (deliveryData.motoboyId) {
        const where = {};
        where['motoboy.id'] = userFinded.id;
        where['isActive'] = true;
        where['status'] = {
          $in: [
            StatusDelivery.PENDING,
            StatusDelivery.ONCOURSE,
            StatusDelivery.COLLECTED,
          ],
        };
        where['establishment.cityId'] = userFinded.cityId;

        const deliveriesForMotoboy = await this.deliveryRepository.count(where);

        if (deliveriesForMotoboy >= this.motoboysDeliveriesAmount) {
          throw new BadRequestException(
            `Você não pode pegar mais do que ${this.motoboysDeliveriesAmount} solicitações.`,
          );
        }
        motoboyFinded = userFinded;
      }
    }

    if (establishmentFinded) {
      changedDelivery = {
        ...changedDelivery,
        establishment: establishmentFinded,
      };
    }

    if (motoboyFinded) {
      changedDelivery = {
        ...changedDelivery,
        motoboy: motoboyFinded,
      };
    }

    if (deliveryData.status) {
      const dateForUse = addHours(new Date(), -3);
      if (deliveryData.status === StatusDelivery.ONCOURSE) {
        changedDelivery['onCoursedAt'] = dateForUse;
      } else if (deliveryData.status === StatusDelivery.COLLECTED) {
        changedDelivery['collectedAt'] = dateForUse;
      } else if (deliveryData.status === StatusDelivery.FINISHED) {
        changedDelivery['finishedAt'] = dateForUse;
      }
    }

    const isPendingClaimAttempt = this.isPendingClaimAttempt(
      deliveryFinded,
      deliveryData,
    );

    let deliveryUpdated: DeliveryEntity;

    if (isPendingClaimAttempt && motoboyFinded) {
      deliveryUpdated = await this.claimPendingDeliveryAtomically(
        deliveryFinded,
        changedDelivery,
        motoboyFinded,
      );
    } else {
      const deliveryForSync = {
        ...changedDelivery,
        motoboy: motoboyFinded || changedDelivery['motoboy'],
        establishment: establishmentFinded || changedDelivery['establishment'],
      };

      const shouldSyncInBackground = this.shouldSyncIfoodInBackground(
        deliveryData.status,
      );

      if (!shouldSyncInBackground) {
        await this.syncIfoodIfNeeded(
          deliveryFinded,
          deliveryForSync as DeliveryEntity,
          deliveryData,
        );
      }

      try {
        deliveryUpdated = await this.deliveryRepository.save(
          this.buildPersistableDelivery({
            ...changedDelivery,
            updatedAt: addHours(new Date(), -3),
          }),
        );
      } catch (error) {
        return error;
      }

      if (shouldSyncInBackground) {
        this.syncIfoodInBackground(
          deliveryFinded,
          deliveryUpdated,
          deliveryData,
        );
      }
    }

    this.ordersGateway.emitDeliveryUpdated(
      DeliveryResult.fromEntity(deliveryUpdated),
      deliveryUpdated.establishment?.cityId ??
        deliveryFinded.establishment?.cityId,
    );

    const subscriptionId =
      deliveryFinded.establishment?.notification?.subscriptionId;

    if (subscriptionId) {
      if (
        deliveryData.status &&
        deliveryData.status === StatusDelivery.ONCOURSE
      ) {
        const motoboyName =
          deliveryUpdated.motoboy?.name ||
          motoboyFinded?.name ||
          changedDelivery['motoboy']?.name ||
          deliveryFinded.motoboy?.name ||
          'o motoboy';

        this.sendStatusNotificationInBackground(
          subscriptionId,
          `O motoboy ${motoboyName} aceitou a entrega do pedido do(a) ${deliveryFinded.clientName} e está a caminho!`,
        );
      } else if (deliveryData.status) {
        this.sendStatusNotificationInBackground(
          subscriptionId,
          `Houve uma alteração no status da entrega do pedido do(a) ${deliveryFinded.clientName}`,
        );
      }
    }

    return DeliveryResult.fromEntity(deliveryUpdated);
  }

  async createDelivery(
    deliveryData: CreateDeliveryDto,
    user: UserRequest,
  ): Promise<DeliveryResult> {
    const userFinded = await this.findOneUserById(user.id);
    let establishment;
    let motoboy = null;
    let onCoursedAt = null;
    const {
      clientName,
      clientPhone,
      status,
      value,
      payment,
      soda,
      observation,
    } = deliveryData;

    let deliveryStatus = status;

    if (
      this.blockDeliverys &&
      user.type !== UserType.ADMIN &&
      user.type !== UserType.SUPERADMIN
    ) {
      throw new BadRequestException(
        'Infelizmente as entregas foram encerradas por hoje.',
      );
    }

    if (
      (userFinded.type === UserType.ADMIN ||
        userFinded.type === UserType.SUPERADMIN) &&
      deliveryData.establishmentId
    ) {
      establishment = await this.findOneUserById(deliveryData.establishmentId);
      this.ensureCityAccess(userFinded, establishment.cityId);
    } else {
      establishment = userFinded;
    }

    if (
      (userFinded.type === UserType.ADMIN ||
        userFinded.type === UserType.SUPERADMIN ||
        userFinded.type === UserType.SHOPKEEPERADMIN) &&
      deliveryData.motoboyId
    ) {
      motoboy = await this.findOneUserById(deliveryData.motoboyId);
      this.ensureCityAccess(userFinded, motoboy.cityId);
      deliveryStatus = StatusDelivery.ONCOURSE;
      onCoursedAt = addHours(new Date(), -3);
    }

    try {
      const newDelivery = await this.deliveryRepository.save({
        id: uuid(),
        clientName,
        clientPhone,
        status: deliveryStatus,
        establishment,
        motoboy,
        value,
        payment,
        soda,
        observation,
        isActive: true,
        createdBy: user.id,
        onCoursedAt,
        createdAt: addHours(new Date(), -3),
        updatedAt: addHours(new Date(), -3),
      });

      this.ordersGateway.emitDeliveryCreated(
        DeliveryResult.fromEntity(newDelivery),
        newDelivery.establishment?.cityId,
      );
      
      this.notifyNewDeliveryInBackground(
        newDelivery,
        deliveryStatus,
        establishment,
        motoboy,
        userFinded,
      );
      
      return DeliveryResult.fromEntity(newDelivery);
    } catch (error) {
      throw error;
    }
  }

  async deleteDelivery(deliveryId: string, user: UserRequest) {
    const deliveryFinded = await this.deliveryRepository.findOne({
      where: {
        id: deliveryId,
        isActive: true,
      },
      relations: { establishment: true },
    });

    if (!deliveryFinded) {
      throw new BadRequestException('Entrega não encontrada.');
    }

    const userFinded = await this.userRepository.findOneBy({
      id: user.id,
    });

    if (
      (userFinded.type === UserType.SHOPKEEPER ||
        userFinded.type === UserType.SHOPKEEPERADMIN) &&
      deliveryFinded.establishment.id != userFinded.id
    ) {
      throw new BadRequestException('Você não é o dono dessa entrega.');
    }

    const ifoodLink = await this.ifoodOrderLinkService.findByDeliveryId(
      deliveryFinded.id,
    );

    if (ifoodLink) {
      await this.ifoodOrdersService.requestCancellation(
        ifoodLink.ifoodOrderId,
        'Cancelado no Rappidex pela exclusão da entrega.',
      );
    }

    try {
      await this.deliveryRepository.save({
        ...deliveryFinded,
        status: StatusDelivery.CANCELED,
        isActive: false,
        updatedAt: addHours(new Date(), -3),
      });

      this.ordersGateway.emitDeliveryDeleted(
        deliveryFinded.id,
        deliveryFinded.establishment?.cityId,
      );
    } catch (error) {
      return error;
    }

    return { status: 200, message: 'Entrega apagada com sucesso!' };
  }

  async cancelDeliveryFromIfood(orderId: string, event?: any) {
    const ifoodLink =
      await this.ifoodOrderLinkService.findByIfoodOrderId(orderId);

    if (!ifoodLink) {
      return;
    }

    const deliveryFinded = await this.deliveryRepository.findOne({
      where: {
        id: ifoodLink.deliveryId,
      },
      relations: { establishment: true },
    });

    if (!deliveryFinded || !deliveryFinded.isActive) {
      return;
    }

    await this.deliveryRepository.save({
      ...deliveryFinded,
      status: StatusDelivery.CANCELED,
      isActive: false,
      updatedAt: addHours(new Date(), -3),
    });

    this.ordersGateway.emitDeliveryDeleted(
      deliveryFinded.id,
      deliveryFinded.establishment?.cityId,
    );

    this.logger.warn(
      `Entrega ${deliveryFinded.id} cancelada no Rappidex por evento ${event?.fullCode || event?.code || 'CANCELLED'} do iFood. OrderId: ${orderId}`,
    );
  }

  async findOneUserById(userId: string) {
    const user = await this.userRepository.findOneBy({ id: userId });

    if (!user) {
      throw new BadRequestException('Usuário não encontrado.');
    }

    return user;
  }

  async findConfigs() {
    return {
      status: 200,
      amount: this.motoboysDeliveriesAmount,
      blockDeliverys: this.blockDeliverys,
    };
  }

  async changeConfigs(configs: ConfigsDto) {
    if (configs.amountDeliverys) {
      this.motoboysDeliveriesAmount = parseInt(configs.amountDeliverys);
    }

    if (configs.blockDeliverys) {
      this.blockDeliverys = !this.blockDeliverys;
    }

    return {
      status: 200,
      message: 'Configurações foram alterada com sucesso.',
    };
  }

  private isPendingClaimAttempt(
    delivery: DeliveryEntity,
    deliveryData: UpdateDeliveryDto,
  ) {
    return (
      delivery.status === StatusDelivery.PENDING &&
      deliveryData.status === StatusDelivery.ONCOURSE &&
      !!deliveryData.motoboyId
    );
  }

  private buildPersistableDelivery(data: Record<string, any>) {
    return {
      internalId: data.internalId,
      id: data.id,
      clientName: data.clientName,
      clientPhone: data.clientPhone,
      status: data.status,
      establishment: data.establishment ?? null,
      motoboy: data.motoboy ?? null,
      value: data.value,
      observation: data.observation,
      soda: data.soda,
      payment: data.payment,
      isActive: data.isActive,
      createdAt: data.createdAt ?? null,
      createdBy: data.createdBy ?? null,
      updatedAt: data.updatedAt ?? null,
      onCoursedAt: data.onCoursedAt ?? null,
      collectedAt: data.collectedAt ?? null,
      finishedAt: data.finishedAt ?? null,
    };
  }

  private async claimPendingDeliveryAtomically(
    deliveryFinded: DeliveryEntity,
    changedDelivery: Record<string, any>,
    motoboyFinded: UserEntity,
  ) {
    const dateForUse = addHours(new Date(), -3);

    const deliveryToPersist = this.buildPersistableDelivery({
      ...changedDelivery,
      status: StatusDelivery.ONCOURSE,
      motoboy: motoboyFinded,
      onCoursedAt: changedDelivery.onCoursedAt ?? dateForUse,
      updatedAt: dateForUse,
    });

    const claimResult = await this.deliveryRepository.updateOne(
      {
        id: deliveryFinded.id,
        isActive: true,
        status: StatusDelivery.PENDING,
        $or: [{ motoboy: null }, { motoboy: { $exists: false } }],
      } as any,
      {
        $set: deliveryToPersist,
      } as any,
    );

    if (!claimResult?.modifiedCount) {
      const currentDelivery = await this.deliveryRepository.findOne({
        where: {
          id: deliveryFinded.id,
        } as any,
        relations: {
          motoboy: true,
          establishment: true,
        },
      });

      if (
        currentDelivery?.motoboy?.id &&
        currentDelivery.motoboy.id !== motoboyFinded.id
      ) {
        throw new BadRequestException(
          'Essa entrega já foi atribuída a outro entregador.',
        );
      }

      throw new BadRequestException(
        'Essa entrega acabou de ser aceita por outro entregador. Atualize a lista.',
      );
    }

    const deliveryUpdated = await this.deliveryRepository.findOneByOrFail({
      id: deliveryFinded.id,
    });

    return deliveryUpdated;
  }

  private ensureCityAccess(user: UserEntity, resourceCityId: string) {
    if (user.type !== UserType.SUPERADMIN && user.cityId !== resourceCityId) {
      throw new UnauthorizedException(
        'Você não tem permissão para acessar recursos de outra cidade.',
      );
    }
  }

  private async sendNotificationsToRelevantUsers(
    establishmentName: string,
    cityId: string,
  ) {
    console.log('=== INÍCIO NOTIFICAÇÃO DE NOVO PEDIDO (MOTOBOYS/ADMINS) ===');
    console.log('Estabelecimento:', establishmentName);
    console.log('Cidade do pedido:', cityId);

    const where: Record<string, unknown> = {
      type: { $in: [UserType.MOTOBOY, UserType.ADMIN, UserType.SUPERADMIN] },
      isActive: true,
    };

    console.log('Filtro usado para buscar usuários notificados:', where);

    const usersToNotify = await this.userRepository.find({ where });

    console.log('Usuários encontrados para notificação:', usersToNotify.length);

    const usersNotificationsIds = usersToNotify
      .filter((userToNotify: UserEntity) => {
        if (userToNotify.type === UserType.SUPERADMIN) {
          return true;
        }

        return !!cityId && userToNotify.cityId === cityId;
      })
      .map((userToNotify: UserEntity) => {
        console.log('Usuário candidato à notificação:', {
          id: userToNotify.id,
          name: userToNotify.name,
          cityId: userToNotify.cityId,
          type: userToNotify.type,
          isActive: userToNotify.isActive,
          subscriptionId: userToNotify.notification?.subscriptionId ?? null,
        });

        if (
          userToNotify.notification &&
          userToNotify.notification.subscriptionId
        ) {
          return userToNotify.notification.subscriptionId;
        }

        return null;
      })
      .filter((i) => !!i);

    console.log('Subscription IDs encontrados:', usersNotificationsIds);

    await sendNotificationsFor(
      usersNotificationsIds,
      `Nova solicitação de entrega no estabelecimento: ${establishmentName}`,
    );

    console.log('=== FIM NOTIFICAÇÃO DE NOVO PEDIDO (MOTOBOYS/ADMINS) ===');
  }

  private buildDeliveriesWhere(
    userForRequest: UserEntity,
    queryParams: ListDeliveriesQueryDTO,
  ) {
    const where: Record<string, any> = { isActive: true };

    where['establishment.cityId'] = userForRequest.cityId;

    if (
      userForRequest.type === UserType.ADMIN ||
      userForRequest.type === UserType.SUPERADMIN
    ) {
      if (queryParams.status)
        where['status'] = { $in: queryParams.status.split(',') };
      if (queryParams.establishmentId)
        where['establishment.id'] = queryParams.establishmentId;
      if (queryParams.motoboyId) where['motoboy.id'] = queryParams.motoboyId;
      if (queryParams.createdBy) where['createdBy'] = queryParams.createdBy;
    }

    if (userForRequest.type === UserType.MOTOBOY) {
      if (queryParams.status) {
        const arrayOnStatus = queryParams.status.split(',');
        where['status'] = { $in: arrayOnStatus };

        // Se tiver um momento em que for necessario que o motoboy solicite todos os pedidos, ele vai conseguir ver tudo
        if (!arrayOnStatus.includes(StatusDelivery.PENDING)) {
          where['motoboy.id'] = userForRequest.id;
        }
      } else {
        where['motoboy.id'] = userForRequest.id;
      }

      if (queryParams.establishmentId)
        where['establishment.id'] = queryParams.establishmentId;
    }

    //Lojistaadmin pode ver o mesmo que o lojista normal, unica diferença é que eles podem atribuir uma entrega ao motoboy
    if (
      userForRequest.type === UserType.SHOPKEEPER ||
      userForRequest.type === UserType.SHOPKEEPERADMIN
    ) {
      where['establishment.id'] = userForRequest.id;
      if (queryParams.status)
        where['status'] = { $in: queryParams.status.split(',') };
      if (queryParams.motoboyId) where['motoboy.id'] = queryParams.motoboyId;
    }

    // if (queryParams.hasOwnProperty('isActive')) {
    //   where['isActive'] = queryParams.isActive ? true : false;
    // }

    if (queryParams.createdIn && queryParams.createdUntil) {
      const createdAtDateFilter = {
        $gte: new Date(queryParams.createdIn),
        $lt: new Date(queryParams.createdUntil),
      };
      const createdAtStringFilter = {
        $gte: queryParams.createdIn,
        $lt: queryParams.createdUntil,
      };

      // Garante compatibilidade: aceita registros Date (novos) e string (legados).
      where['$or'] = [
        { createdAt: createdAtDateFilter },
        { createdAt: createdAtStringFilter },
      ];
    }

    return where;
  }
}