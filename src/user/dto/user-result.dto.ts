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
  usesExternalIfoodPdv: boolean;

  @Expose()
  ifoodMerchantId?: string;
  @Expose()
  ifoodMerchants?: Array<{
    merchantId: string;
    name: string;
    enabled: boolean;
    pickupAddress?: string;
  }>;

  @Expose()
  ifoodClientId?: string;

  @Expose()
  ifoodOrdersReleased: number;

  @Expose()
  ifoodOrdersUsed: number;

  @Expose()
  ifoodOrdersAvailable: number;

  @Expose()
  useAiqfomeIntegration: boolean;

  @Expose()
  aiqfomeStoreId?: string;

  @Expose()
  aiqfomeStores?: Array<{
    storeId: string;
    name: string;
    enabled: boolean;
    pickupAddress?: string;
  }>;

  @Expose()
  aiqfomeConnectionStatus?: string;

  public static fromEntity(user: UserEntity) {
    return plainToClass<UserResult, UserResult>(UserResult, {
      ...user,
      usesExternalIfoodPdv: Boolean(user?.usesExternalIfoodPdv),
      useAiqfomeIntegration: Boolean(user?.useAiqfomeIntegration),
      aiqfomeStoreId: user?.aiqfomeStoreId || '',
      aiqfomeStores: Array.isArray(user?.aiqfomeStores) ? user.aiqfomeStores : [],
      aiqfomeConnectionStatus: (user as any)?.aiqfomeConnectionStatus,
    } as UserResult, {
      excludeExtraneousValues: true,
    });
  }
}
