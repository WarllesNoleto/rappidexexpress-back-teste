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
  accessToken: string;

  @Column()
  refreshToken: string;

  @Column({ nullable: true })
  scope?: string;

  @Column({ nullable: true })
  scopes?: string[];

  @Column()
  tokenExpiresAt: Date;

  @Column()
  createdAt: Date;

  @Column()
  expiresAt: Date;

  @Column({ nullable: true })
  usedAt?: Date;

  @Column()
  status: 'pending' | 'used' | 'expired';

  @Column()
  source: 'geraldo_official_button';
}
