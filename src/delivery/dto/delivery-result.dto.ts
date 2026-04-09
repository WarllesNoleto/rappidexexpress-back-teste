import { Expose, plainToClass } from 'class-transformer';
import {
  PaymentType,
  StatusDelivery,
} from '../../shared/constants/enums.constants';
import { DeliveryEntity } from '../../database/entities';

export class DeliveryResult {
  @Expose()
  id: string;

  @Expose()
  clientName: string;

  @Expose()
  clientPhone: string;

  @Expose()
  status: StatusDelivery;

  @Expose()
  establishmentId: string;

  @Expose()
  establishmentName: string;

  @Expose()
  establishmentPhone: string;

  @Expose()
  establishmentImage: string;

  @Expose()
  establishmentLocation: string;

  @Expose()
  establishmentPix: string;

  @Expose()
  establishmentCityId?: string;

  @Expose()
  motoboyId?: string;

  @Expose()
  motoboyName?: string;

  @Expose()
  motoboyPhone?: string;

  @Expose()
  value: string;

  @Expose()
  soda: string;

  @Expose()
  observation: string;

  @Expose()
  payment: PaymentType;

  @Expose()
  onCoursedAt: Date;

  @Expose()
  collectedAt: Date;

  @Expose()
  finishedAt: Date;

  @Expose()
  createdAt: Date;

  @Expose()
  createdBy: string;

  @Expose()
  isActive: boolean;

  public static fromEntity(delivery: DeliveryEntity) {
    return plainToClass<DeliveryResult, DeliveryResult>(
      DeliveryResult,
      {
        ...delivery,
        establishmentId: delivery.establishment
          ? delivery.establishment.id
          : null,
        establishmentName: delivery.establishment
          ? delivery.establishment.name
          : null,
        establishmentPhone: delivery.establishment
          ? delivery.establishment.phone
          : null,
        establishmentImage: delivery.establishment
          ? delivery.establishment.profileImage
          : null,
        establishmentLocation: delivery.establishment
          ? delivery.establishment.location
          : null,
        establishmentPix: delivery.establishment
          ? delivery.establishment.pix
          : null,
        establishmentCityId: delivery.establishment
          ? delivery.establishment.cityId
          : null,
        onCoursedAt: delivery.onCoursedAt,
        collectedAt: delivery.collectedAt,
        finishedAt: delivery.finishedAt,
        motoboyId: delivery.motoboy ? delivery.motoboy.id : null,
        motoboyName: delivery.motoboy ? delivery.motoboy.name : null,
        motoboyPhone: delivery.motoboy ? delivery.motoboy.phone : null,
      },
      {
        excludeExtraneousValues: true,
      },
    );
  }
}
