import { ObjectId } from 'mongodb';
import { Column, Entity, Index, ObjectIdColumn } from 'typeorm';

@Entity()
@Index(['shopkeeperId', 'aiqfomeStoreId'], { unique: true })
export class AiqfomeIntegrationEntity {
  @ObjectIdColumn()
  internalId: ObjectId;

  @Column('uuid')
  @Index({ unique: true })
  id: string;

  @Column()
  shopkeeperId: string;

  @Column()
  aiqfomeStoreId: string;

  @Column()
  storeName: string;

  @Column()
  accessToken: string;

  @Column()
  refreshToken: string;

  @Column()
  tokenExpiresAt: Date;

  @Column({ nullable: true })
  scopes?: string[];

  @Column({ default: true })
  active: boolean;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
