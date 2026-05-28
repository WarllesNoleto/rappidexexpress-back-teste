import { ObjectId } from 'mongodb';
import { Column, Entity, Index, ObjectIdColumn } from 'typeorm';

@Entity()
export class AiqfomePendingAuthorizationEntity {
  @ObjectIdColumn()
  internalId: ObjectId;

  @Column('uuid')
  @Index({ unique: true })
  id: string;

  @Column()
  shopkeeperId: string;

  @Column({ nullable: true })
  storeId?: string;

  @Column()
  @Index()
  nonce: string;

  @Column({ default: false })
  used: boolean;

  @Column()
  createdAt: Date;

  @Column()
  expiresAt: Date;
}
