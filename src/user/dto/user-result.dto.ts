import { Expose, plainToClass } from 'class-transformer';
import {
  UserType,
  Permissions as UserPermissions,
} from '../../shared/constants/enums.constants';
import { UserEntity } from '../../database/entities/user.entity';

function maskIntegrationToken(token?: string): string {
  const normalizedToken = String(token || '').trim();

  if (!normalizedToken) {
    return '';
  }

  if (normalizedToken.length <= 10) {
    return `${normalizedToken.slice(0, 2)}...${normalizedToken.slice(-2)}`;
  }

  return `${normalizedToken.slice(0, 5)}...${normalizedToken.slice(-6)}`;
}

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
  anotaAiEnabled: boolean;

  @Expose()
  anotaAiStoreId?: string;

  @Expose()
  anotaAiClientId?: string;

  @Expose()
  anotaAiToken?: string;

  @Expose()
  anotaAiIgnoreIfoodOrders: boolean;

  @Expose()
  saiposEnabled: boolean;

  @Expose()
  saiposStoreId?: string;

  @Expose()
  saiposMerchantId?: string;

  @Expose()
  saiposToken?: string;

  public static fromEntity(user: UserEntity) {
    return plainToClass<UserResult, UserResult>(
      UserResult,
      {
        ...user,
        usesExternalIfoodPdv: Boolean(user?.usesExternalIfoodPdv),
        anotaAiEnabled: Boolean(user?.anotaAiEnabled),
        anotaAiToken: maskIntegrationToken(user?.anotaAiToken),
        saiposEnabled: Boolean(user?.saiposEnabled),
        saiposToken: maskIntegrationToken(user?.saiposToken),
        anotaAiIgnoreIfoodOrders: user?.anotaAiIgnoreIfoodOrders !== false,
      } as UserResult,
      {
        excludeExtraneousValues: true,
      },
    );
  }
}
