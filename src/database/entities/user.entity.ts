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

  @Column()
  createdAt: Date;

  @Column({ nullable: true })
  createdBy: string;

  @Column()
  updatedAt: Date;
}
