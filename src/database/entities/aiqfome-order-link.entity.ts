import { ObjectId } from 'mongodb';
import { Column, Entity, Index, ObjectIdColumn } from 'typeorm';

@Entity()
@Index(['aiqfomeOrderId', 'storeId'], { unique: true })
export class AiqfomeOrderLinkEntity {
  @ObjectIdColumn()
  internalId: ObjectId;

  @Column()
  aiqfomeOrderId: string;

  @Column({ nullable: true })
  aiqfomeDisplayId?: string;

  @Column()
  storeId: string;

  @Column({ nullable: true })
  storeName?: string;

  @Column()
  deliveryId: string;

  @Column()
  shopkeeperId: string;

  @Column({ default: false })
  pickupOngoingSynced: boolean;
  @Column({ default: false })
  arrivedAtMerchantSynced: boolean;
  @Column({ default: false })
  deliveryOngoingSynced: boolean;
  @Column({ default: false })
  arrivedAtCustomerSynced: boolean;
  @Column({ default: false })
  deliveredSynced: boolean;

  @Column()
  createdAt: Date;
}
