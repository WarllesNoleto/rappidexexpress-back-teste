import { Entity, ObjectIdColumn, Column } from 'typeorm';
import { ObjectId } from 'mongodb';

@Entity()
export class CityEntity {
  @ObjectIdColumn()
  id: ObjectId;

  @Column()
  name: string;

  @Column({ nullable: false })
  state?: string;

  @Column({ nullable: true })
  clientWhatsappMessage?: string;

  @Column({ nullable: true })
  deliveryValue?: string;

  @Column({ nullable: true })
  deliveryFeeValue?: number;

  @Column({ nullable: true })
  pixKey?: string;

  @Column({ nullable: true })
  adminWhatsapp?: string;

  @Column({ nullable: true })
  whatsappPhoneNumberId?: string;

  @Column({ nullable: true })
  whatsappCloudToken?: string;
}
