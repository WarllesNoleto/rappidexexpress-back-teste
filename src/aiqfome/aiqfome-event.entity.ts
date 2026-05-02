import { Column, Entity, Index, ObjectIdColumn } from 'typeorm';
import { ObjectId } from 'mongodb';

@Entity('aiqfome_events')
export class AiqfomeEventEntity {
  @ObjectIdColumn()
  internalId: ObjectId;

  @Column('uuid')
  @Index({ unique: true })
  id: string;

  @Column()
  @Index({ unique: true })
  eventId: string;

  @Column()
  event: string;

  @Column({ nullable: true })
  orderId: string;

  @Column({ nullable: true })
  storeId: string;

  @Column()
  rawPayload: any;

  @Column({ default: false })
  processed: boolean;

  @Column()
  createdAt: Date;

  @Column({ nullable: true })
  processedAt: Date;
}