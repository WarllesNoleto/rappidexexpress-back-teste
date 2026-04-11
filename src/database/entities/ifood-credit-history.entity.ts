import { ObjectId } from 'mongodb';
import { Column, Entity, ObjectIdColumn } from 'typeorm';

export type IfoodCreditOperationType = 'ADD' | 'REMOVE' | 'CONSUME';

@Entity()
export class IfoodCreditHistoryEntity {
  @ObjectIdColumn()
  internalId: ObjectId;

  @Column('uuid')
  id: string;

  @Column()
  companyId: string;

  @Column()
  operationType: IfoodCreditOperationType;

  @Column()
  amount: number;

  @Column()
  releasedAfterOperation: number;

  @Column()
  usedAfterOperation: number;

  @Column()
  availableAfterOperation: number;

  @Column({ nullable: true })
  performedBy?: string;

  @Column({ nullable: true })
  orderId?: string;

  @Column({ nullable: true })
  reason?: string;

  @Column()
  createdAt: Date;
}