import { ObjectId } from 'mongodb';
import { Column, Entity, Index, ObjectIdColumn } from 'typeorm';
import {
  PaymentType,
  StatusDelivery,
} from '../../shared/constants/enums.constants';
import { UserEntity } from './user.entity';

@Entity()
@Index(['ifoodOrderId', 'ifoodMerchantId'], {
  unique: true,
  sparse: true,
})
export class DeliveryEntity {
  @ObjectIdColumn()
  internalId: ObjectId;

  @Column('uuid')
  @Index({ unique: true })
  id: string;

  @Column()
  clientName: string;

  @Column()
  clientPhone: string;

  @Column({ nullable: true })
  clientLocation?: string;

  @Column({ nullable: true })
  clientAddress?: string;

  @Column({ nullable: true })
  addressComplement?: string;

  @Column({ nullable: true })
  addressReference?: string;

  @Column({ nullable: true })
  addressNeighborhood?: string;

  @Column({ nullable: true })
  addressCity?: string;

  @Column({ nullable: true })
  addressState?: string;

  @Column({ nullable: true })
  addressZipCode?: string;

  @Column({ nullable: true })
  addressLatitude?: number;

  @Column({ nullable: true })
  addressLongitude?: number;

  @Column({ nullable: true })
  addressMapsUrl?: string;

  @Column({ type: 'enum', enum: StatusDelivery })
  status: StatusDelivery;

  @Column({ unique: false })
  establishment: UserEntity;

  @Column({ unique: false, nullable: true })
  motoboy: UserEntity;

  @Column()
  value: string;

  @Column()
  observation: string;

  @Column({ nullable: true })
  destinationObservation?: string;

  @Column({ default: false })
  destinationObservationConfirmed?: boolean;

  @Column()
  soda: string;

  @Column({ type: 'enum', enum: PaymentType })
  payment: PaymentType;

  @Column()
  isActive: boolean;

  @Column()
  createdAt: Date;

  @Column({ nullable: true })
  createdBy: string;

  @Column()
  updatedAt: Date;

  @Column()
  onCoursedAt: Date;

  @Column()
  collectedAt: Date;

  @Column({ nullable: true })
  arrivedAtStoreAt?: Date;

  @Column({ nullable: true })
  ifoodStatus?: string;

  @Column({ nullable: true })
  externalStatus?: string;

  @Column({ nullable: true })
  logisticsStatus?: string;

  @Column({ nullable: true })
  ifoodOrderId?: string;

  @Column({ nullable: true })
  ifoodDisplayId?: string;

  @Column({ nullable: true })
  ifoodMerchantId?: string;

  @Column({ nullable: true })
  ifoodMerchantName?: string;

  @Column({ nullable: true })
  ifoodImportedAt?: Date;
  @Column({ nullable: true })
  ifoodLastEventCode?: string;
  @Column({ nullable: true })
  ifoodLastEventFullCode?: string;
  @Column({ nullable: true })
  ifoodConfirmedAt?: Date;
  @Column({ nullable: true })
  releasedAt?: Date;
  @Column({ nullable: true })
  releasedBy?: string;

  @Column({ nullable: true })
  arrivedAtDestinationAt?: Date;

  @Column()
  finishedAt: Date;

  @Column({ default: false })
  ifoodAssignDriverSynced?: boolean;

  @Column({ default: false })
  ifoodGoingToOriginSynced?: boolean;

  @Column({ default: false })
  ifoodArrivedAtOriginSynced?: boolean;

  @Column({ default: false })
  ifoodDispatchSynced?: boolean;

  @Column({ default: false })
  ifoodArrivedAtDestinationSynced?: boolean;
}
