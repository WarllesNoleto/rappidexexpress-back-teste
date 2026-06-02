import { ObjectId } from 'mongodb';
import { Column, Entity, ObjectIdColumn } from 'typeorm';

@Entity()
export class FinancialSettlementHistoryEntity {
  @ObjectIdColumn()
  id: ObjectId;

  @Column()
  establishmentId: string;

  @Column()
  establishmentName: string;

  @Column({ nullable: true })
  cityId?: string;

  @Column({ nullable: true })
  cityName?: string;

  @Column()
  periodStart: Date;

  @Column()
  periodEnd: Date;

  @Column()
  deliveriesCount: number;

  @Column()
  deliveryFeeValue: number;

  @Column()
  total: number;

  @Column()
  pixKey: string;

  @Column()
  whatsappPhone: string;

  @Column()
  filename: string;

  @Column()
  sentAt: Date;

  @Column()
  status: 'enviado' | 'erro' | 'pendente';

  @Column({ nullable: true })
  errorMessage?: string;
}
