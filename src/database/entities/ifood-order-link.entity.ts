import { Column, Entity, Index, ObjectIdColumn } from 'typeorm';
import { ObjectId } from 'mongodb';

@Entity()
export class IfoodOrderLinkEntity {
  @ObjectIdColumn()
  internalId: ObjectId;

  @Column()
  @Index({ unique: true })
  ifoodOrderId: string;

  @Column()
  ifoodDisplayId: string;

  @Column()
  merchantId: string;

  @Column()
  deliveryId: string;

  @Column()
  shopkeeperId: string;

  @Column()
  createdAt: Date;
}