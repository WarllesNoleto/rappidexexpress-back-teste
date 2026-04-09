import { ObjectId } from 'mongodb';
import { Column, Entity, Index, ObjectIdColumn } from 'typeorm';
import {
  PaymentType,
  StatusDelivery,
} from '../../shared/constants/enums.constants';
import { UserEntity } from './user.entity';

@Entity()
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

  @Column()
  finishedAt: Date;
}
