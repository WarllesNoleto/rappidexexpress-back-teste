import { ObjectId } from 'mongodb';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ObjectIdColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserEntity } from './user.entity';

@Entity()
export class LogEntity {
  @ObjectIdColumn()
  internalId: ObjectId;

  @Column('uuid')
  @Index({ unique: true })
  id: string;

  @Column()
  where: string;

  @Column()
  type: string;

  @Column()
  error: string;

  @Column({ unique: false })
  user: UserEntity;

  @Column()
  status: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
