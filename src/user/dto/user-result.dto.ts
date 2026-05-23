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

  @Expose()
  ifoodClientId?: string;

  @Expose()
  ifoodOrdersReleased: number;

  @Expose()
  ifoodOrdersUsed: number;

  @Expose()
  ifoodOrdersAvailable: number;

  @Expose()
  aiqfomeEnabled?: boolean;

  @Expose()
  aiqfomeStoreId?: string;

  @Expose()
  aiqfomeAccessToken?: string;

  @Expose()
  aiqfomeRefreshToken?: string;

  @Expose()
  aiqfomeTokenExpiresAt?: Date;

  @Expose()
  aiqfomeWebhookSecret?: string;

  public static fromEntity(user: UserEntity) {
    return plainToClass<UserResult, UserResult>(UserResult, user, {
      excludeExtraneousValues: true,
    });
  }
}
