import { ObjectId } from 'mongodb';
import { Column, Entity, Index, ObjectIdColumn } from 'typeorm';
import { Permissions, UserType } from '../../shared/constants/enums.constants';

@Entity()
export class UserEntity {
  @ObjectIdColumn()
  internalId: ObjectId;

  @Column('uuid')
  @Index({ unique: true })
  id: string;

  @Column()
  name: string;

  @Column()
  phone: string;

  @Column({ unique: true })
  user: string;

  @Column()
  password: string;

  @Column({ nullable: true })
  profileImage: string;

  @Column({ nullable: true })
  location: string;

  @Column({ type: 'enum', enum: UserType })
  type: UserType;

  @Column({ type: 'enum', enum: Permissions })
  permission: Permissions;

  @Column()
  pix: string;

  @Column()
  cityId: string;

  @Column()
  isActive: boolean;

  @Column()
  notification: {
    subscriptionId: string;
    // endpoint: string;
    // keys: {
    //   auth: string;
    //   p256dh: string;
    // };
  };

  @Column()
  token: string;

  @Column({ default: false })
  useIfoodIntegration: boolean;

  @Column({ nullable: true })
  ifoodMerchantId?: string;

  @Column({ nullable: true })
  ifoodClientId?: string;

  @Column({ nullable: true })
  ifoodClientSecret?: string;

  @Column({ default: 0 })
  ifoodOrdersReleased: number;

  @Column({ default: 0 })
  ifoodOrdersUsed: number;

  @Column({ default: 0 })
  ifoodOrdersAvailable: number;


  @Column({ default: false })
  aiqfomeEnabled: boolean;

  @Column({ nullable: true })
  aiqfomeStoreId?: string;

  @Column({ nullable: true })
  aiqfomeAccessToken?: string;

  @Column({ nullable: true })
  aiqfomeRefreshToken?: string;

  @Column({ nullable: true })
  aiqfomeTokenExpiresAt?: Date;

  @Column({ nullable: true })
  aiqfomeScope?: string;

  @Column({ nullable: true })
  aiqfomeScopes?: string[];

  @Column({ nullable: true })
  aiqfomeWebhookSecret?: string;

  @Column({ nullable: true })
  aiqfomeWebhookId?: string;

  @Column({ nullable: true })
  aiqfomeWebhookUrl?: string;

  @Column({ nullable: true })
  aiqfomeLastSyncAt?: Date;

  @Column({ nullable: true })
  aiqfomeIntegrationStatus?: 'not_configured' | 'connected' | 'error';

  @Column()
  createdAt: Date;

  @Column({ nullable: true })
  createdBy: string;

  @Column()
  updatedAt: Date;
}