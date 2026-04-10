import { Expose, plainToClass } from 'class-transformer';
import {
  UserType,
  Permissions as UserPermissions,
} from '../../shared/constants/enums.constants';
import { UserEntity } from '../../database/entities/user.entity';

export class UserResult {
  @Expose()
  id: string;

  @Expose()
  name: string;

  @Expose()
  phone: string;

  @Expose()
  user: string;

  @Expose()
  profileImage?: string;

  @Expose()
  location?: string;

  @Expose()
  type: UserType;

  @Expose()
  pix: string;

  @Expose()
  permission: UserPermissions;

  @Expose()
  isActive: boolean;

  @Expose()
  cityId: string;
  
  @Expose()
  useIfoodIntegration: boolean;

  @Expose()
  ifoodMerchantId?: string;

  public static fromEntity(user: UserEntity) {
    return plainToClass<UserResult, UserResult>(UserResult, user, {
      excludeExtraneousValues: true,
    });
  }
}
