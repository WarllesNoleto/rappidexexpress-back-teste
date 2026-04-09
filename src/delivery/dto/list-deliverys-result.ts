import { Expose, Type } from 'class-transformer';
import { DeliveryEntity } from '../../database/entities';
import { DeliveryResult } from './delivery-result.dto';

export class ListDeliverysResult {
  @Expose()
  @Type(() => DeliveryResult)
  data: DeliveryResult[];

  @Expose()
  page: number;

  @Expose()
  itemsPerPage: number;

  @Expose()
  count: number;

  static fromEntities(
    deliverys: DeliveryEntity[],
    itemsPerPage,
    page,
    count,
  ): ListDeliverysResult {
    const data = deliverys.map((user) => DeliveryResult.fromEntity(user));
    return {
      page,
      itemsPerPage,
      data,
      count,
    };
  }
}
