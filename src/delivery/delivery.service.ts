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
  ReleaseDeliveryDto,
} from './dto';
import { UserRequest } from '../shared/interfaces';
import { StatusDelivery, UserType } from '../shared/constants/enums.constants';
import { IfoodOrderLinkService } from '../ifood/ifood-order-link.service';
import { IfoodOrdersService } from '../ifood/ifood-orders.service';
import { IfoodCreditsService } from '../ifood/ifood-credits.service';
import { IfoodEventService } from '../ifood/ifood-event.service';
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
    @Inject(forwardRef(() => IfoodCreditsService))
    private readonly ifoodCreditsService: IfoodCreditsService,
    @Inject(forwardRef(() => IfoodEventService))
    private readonly ifoodEventService: IfoodEventService,
  ) {}

  private async syncIfoodOnCourseIfNeeded(
    previousDelivery: DeliveryEntity,
    nextDelivery: DeliveryEntity,
  ) {
    return this.syncIfoodIfNeeded(previousDelivery, nextDelivery, {
      status: StatusDelivery.ONCOURSE,
    } as UpdateDeliveryDto);
  }

  private async ensureIfoodOnCourseSynced(
    previousDelivery: DeliveryEntity,
    nextDelivery: DeliveryEntity,
    orderId: string,
    merchantId: string,
  ): Promise<
    Partial<
      Record<
        | 'ifoodAssignDriverSynced'
        | 'ifoodGoingToOriginSynced'
        | 'ifoodArrivedAtOriginSynced'
        | 'ifoodDispatchSynced',
        boolean
      >
    >
  > {
    const flags: Partial<
      Record<
        | 'ifoodAssignDriverSynced'
        | 'ifoodGoingToOriginSynced'
        | 'ifoodArrivedAtOriginSynced'
        | 'ifoodDispatchSynced',
        boolean
      >
    > = {};

    const motoboy = nextDelivery?.motoboy || previousDelivery?.motoboy;

    if (!motoboy) {
      this.logger.warn(
        `Não foi possível sincronizar ACAMINHO sem motoboy. DeliveryId: ${previousDelivery?.id}.`,
      );
      return flags;
    }

    if (!previousDelivery.ifoodAssignDriverSynced) {
      await this.ifoodOrdersService.assignDriver(orderId, motoboy, merchantId);
      flags.ifoodAssignDriverSynced = true;

      this.logger.log(
        `assignDriver enviado ao iFood quando motoboy aceitou entrega. OrderId: ${orderId}. MerchantId: ${merchantId}.`,
      );
    }

    if (!previousDelivery.ifoodGoingToOriginSynced) {
      await this.ifoodOrdersService.notifyGoingToOrigin(orderId, merchantId);
      flags.ifoodGoingToOriginSynced = true;

      this.logger.log(
        `goingToOrigin enviado ao iFood quando pedido ficou ACAMINHO. OrderId: ${orderId}. MerchantId: ${merchantId}.`,
      );
    }

    return flags;
  }

  private async syncIfoodIfNeeded(
    previousDelivery: DeliveryEntity,
    nextDelivery: DeliveryEntity,
    deliveryData: UpdateDeliveryDto,
  ): Promise<
    Partial<
      Record<
        | 'ifoodAssignDriverSynced'
        | 'ifoodGoingToOriginSynced'
        | 'ifoodArrivedAtOriginSynced'
        | 'ifoodDispatchSynced'
        | 'ifoodArrivedAtDestinationSynced',
        boolean
      >
    >
  > {
    const nextStatus = deliveryData.status || nextDelivery?.status;

    if (!nextStatus) {
      return {};
    }

    if (
      previousDelivery.status === nextStatus &&
      ![
        StatusDelivery.ONCOURSE,
        StatusDelivery.ARRIVED_AT_STORE,
        StatusDelivery.COLLECTED,
        StatusDelivery.ARRIVED_AT_DESTINATION,
        StatusDelivery.AWAITING_CODE,
      ].includes(nextStatus)
    ) {
      return {};
    }

    const ifoodLink = await this.ifoodOrderLinkService.findByDeliveryId(
      previousDelivery.id,
    );

    if (!ifoodLink) {
      return {};
    }

    this.logger.log(
      `Pedido iFood identificado para sincronização. DeliveryId: ${previousDelivery.id}.`,
    );

    const orderId = String(ifoodLink.ifoodOrderId || '').trim();
    const merchantId = String(ifoodLink.merchantId || '').trim();

    if (!orderId || !merchantId) {
      this.logger.warn(
        `Delivery ${previousDelivery.id} é iFood, mas sem orderId/merchantId válidos. Sincronização ignorada.`,
      );
      return {};
    }

    try {
      if (nextStatus === StatusDelivery.ONCOURSE) {
        return await this.ensureIfoodOnCourseSynced(
          previousDelivery,
          nextDelivery,
          orderId,
          merchantId,
        );
      }

      if (nextStatus === StatusDelivery.ARRIVED_AT_STORE) {
        const flags = await this.ensureIfoodOnCourseSynced(
          previousDelivery,
          nextDelivery,
          orderId,
          merchantId,
        );

        if (!previousDelivery.ifoodArrivedAtOriginSynced) {
          await this.ifoodOrdersService.notifyArrivedAtOrigin(
            orderId,
            merchantId,
          );
          flags.ifoodArrivedAtOriginSynced = true;
          this.logger.log(
            `arrivedAtOrigin enviado para iFood. OrderId: ${orderId}. MerchantId: ${merchantId}.`,
          );
        }

        return flags;
      }

      if (nextStatus === StatusDelivery.COLLECTED) {
        const flags = await this.ensureIfoodOnCourseSynced(
          previousDelivery,
          nextDelivery,
          orderId,
          merchantId,
        );

        if (!previousDelivery.ifoodDispatchSynced) {
          await this.ifoodOrdersService.dispatchLogisticsOrder(
            orderId,
            merchantId,
          );
          flags.ifoodDispatchSynced = true;
          this.logger.log(
            `dispatch enviado para iFood. OrderId: ${orderId}. MerchantId: ${merchantId}.`,
          );
        }

        return flags;
      }

      if (
        nextStatus === StatusDelivery.ARRIVED_AT_DESTINATION ||
        nextStatus === StatusDelivery.AWAITING_CODE
      ) {
        if (!previousDelivery.ifoodArrivedAtDestinationSynced) {
          await this.ifoodOrdersService.notifyArrivedAtDestination(
            orderId,
            merchantId,
          );
          this.logger.log(
            `arrivedAtDestination enviado para iFood. OrderId: ${orderId}. MerchantId: ${merchantId}.`,
          );
        }
        return { ifoodArrivedAtDestinationSynced: true };
      }

      if (nextStatus === StatusDelivery.CANCELED) {
        try {
          const cancellationResult =
            await this.ifoodOrdersService.requestCancellation(
              orderId,
              'Cancelado no Rappidex pela alteração do status da entrega.',
              merchantId,
            );
          this.logger.warn(
            `Solicitação de cancelamento enviada ao iFood por mudança de status. DeliveryId: ${previousDelivery.id}. OrderId: ${orderId}. Accepted: ${cancellationResult?.accepted === true}. Resultado: ${JSON.stringify(cancellationResult)}`,
          );

          if (cancellationResult?.accepted !== true) {
            this.logger.warn(
              `iFood não aceitou a solicitação de cancelamento para delivery ${previousDelivery.id}. Divergência evitada: pedido local cancelado, aguardando evento CANCELLED. Motivo: ${cancellationResult?.message || 'não informado'}`,
            );
          }
        } catch (error: any) {
          this.logger.warn(
            `Falha ao solicitar cancelamento no iFood para delivery ${previousDelivery.id}. Divergência potencial: pedido local cancelado sem confirmação externa. status=${error?.response?.status || error?.status || 'N/A'} message=${error?.response?.data?.message || error?.message || error}`,
          );
        }

        return {};
      }

      if (nextStatus === StatusDelivery.FINISHED) {
        if (previousDelivery.status === StatusDelivery.FINISHED) {
          this.logger.log(
            `Finalização idempotente no Rappidex. DeliveryId: ${previousDelivery.id}. IfoodOrderId: ${orderId}.`,
          );
          return {};
        }

        if (
          !previousDelivery.ifoodArrivedAtDestinationSynced &&
          previousDelivery.status !== StatusDelivery.ARRIVED_AT_DESTINATION &&
          previousDelivery.status !== StatusDelivery.AWAITING_CODE
        ) {
          throw new BadRequestException(
            'Antes de finalizar, informe a chegada no destino para sincronizar o iFood.',
          );
        }

        const isOrderAlreadyCanceled = await this.isIfoodOrderCanceled(
          orderId,
          merchantId,
        );

        if (isOrderAlreadyCanceled) {
          throw new BadRequestException(
            'Este pedido foi cancelado no iFood e não pode ser finalizado no Rappidex. Cancele a entrega localmente.',
          );
        }

        const hasDeliveryDropCodeRequested =
          await this.ifoodEventService.hasDeliveryDropCodeRequested(orderId);

        const usesExternalIfoodPdv = Boolean(
          previousDelivery?.establishment?.usesExternalIfoodPdv,
        );

        if (!hasDeliveryDropCodeRequested) {
          const ifoodConclusionStatus = await this.getIfoodConclusionStatus(
            orderId,
            merchantId,
          );

          if (ifoodConclusionStatus.isConcluded) {
            this.logger.warn(
              `ifood_sync action=finalizado_localmente_sem_drop_code loja="${previousDelivery?.establishment?.name || ''}" merchantId="${merchantId || ''}" usesExternalIfoodPdv=${usesExternalIfoodPdv} ifoodOrderId="${orderId}" displayId="${previousDelivery?.id || ''}" ifoodStatus="${ifoodConclusionStatus.status}" localStatusBefore="${previousDelivery.status}" localStatusAfter="${StatusDelivery.FINISHED}"`,
            );
            return {};
          }

          throw new BadRequestException(
            'O pedido ainda não está elegível para validação do código no iFood (DELIVERY_DROP_CODE_REQUESTED).',
          );
        }

        if (!deliveryData.deliveryCode) {
          throw new BadRequestException(
            'Informe o código de entrega do iFood para finalizar este pedido.',
          );
        }

        this.logger.log(
          `verifyDeliveryCode enviado para iFood. OrderId: ${orderId}. MerchantId: ${merchantId}.`,
        );

        let verifyResult: any;
        try {
          verifyResult = await this.ifoodOrdersService.verifyDeliveryCode(
            orderId,
            deliveryData.deliveryCode,
            merchantId,
          );
        } catch (error: any) {
          const usesExternalIfoodPdv = Boolean(
            previousDelivery?.establishment?.usesExternalIfoodPdv,
          );
          const ifoodConclusionStatus = await this.getIfoodConclusionStatus(
            orderId,
            merchantId,
          );

          if (ifoodConclusionStatus.isConcluded) {
            this.logger.warn(
              `ifood_sync action=finalizado_localmente loja="${previousDelivery?.establishment?.name || ''}" merchantId="${merchantId || ''}" usesExternalIfoodPdv=${usesExternalIfoodPdv} ifoodOrderId="${orderId}" displayId="${previousDelivery?.id || ''}" ifoodStatus="${ifoodConclusionStatus.status}" localStatusBefore="${previousDelivery.status}" localStatusAfter="${StatusDelivery.FINISHED}"`,
            );
            return {};
          }

          throw error;
        }

        if (verifyResult?.success === false) {
          throw new BadRequestException('Código de entrega inválido.');
        }
      }

      return {};
    } catch (error: any) {
      this.logger.error(
        `Falha ao sincronizar delivery ${previousDelivery.id} com o iFood. status=${error?.response?.status || error?.status || 'N/A'} message=${error?.response?.data?.message || error?.message || error}`,
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

  private async isIfoodOrderCanceled(
    orderId: string,
    merchantId?: string | null,
  ) {
    try {
      const orderDetails = await this.ifoodOrdersService.getOrderDetails(
        orderId,
        merchantId,
      );

      const orderStatus = String(
        orderDetails?.orderStatus ||
          orderDetails?.status ||
          orderDetails?.metadata?.status ||
          '',
      ).toUpperCase();

      return orderStatus.includes('CANCEL');
    } catch (error: any) {
      this.logger.warn(
        `Não foi possível verificar o status do pedido iFood ${orderId} antes da finalização local. ${error?.message || error}`,
      );
      return false;
    }
  }

  private async getIfoodConclusionStatus(
    orderId: string,
    merchantId?: string | null,
  ) {
    try {
      const orderDetails = await this.ifoodOrdersService.getOrderDetails(
        orderId,
        merchantId,
      );
      const orderStatus = String(
        orderDetails?.orderStatus ||
          orderDetails?.status ||
          orderDetails?.metadata?.status ||
          '',
      )
        .trim()
        .toUpperCase();

      const isConcluded = [
        'CONCLUDED',
        'COMPLETED',
        'DELIVERED',
        'FINALIZED',
        'ENTREGUE',
        'CONCLUID',
      ].some((statusToken) => orderStatus.includes(statusToken));

      return { status: orderStatus || 'UNKNOWN', isConcluded };
    } catch (error: any) {
      this.logger.warn(
        `Não foi possível consultar o status final do pedido iFood ${orderId}. ${error?.message || error}`,
      );
      return { status: 'UNKNOWN', isConcluded: false };
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
    void status;
    return false;
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

  private async refundCreditForCanceledDelivery(
    delivery: DeliveryEntity,
    reason: string,
    ifoodOrderId?: string,
  ) {
    const establishmentId = delivery?.establishment?.id;
    if (!establishmentId) {
      return;
    }

    await this.ifoodCreditsService.refundCreditForOrder(
      establishmentId,
      ifoodOrderId || delivery.id,
      reason,
    );
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
    this.logger.log(
      `delivery_list userId=${userForRequest.id} userType=${userForRequest.type} userCityId=${userForRequest.cityId} filters=${JSON.stringify(
        queryParams,
      )} where=${JSON.stringify(where)}`,
    );

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

    const ifoodLinks = await this.ifoodOrderLinkService.findByDeliveryIds(
      deliveries.map((delivery) => delivery.id),
    );
    const ifoodLinkByDeliveryId = new Map(
      ifoodLinks.map((link) => [link.deliveryId, link]),
    );
    const deliveriesWithSource = deliveries.map((delivery) => {
      const ifoodLink = ifoodLinkByDeliveryId.get(delivery.id);

      return {
        ...delivery,
        isIfoodOrder: Boolean(ifoodLink),
        ifoodOrderId: ifoodLink?.ifoodOrderId ?? null,
        ifoodDisplayId: ifoodLink?.ifoodDisplayId ?? null,
        ifoodMerchantId: ifoodLink?.merchantId ?? null,
      };
    });

    return ListDeliverysResult.fromEntities(
      deliveriesWithSource as any,
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

    const assignedWhere = this.buildAssignedDeliveriesWhere(userForRequest);

    const waitingReleaseWhere = this.buildDeliveriesWhere(userForRequest, {
      status: StatusDelivery.AWAITING_RELEASE,
    } as ListDeliveriesQueryDTO);
    const [pending, assigned, waitingRelease] = await Promise.all([
      this.deliveryRepository.count(pendingWhere),
      this.deliveryRepository.count(assignedWhere),
      this.deliveryRepository.count(waitingReleaseWhere),
    ]);

    return {
      pending,
      assigned,
      waitingRelease,
    };
  }

  private buildAssignedDeliveriesWhere(userForRequest: UserEntity) {
    const where: Record<string, any> = {
      isActive: true,
      motoboy: { $ne: null },
      status: {
        $nin: [StatusDelivery.FINISHED, StatusDelivery.CANCELED],
      },
    };

    if (userForRequest.type !== UserType.SUPERADMIN) {
      where['establishment.cityId'] = userForRequest.cityId;
    } else if (userForRequest.cityId) {
      where['establishment.cityId'] = userForRequest.cityId;
    }

    if (userForRequest.type === UserType.MOTOBOY) {
      where['motoboy.id'] = userForRequest.id;
    }

    if (
      userForRequest.type === UserType.SHOPKEEPER ||
      userForRequest.type === UserType.SHOPKEEPERADMIN
    ) {
      where['establishment.id'] = userForRequest.id;
    }

    return where;
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
    const normalizedMotoboyId = this.normalizeMotoboyId(deliveryData.motoboyId);

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

      if (normalizedMotoboyId) {
        motoboyFinded = await this.findOneUserById(normalizedMotoboyId);
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
        !normalizedMotoboyId
      ) {
        throw new BadRequestException(
          'É necessario que você selecione a opção de motoboy.',
        );
      }

      if (normalizedMotoboyId) {
        const where = {};
        where['motoboy.id'] = userFinded.id;
        where['isActive'] = true;
        where['status'] = {
          $in: [
            StatusDelivery.PENDING,
            StatusDelivery.ONCOURSE,
            StatusDelivery.ARRIVED_AT_STORE,
            StatusDelivery.COLLECTED,
            StatusDelivery.ARRIVED_AT_DESTINATION,
            StatusDelivery.AWAITING_CODE,
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

    if (normalizedMotoboyId && !deliveryData.status) {
      const canAutoAssignStatus =
        deliveryFinded.status === StatusDelivery.PENDING;

      if (canAutoAssignStatus) {
        changedDelivery.status = StatusDelivery.ONCOURSE;
        changedDelivery['onCoursedAt'] = addHours(new Date(), -3);
      }
    }

    if (deliveryData.status === StatusDelivery.ARRIVED_AT_DESTINATION) {
      const ifoodLink = await this.ifoodOrderLinkService.findByDeliveryId(
        deliveryFinded.id,
      );

      if (ifoodLink?.ifoodOrderId) {
        const canRequestCode =
          await this.ifoodEventService.hasDeliveryDropCodeRequested(
            ifoodLink.ifoodOrderId,
          );

        if (canRequestCode) {
          changedDelivery.status = StatusDelivery.AWAITING_CODE;
          deliveryData.status = StatusDelivery.AWAITING_CODE;
        }
      }
    }

    if (deliveryData.status) {
      const dateForUse = addHours(new Date(), -3);
      if (deliveryData.status === StatusDelivery.ONCOURSE) {
        changedDelivery['onCoursedAt'] = dateForUse;
      } else if (deliveryData.status === StatusDelivery.ARRIVED_AT_STORE) {
        changedDelivery['arrivedAtStoreAt'] = dateForUse;
      } else if (deliveryData.status === StatusDelivery.COLLECTED) {
        changedDelivery['collectedAt'] = dateForUse;
      } else if (
        deliveryData.status === StatusDelivery.ARRIVED_AT_DESTINATION ||
        deliveryData.status === StatusDelivery.AWAITING_CODE
      ) {
        changedDelivery['arrivedAtDestinationAt'] = dateForUse;
      } else if (deliveryData.status === StatusDelivery.FINISHED) {
        changedDelivery['finishedAt'] = dateForUse;
      }
    }

    if (this.isObservationOnlyUpdate(deliveryData)) {
      const deliveryUpdated = await this.deliveryRepository.save(
        this.buildPersistableDelivery({
          ...changedDelivery,
          updatedAt: addHours(new Date(), -3),
        }),
      );

      this.ordersGateway.emitDeliveryUpdated(
        DeliveryResult.fromEntity(deliveryUpdated),
        deliveryUpdated.establishment?.cityId ??
          deliveryFinded.establishment?.cityId,
      );

      return DeliveryResult.fromEntity(deliveryUpdated);
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

      let ifoodSyncFlags = {};

      try {
        ifoodSyncFlags =
          deliveryUpdated.status === StatusDelivery.ONCOURSE
            ? await this.syncIfoodOnCourseIfNeeded(
                deliveryFinded,
                deliveryUpdated,
              )
            : await this.syncIfoodIfNeeded(
                deliveryFinded,
                deliveryUpdated,
                deliveryData,
              );
      } catch (error: any) {
        this.logger.error(
          `Claim atômico concluído para delivery ${deliveryFinded.id}, mas falhou sincronização iFood no fluxo PENDENTE -> ACAMINHO. Iniciando rollback condicional para PENDENTE.`,
          error?.stack || error,
        );

        await this.rollbackPendingClaimAfterIfoodSyncFailure(
          deliveryFinded.id,
          motoboyFinded.id,
        );

        throw new InternalServerErrorException(
          'Não foi possível sincronizar com o iFood. Tente aceitar novamente.',
        );
      }

      await this.saveIfoodSyncFlags(deliveryUpdated.id, ifoodSyncFlags);
      deliveryUpdated = {
        ...deliveryUpdated,
        ...ifoodSyncFlags,
      } as DeliveryEntity;
    } else {
      const deliveryForSync = {
        ...changedDelivery,
        motoboy: motoboyFinded || changedDelivery['motoboy'],
        establishment: establishmentFinded || changedDelivery['establishment'],
      };

      const shouldSyncInBackground = this.shouldSyncIfoodInBackground(
        deliveryData.status,
      );

      let ifoodSyncFlags = {};

      if (!shouldSyncInBackground) {
        ifoodSyncFlags =
          (deliveryForSync as DeliveryEntity).status === StatusDelivery.ONCOURSE
            ? await this.syncIfoodOnCourseIfNeeded(
                deliveryFinded,
                deliveryForSync as DeliveryEntity,
              )
            : await this.syncIfoodIfNeeded(
                deliveryFinded,
                deliveryForSync as DeliveryEntity,
                deliveryData,
              );
      }

      try {
        deliveryUpdated = await this.deliveryRepository.save(
          this.buildPersistableDelivery({
            ...changedDelivery,
            ...ifoodSyncFlags,
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

    if (
      deliveryData.status === StatusDelivery.CANCELED &&
      deliveryFinded.status !== StatusDelivery.CANCELED
    ) {
      const ifoodLink = await this.ifoodOrderLinkService.findByDeliveryId(
        deliveryFinded.id,
      );

      await this.refundCreditForCanceledDelivery(
        deliveryFinded,
        'Crédito estornado por cancelamento da entrega.',
        ifoodLink?.ifoodOrderId,
      );
    }

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

  private normalizeMotoboyId(motoboyId?: string | null) {
    if (motoboyId === undefined || motoboyId === null) {
      return null;
    }

    const normalized = String(motoboyId).trim();
    return normalized.length ? normalized : null;
  }

  private isObservationOnlyUpdate(data: UpdateDeliveryDto) {
    const allowedKeys = new Set([
      'destinationObservation',
      'destinationObservationConfirmed',
      'updatedAt',
    ]);

    const payloadKeys = Object.keys(data || {}).filter(
      (key) => (data as any)[key] !== undefined,
    );

    return payloadKeys.length > 0 && payloadKeys.every((key) => allowedKeys.has(key));
  }

  async createDelivery(
    deliveryData: CreateDeliveryDto,
    user: UserRequest,
    options?: { skipCreditConsumption?: boolean; creditOrderId?: string },
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
      clientLocation,
      clientAddress,
      addressComplement,
      addressReference,
      addressNeighborhood,
      addressCity,
      addressState,
      addressZipCode,
      addressLatitude,
      addressLongitude,
      addressMapsUrl,
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

    if (!establishment?.cityId) {
      throw new BadRequestException(
        'Estabelecimento sem cidade configurada. Verifique cityId/cityName.',
      );
    }

    const normalizedMotoboyId = this.normalizeMotoboyId(deliveryData.motoboyId);

    if (
      (userFinded.type === UserType.ADMIN ||
        userFinded.type === UserType.SUPERADMIN ||
        userFinded.type === UserType.SHOPKEEPERADMIN) &&
      normalizedMotoboyId
    ) {
      motoboy = await this.findOneUserById(normalizedMotoboyId);
      this.ensureCityAccess(userFinded, motoboy.cityId);
      deliveryStatus = StatusDelivery.ONCOURSE;
      onCoursedAt = addHours(new Date(), -3);
    }

    try {
      const deliveryId = uuid();

      if (!options?.skipCreditConsumption) {
        await this.ifoodCreditsService.consumeCreditForOrder(
          establishment.id,
          options?.creditOrderId || deliveryId,
        );
      }

      const newDelivery = await this.deliveryRepository.save({
        id: deliveryId,
        clientName,
        clientPhone,
        status: deliveryStatus,
        establishment,
        motoboy,
        value,
        payment,
        soda,
        observation,
        clientLocation,
        clientAddress,
        addressComplement,
        addressReference,
        addressNeighborhood,
        addressCity,
        addressState,
        addressZipCode,
        addressLatitude,
        addressLongitude,
        addressMapsUrl,
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
      this.logger.log(
        `delivery_created id=${newDelivery.id} status=${newDelivery.status} cityId=${newDelivery.establishment?.cityId} cityName=${newDelivery.establishment?.cityName ?? ''} createdBy=${newDelivery.createdBy}`,
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

  async cleanupStaleIfoodDeliveries(
    user: UserRequest,
    companyIdFromAdmin?: string,
  ) {
    const userFinded = await this.userRepository.findOneBy({ id: user.id });

    if (!userFinded) {
      throw new UnauthorizedException('Usuário não encontrado.');
    }

    const companyId =
      userFinded.type === UserType.ADMIN
        ? String(companyIdFromAdmin || '').trim() || null
        : userFinded.id;

    if (!companyId) {
      throw new BadRequestException(
        'Informe o companyId para limpeza em usuário admin.',
      );
    }

    const links =
      await this.ifoodOrderLinkService.findByShopkeeperId(companyId);

    if (links.length === 0) {
      return {
        checked: 0,
        removed: 0,
        message: 'Nenhum pedido iFood vinculado encontrado.',
      };
    }

    const deliveryIds = links.map((link) => link.deliveryId).filter(Boolean);
    const deliveries = await this.deliveryRepository.find({
      where: {
        id: { $in: deliveryIds } as any,
        isActive: true,
        status: {
          $in: [StatusDelivery.PENDING, StatusDelivery.ONCOURSE],
        } as any,
      } as any,
      relations: { establishment: true },
    });

    let removed = 0;

    for (const delivery of deliveries) {
      const link = links.find((item) => item.deliveryId === delivery.id);
      const orderId = String(link?.ifoodOrderId || '').trim();
      const merchantId = String(link?.merchantId || '').trim();

      if (!orderId) continue;

      let shouldRemove = false;

      try {
        const order = await this.ifoodOrdersService.getOrderDetails(
          orderId,
          merchantId || undefined,
        );
        const status = String(
          order?.orderStatus || order?.status || order?.metadata?.status || '',
        )
          .trim()
          .toUpperCase();
        shouldRemove = status === 'CONCLUDED' || status === 'CANCELLED';
      } catch (error: any) {
        const status = Number(error?.response?.status || error?.status || 0);
        shouldRemove = status === 404 || status === 410;
      }

      if (!shouldRemove) continue;

      await this.deliveryRepository.save({
        ...delivery,
        status: StatusDelivery.CANCELED,
        isActive: false,
        updatedAt: addHours(new Date(), -3),
      });

      this.ordersGateway.emitDeliveryDeleted(
        delivery.id,
        delivery.establishment?.cityId,
      );
      removed += 1;
    }

    return {
      checked: deliveries.length,
      removed,
      criteria:
        'Somente pedidos iFood em PENDENTE/ACAMINHO no Rappidex e CONCLUDED/CANCELLED no iFood.',
    };
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
      const cancellationResult =
        await this.ifoodOrdersService.requestCancellation(
          ifoodLink.ifoodOrderId,
          'Cancelado no Rappidex pela exclusão da entrega.',
          ifoodLink.merchantId,
        );

      this.logger.warn(
        `Solicitação de cancelamento enviada ao iFood por DELETE /delivery/:id. DeliveryId: ${deliveryFinded.id}. OrderId: ${ifoodLink.ifoodOrderId}. Accepted: ${cancellationResult?.accepted === true}. Resultado: ${JSON.stringify(cancellationResult)}`,
      );

      if (cancellationResult?.accepted !== true) {
        throw new BadRequestException(
          `Cancelamento não aceito pelo iFood: ${cancellationResult?.message || 'não foi possível confirmar a solicitação'}. A entrega não foi cancelada localmente para evitar divergência.`,
        );
      }
    }

    try {
      await this.deliveryRepository.save({
        ...deliveryFinded,
        status: StatusDelivery.CANCELED,
        isActive: false,
        updatedAt: addHours(new Date(), -3),
      });

      await this.refundCreditForCanceledDelivery(
        deliveryFinded,
        'Crédito estornado por exclusão da entrega.',
        ifoodLink?.ifoodOrderId,
      );

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

    const ifoodCancellationCode = event?.fullCode || event?.code || 'CANCELLED';
    const ifoodCancellationNote = `Cancelamento iFood: ${ifoodCancellationCode} | OrderId: ${orderId}`;
    const nextObservation = deliveryFinded.observation
      ? `${deliveryFinded.observation} | ${ifoodCancellationNote}`
      : ifoodCancellationNote;

    await this.deliveryRepository.save({
      ...deliveryFinded,
      status: StatusDelivery.CANCELED,
      isActive: false,
      observation: nextObservation,
      updatedAt: addHours(new Date(), -3),
    });

    await this.refundCreditForCanceledDelivery(
      deliveryFinded,
      'Crédito estornado por cancelamento recebido do iFood.',
      orderId,
    );

    this.ordersGateway.emitDeliveryDeleted(
      deliveryFinded.id,
      deliveryFinded.establishment?.cityId,
    );

    this.logger.warn(
      `Entrega ${deliveryFinded.id} cancelada no Rappidex por evento ${event?.fullCode || event?.code || 'CANCELLED'} do iFood. OrderId: ${orderId}`,
    );
  }

  async handleIfoodCancellationRequestFailed(orderId: string, event?: any) {
    const ifoodLink =
      await this.ifoodOrderLinkService.findByIfoodOrderId(orderId);
    if (!ifoodLink) return;

    const delivery = await this.deliveryRepository.findOne({
      where: { id: ifoodLink.deliveryId, isActive: true } as any,
      relations: { establishment: true },
    });
    if (!delivery) return;

    const ifoodFailureCode =
      event?.fullCode || event?.code || 'CANCELLATION_REQUEST_FAILED';
    const failureNote = `Falha de cancelamento iFood: ${ifoodFailureCode} | OrderId: ${orderId}`;
    const nextObservation = delivery.observation
      ? `${delivery.observation} | ${failureNote}`
      : failureNote;

    await this.deliveryRepository.save(
      this.buildPersistableDelivery({
        ...delivery,
        ifoodStatus: ifoodFailureCode,
        externalStatus: ifoodFailureCode,
        logisticsStatus: ifoodFailureCode,
        observation: nextObservation,
        updatedAt: addHours(new Date(), -3),
      }),
    );

    this.logger.error(
      `iFood recusou/falhou o cancelamento. DeliveryId: ${delivery.id}. OrderId: ${orderId}. Event: ${ifoodFailureCode}. A entrega foi mantida para rastreabilidade.`,
    );
  }

  async finishDeliveryFromIfood(orderId: string, event?: any) {
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

    if (deliveryFinded.status === StatusDelivery.FINISHED) {
      return;
    }

    const deliveryUpdated = await this.deliveryRepository.save({
      ...deliveryFinded,
      status: StatusDelivery.FINISHED,
      finishedAt: addHours(new Date(), -3),
      updatedAt: addHours(new Date(), -3),
    });

    this.ordersGateway.emitDeliveryUpdated(
      DeliveryResult.fromEntity(deliveryUpdated),
      deliveryUpdated.establishment?.cityId,
    );

    this.logger.log(
      `Entrega ${deliveryFinded.id} finalizada no Rappidex por evento ${event?.fullCode || event?.code || 'CONCLUDED'} do iFood. OrderId: ${orderId}`,
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

  async markArrivedAtStore(deliveryId: string, user: UserRequest) {
    return this.updateDelivery(
      deliveryId,
      { status: StatusDelivery.ARRIVED_AT_STORE },
      user,
    );
  }

  async releaseDelivery(
    deliveryId: string,
    user: UserRequest,
    data?: ReleaseDeliveryDto,
  ) {
    const userFinded = await this.findOneUserById(user.id);
    if (
      ![
        UserType.ADMIN,
        UserType.SUPERADMIN,
        UserType.SHOPKEEPER,
        UserType.SHOPKEEPERADMIN,
      ].includes(userFinded.type as any)
    ) {
      throw new UnauthorizedException(
        'Você não tem permissão para liberar pedido.',
      );
    }
    const delivery = await this.deliveryRepository.findOneByOrFail({
      id: deliveryId,
    });
    if (delivery.status !== StatusDelivery.AWAITING_RELEASE) {
      throw new BadRequestException('Entrega não está aguardando liberação.');
    }

    this.ensureCityAccess(
      userFinded,
      delivery.establishment?.cityId ?? userFinded.cityId,
    );

    const motoboyIdFromBody = this.normalizeMotoboyId(data?.motoboyId);
    const motoboyIdAlreadySaved = this.normalizeMotoboyId(
      delivery?.motoboy?.id,
    );
    const finalMotoboyId = motoboyIdFromBody || motoboyIdAlreadySaved;

    let motoboy = null;
    let nextStatus = StatusDelivery.PENDING;
    let onCoursedAt = delivery.onCoursedAt ?? null;

    if (finalMotoboyId) {
      motoboy = await this.findOneUserById(finalMotoboyId);

      if (motoboy.type !== UserType.MOTOBOY) {
        throw new BadRequestException('Usuário selecionado não é motoboy.');
      }
      this.ensureCityAccess(userFinded, motoboy.cityId);

      nextStatus = StatusDelivery.ONCOURSE;
      onCoursedAt = delivery.onCoursedAt ?? addHours(new Date(), -3);
    }

    const updated = await this.deliveryRepository.save(
      this.buildPersistableDelivery({
        ...delivery,
        status: nextStatus,
        motoboy,
        onCoursedAt,
        releasedAt: addHours(new Date(), -3),
        releasedBy: userFinded.id,
        updatedAt: addHours(new Date(), -3),
      }),
    );

    const ifoodLink = await this.ifoodOrderLinkService.findByDeliveryId(
      delivery.id,
    );
    if (ifoodLink && nextStatus === StatusDelivery.ONCOURSE && motoboy) {
      try {
        const syncFlags = await this.syncIfoodOnCourseIfNeeded(
          delivery,
          updated,
        );

        if (Object.keys(syncFlags).length > 0) {
          await this.saveIfoodSyncFlags(updated.id, syncFlags);
          Object.assign(updated, syncFlags);
        }
      } catch (error: any) {
        this.logger.error(
          `Falha ao sincronizar ACAMINHO no iFood durante liberação da entrega ${delivery.id}. Verifique assignDriver/goingToOrigin. status=${error?.response?.status || error?.status || 'N/A'} message=${error?.response?.data?.message || error?.message || error}`,
          error?.stack || error,
        );
        throw error;
      }
    }

    this.ordersGateway.emitDeliveryUpdated(
      DeliveryResult.fromEntity(updated),
      updated.establishment?.cityId,
    );
    return DeliveryResult.fromEntity(updated);
  }

  async updateExternalIfoodStatus(orderId: string, event?: any) {
    const ifoodLink =
      await this.ifoodOrderLinkService.findByIfoodOrderId(orderId);
    if (!ifoodLink) return;

    const delivery = await this.deliveryRepository.findOne({
      where: { id: ifoodLink.deliveryId, isActive: true } as any,
    });
    if (!delivery) return;

    const externalCode = String(
      event?.fullCode || event?.code || event?.metadata?.status || '',
    ).trim();
    if (!externalCode) return;

    const updated = await this.deliveryRepository.save(
      this.buildPersistableDelivery({
        ...delivery,
        ifoodStatus: externalCode,
        externalStatus: externalCode,
        logisticsStatus: externalCode,
        updatedAt: addHours(new Date(), -3),
      }),
    );

    this.ordersGateway.emitDeliveryUpdated(
      DeliveryResult.fromEntity(updated),
      updated.establishment?.cityId,
    );
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
      !!this.normalizeMotoboyId(deliveryData.motoboyId)
    );
  }

  private buildPersistableDelivery(data: Record<string, any>) {
    return {
      internalId: data.internalId,
      id: data.id,
      clientName: data.clientName,
      clientPhone: data.clientPhone,
      clientLocation: data.clientLocation ?? null,
      clientAddress: data.clientAddress ?? null,
      addressComplement: data.addressComplement ?? null,
      addressReference: data.addressReference ?? null,
      addressNeighborhood: data.addressNeighborhood ?? null,
      addressCity: data.addressCity ?? null,
      addressState: data.addressState ?? null,
      addressZipCode: data.addressZipCode ?? null,
      addressLatitude: data.addressLatitude ?? null,
      addressLongitude: data.addressLongitude ?? null,
      addressMapsUrl: data.addressMapsUrl ?? null,
      status: data.status,
      establishment: data.establishment ?? null,
      motoboy: data.motoboy ?? null,
      value: data.value,
      observation: data.observation,
      destinationObservation: data.destinationObservation ?? null,
      destinationObservationConfirmed:
        data.destinationObservationConfirmed ?? false,
      soda: data.soda,
      payment: data.payment,
      isActive: data.isActive,
      createdAt: data.createdAt ?? null,
      createdBy: data.createdBy ?? null,
      updatedAt: data.updatedAt ?? null,
      onCoursedAt: data.onCoursedAt ?? null,
      collectedAt: data.collectedAt ?? null,
      arrivedAtStoreAt: data.arrivedAtStoreAt ?? null,
      arrivedAtDestinationAt: data.arrivedAtDestinationAt ?? null,
      ifoodStatus: data.ifoodStatus ?? null,
      externalStatus: data.externalStatus ?? null,
      logisticsStatus: data.logisticsStatus ?? null,
      ifoodImportedAt: data.ifoodImportedAt ?? null,
      ifoodLastEventCode: data.ifoodLastEventCode ?? null,
      ifoodLastEventFullCode: data.ifoodLastEventFullCode ?? null,
      ifoodConfirmedAt: data.ifoodConfirmedAt ?? null,
      releasedAt: data.releasedAt ?? null,
      releasedBy: data.releasedBy ?? null,
      finishedAt: data.finishedAt ?? null,
      ifoodAssignDriverSynced: data.ifoodAssignDriverSynced ?? false,
      ifoodGoingToOriginSynced: data.ifoodGoingToOriginSynced ?? false,
      ifoodArrivedAtOriginSynced: data.ifoodArrivedAtOriginSynced ?? false,
      ifoodDispatchSynced: data.ifoodDispatchSynced ?? false,
      ifoodArrivedAtDestinationSynced:
        data.ifoodArrivedAtDestinationSynced ?? false,
    };
  }

  private async saveIfoodSyncFlags(
    deliveryId: string,
    flags: Partial<Record<string, boolean>>,
  ) {
    const keysToPersist = Object.keys(flags).filter((key) => flags[key]);

    if (!keysToPersist.length) {
      return;
    }

    const updatePayload = keysToPersist.reduce(
      (acc, key) => {
        acc[key] = true;
        return acc;
      },
      { updatedAt: addHours(new Date(), -3) } as Record<string, any>,
    );

    await this.deliveryRepository.updateOne(
      { id: deliveryId } as any,
      { $set: updatePayload } as any,
    );
  }

  private async rollbackPendingClaimAfterIfoodSyncFailure(
    deliveryId: string,
    motoboyId: string,
  ) {
    const rollbackAt = addHours(new Date(), -3);

    const rollbackResult = await this.deliveryRepository.updateOne(
      {
        id: deliveryId,
        isActive: true,
        status: StatusDelivery.ONCOURSE,
        'motoboy.id': motoboyId,
      } as any,
      {
        $set: {
          status: StatusDelivery.PENDING,
          motoboy: null,
          onCoursedAt: null,
          ifoodAssignDriverSynced: false,
          ifoodGoingToOriginSynced: false,
          updatedAt: rollbackAt,
        },
      } as any,
    );

    if (rollbackResult?.modifiedCount) {
      this.logger.warn(
        `Rollback aplicado para delivery ${deliveryId} após falha de sincronização iFood no fluxo PENDENTE -> ACAMINHO. Entrega retornada para PENDENTE e motoboy removido.`,
      );
      return;
    }

    this.logger.warn(
      `Rollback não aplicado para delivery ${deliveryId} após falha de sincronização iFood, pois a entrega não estava mais em ACAMINHO com o mesmo motoboy.`,
    );
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
    const selectedStatuses = queryParams.status
      ? queryParams.status.split(',')
      : [];
    const includeCanceled = selectedStatuses.includes(StatusDelivery.CANCELED);
    const where: Record<string, any> = {
      isActive: includeCanceled ? { $in: [true, false] } : true,
    };

    if (userForRequest.type !== UserType.SUPERADMIN) {
      where['establishment.cityId'] = userForRequest.cityId;
    } else if (userForRequest.cityId) {
      where['establishment.cityId'] = userForRequest.cityId;
    }

    if (
      userForRequest.type === UserType.ADMIN ||
      userForRequest.type === UserType.SUPERADMIN
    ) {
      if (selectedStatuses.length) where['status'] = { $in: selectedStatuses };
      if (queryParams.establishmentId)
        where['establishment.id'] = queryParams.establishmentId;
      if (queryParams.motoboyId) where['motoboy.id'] = queryParams.motoboyId;
      if (queryParams.createdBy) where['createdBy'] = queryParams.createdBy;
    }

    if (userForRequest.type === UserType.MOTOBOY) {
      if (selectedStatuses.length) {
        where['status'] = {
          $in: selectedStatuses.filter(
            (status) => status !== StatusDelivery.AWAITING_RELEASE,
          ),
        };

        // Se tiver um momento em que for necessario que o motoboy solicite todos os pedidos, ele vai conseguir ver tudo
        if (!selectedStatuses.includes(StatusDelivery.PENDING)) {
          where['motoboy.id'] = userForRequest.id;
        }
      } else {
        where['motoboy.id'] = userForRequest.id;
        where['status'] = { $ne: StatusDelivery.AWAITING_RELEASE };
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
      if (selectedStatuses.length) where['status'] = { $in: selectedStatuses };
      if (queryParams.motoboyId) where['motoboy.id'] = queryParams.motoboyId;
    }

    // if (queryParams.hasOwnProperty('isActive')) {
    //   where['isActive'] = queryParams.isActive ? true : false;
    // }

    if (queryParams.createdIn && queryParams.createdUntil) {
      const createdAtDateFilter = {
        $gte: new Date(queryParams.createdIn),
        $lte: new Date(queryParams.createdUntil),
      };
      const createdAtStringFilter = {
        $gte: queryParams.createdIn,
        $lte: queryParams.createdUntil,
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
