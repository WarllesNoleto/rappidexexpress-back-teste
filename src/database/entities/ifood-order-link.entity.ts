import { Column, Entity, Index, ObjectIdColumn } from 'typeorm';
import { ObjectId } from 'mongodb';

@Entity()
@Index(
  'IDX_IFOOD_ORDER_LINK_ORDER_MERCHANT_UNIQUE',
  ['ifoodOrderId', 'merchantId'],
  { unique: true },
)
export class IfoodOrderLinkEntity {
  @ObjectIdColumn()
  internalId: ObjectId;

  @Column()
  ifoodOrderId: string;

  @Column()
  ifoodDisplayId: string;

  @Column()
  merchantId: string;

  @Column({ nullable: true })
  merchantName?: string;

  @Column()
  deliveryId: string;

  @Column()
  shopkeeperId: string;

  @Column()
  createdAt: Date;
}
