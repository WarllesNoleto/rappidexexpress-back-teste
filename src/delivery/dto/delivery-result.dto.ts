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
  clientLocation?: string;


  @Expose()
  clientAddress?: string;

  @Expose()
  addressComplement?: string;

  @Expose()
  addressReference?: string;

  @Expose()
  addressNeighborhood?: string;

  @Expose()
  addressCity?: string;

  @Expose()
  addressState?: string;

  @Expose()
  addressZipCode?: string;

  @Expose()
  addressLatitude?: number;

  @Expose()
  addressLongitude?: number;

  @Expose()
  addressMapsUrl?: string;

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
  destinationObservation?: string;

  @Expose()
  destinationObservationConfirmed?: boolean;

  @Expose()
  payment: PaymentType;

  @Expose()
  onCoursedAt: Date;

  @Expose()
  collectedAt: Date;

  @Expose()
  arrivedAtStoreAt?: Date;

  @Expose()
  ifoodStatus?: string;

  @Expose()
  externalStatus?: string;

  @Expose()
  logisticsStatus?: string;

  @Expose()
  arrivedAtDestinationAt?: Date;

  @Expose()
  finishedAt: Date;

  @Expose()
  createdAt: Date;

  @Expose()
  createdBy: string;

  @Expose()
  isActive: boolean;

  @Expose()
  isIfoodOrder?: boolean;

  @Expose()
  ifoodOrderId?: string;

  @Expose()
  ifoodDisplayId?: string;

  @Expose()
  ifoodMerchantId?: string;
  @Expose()
  ifoodMerchantName?: string;

  public static fromEntity(delivery: DeliveryEntity) {
    return plainToClass<DeliveryResult, DeliveryResult>(
      DeliveryResult,
      {
        ...delivery,
        isIfoodOrder: (delivery as any).isIfoodOrder ?? false,
        ifoodOrderId: (delivery as any).ifoodOrderId ?? null,
        ifoodDisplayId: (delivery as any).ifoodDisplayId ?? null,
        ifoodMerchantId: (delivery as any).ifoodMerchantId ?? null,
        ifoodMerchantName: (delivery as any).ifoodMerchantName ?? null,
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
        arrivedAtStoreAt: (delivery as any).arrivedAtStoreAt,
        arrivedAtDestinationAt: (delivery as any).arrivedAtDestinationAt,
        ifoodStatus: (delivery as any).ifoodStatus,
        externalStatus: (delivery as any).externalStatus,
        logisticsStatus: (delivery as any).logisticsStatus,
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
