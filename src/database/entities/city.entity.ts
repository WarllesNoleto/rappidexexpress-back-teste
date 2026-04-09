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
}