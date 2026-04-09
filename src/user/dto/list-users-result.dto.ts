import { Expose, Type } from 'class-transformer';
import { UserResult } from './user-result.dto';
import { UserEntity } from '../../database/entities/user.entity';

export class ListUsersResult {
  @Expose()
  @Type(() => UserResult)
  data: UserResult[];

  @Expose()
  page: number;

  @Expose()
  itemsPerPage: number;

  static fromEntities(
    users: UserEntity[],
    itemsPerPage,
    page,
  ): ListUsersResult {
    const data = users.map((user) => UserResult.fromEntity(user));
    return {
      page,
      itemsPerPage,
      data,
    };
  }
}
